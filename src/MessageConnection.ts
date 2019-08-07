import { createLogger } from '@phnq/log';
import { AsyncQueue } from '@phnq/streams';
import hrtime from 'browser-process-hrtime';
import { Anomaly } from './errors';
import { AnomalyMessage, ErrorMessage, Message, MessageTransport, MessageType } from './MessageTransport';
const log = createLogger('MessageConnection');

const idIterator = (function*(): IterableIterator<number> {
  let i = 0;
  while (true) {
    yield ++i;
  }
})();

const possiblyThrow = (message: Message<Value>): void => {
  switch (message.type) {
    case MessageType.Anomaly:
      const anomalyMessage = message as AnomalyMessage;
      throw new Anomaly(anomalyMessage.data.message, anomalyMessage.data.info);

    case MessageType.Error:
      throw new Error((message as ErrorMessage).data.message);
  }
};

export type Value = string | number | boolean | Date | Data | undefined;

export interface Data {
  [key: string]: Value | Value[];
}

export enum ConversationPerspective {
  Requester = 'requester',
  Responder = 'responder'
}

export interface ConversationSummary {
  perspective: ConversationPerspective;
  request: Message<Value>;
  responses: { message: Message<Value>; time: [number, number] }[];
}

const DEFAULT_RESPONSE_TIMEOUT = 5000;

export class MessageConnection<T extends Value> {
  public responseTimeout = DEFAULT_RESPONSE_TIMEOUT;
  private transport: MessageTransport;
  private responseQueues = new Map<number, AsyncQueue<Message<T>>>();
  private receiveHandler?: (message: T) => Promise<T | AsyncIterableIterator<T>>;
  private conversationHandler?: (c: ConversationSummary) => void;

  public constructor(transport: MessageTransport) {
    this.transport = transport;

    transport.onReceive((message): void => {
      const responseQueue = this.responseQueues.get(message.id);
      switch (message.type) {
        case MessageType.Send:
          this.handleReceive(message as Message<T>);
          break;

        case MessageType.Response:
        case MessageType.Anomaly:
        case MessageType.Error:
        case MessageType.End:
          if (responseQueue) {
            responseQueue.enqueue(message as Message<T>);
            responseQueue.flush();
          }
          break;

        case MessageType.Multi:
          if (responseQueue) {
            responseQueue.enqueue(message as Message<T>);
          }
          break;
      }
    });
  }

  /**
   * Note: this will yield a response of undefined even if the handler
   * returns nothing. The caller can ignore the response for a "fire and forget"
   * interaction.
   */
  public async send(data: T): Promise<void> {
    await this.requestOne(data);
  }

  public async requestOne(data: T): Promise<Value> {
    const resp = await this.request(data);

    if (typeof resp === 'object' && (resp as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
      const resps: T[] = [];

      for await (const r of await (resp as AsyncIterableIterator<T>)) {
        resps.push(r);
      }

      if (resps.length > 1) {
        log('requestOne: multiple responses were returned -- all but the first were discarded');
      }

      return resps[0];
    } else {
      return resp as T;
    }
  }

  public async requestMulti(data: T): Promise<AsyncIterableIterator<T>> {
    const resp = await this.request(data);
    if (typeof resp === 'object' && (resp as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
      return resp as AsyncIterableIterator<T>;
    } else {
      return (async function*(): AsyncIterableIterator<T> {
        yield resp as T;
      })();
    }
  }

  public async request(data: T): Promise<AsyncIterableIterator<T> | T> {
    const id = idIterator.next().value;

    const requestMessage = { type: MessageType.Send, id, data };

    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Requester,
      request: requestMessage,
      responses: []
    };
    const start = hrtime();

    const responseQueue = new AsyncQueue<Message<T>>();
    responseQueue.maxWaitTime = this.responseTimeout;
    this.responseQueues.set(id, responseQueue);

    await this.transport.send(requestMessage);

    const iter = responseQueue.iterator();
    const firstMsg = (await iter.next()).value;
    conversation.responses.push({ message: firstMsg, time: hrtime(start) });

    const conversationHandler = this.conversationHandler;

    if (firstMsg.type === MessageType.Multi) {
      return (async function*(): AsyncIterableIterator<T> {
        yield firstMsg.data;
        for await (const message of responseQueue.iterator()) {
          conversation.responses.push({ message, time: hrtime(start) });
          possiblyThrow(message);
          if (message.type === MessageType.Multi) {
            yield message.data;
          }
        }
        if (conversationHandler) {
          conversationHandler(conversation);
        }
      })();
    } else {
      if (conversationHandler) {
        conversationHandler(conversation);
      }
      possiblyThrow(firstMsg);
      return firstMsg.data;
    }
  }

  public onReceive(receiveHandler: (value: T) => Promise<T | AsyncIterableIterator<T>>): void {
    this.receiveHandler = receiveHandler;
  }

  public onConversation(conversationHandler: (c: ConversationSummary) => void): void {
    this.conversationHandler = conversationHandler;
  }

  private async handleReceive(message: Message<T>): Promise<void> {
    if (!this.receiveHandler) {
      throw new Error('No receive handler set.');
    }

    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Responder,
      request: message,
      responses: []
    };
    const start = hrtime();
    const requestData = message.data;

    const send = (m: Message<Value>): void => {
      this.transport.send(m);
      conversation.responses.push({ message: m, time: hrtime(start) });
    };

    try {
      const result = await this.receiveHandler(message.data);
      if (typeof result === 'object' && (result as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
        for await (const responseData of result as AsyncIterableIterator<T>) {
          send({
            data: responseData,
            id: message.id,
            type: MessageType.Multi
          });
        }
        send({ id: message.id, type: MessageType.End, data: {} });
      } else {
        const responseData = await result;
        send({
          data: responseData as T,
          id: message.id,
          type: MessageType.Response
        });
      }
    } catch (err) {
      if (err instanceof Anomaly) {
        send({
          data: { message: err.message, info: err.info, requestData },
          id: message.id,
          type: MessageType.Anomaly
        });
      } else if (err instanceof Error) {
        send({
          data: { message: err.message, requestData },
          id: message.id,
          type: MessageType.Error
        });
      } else {
        throw new Error('Errors should only throw instances of Error and Anomaly.');
      }
    } finally {
      if (this.conversationHandler) {
        this.conversationHandler(conversation);
      }
    }
  }
}
