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

const possiblyThrow = (message: Message): void => {
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
  request: Message;
  responses: { message: Message; time: [number, number] }[];
}

export type ResponseMapper = (requestData: Value, responseData: Value) => Value;

const DEFAULT_RESPONSE_TIMEOUT = 5000;

export class MessageConnection<S extends Value = Value, R extends Value = Value> {
  public responseTimeout = DEFAULT_RESPONSE_TIMEOUT;
  private transport: MessageTransport<S, R>;
  private responseQueues = new Map<number, AsyncQueue<Message>>();
  private receiveHandler?: (message: R) => AsyncIterableIterator<S> | Promise<S>;
  private responseMappers: ResponseMapper[] = [];
  private conversationHandler?: (c: ConversationSummary) => void;

  public constructor(transport: MessageTransport<S, R>) {
    this.transport = transport;

    transport.onReceive((message): void => {
      const responseQueue = this.responseQueues.get(message.id);
      switch (message.type) {
        case MessageType.Send:
          this.handleReceive(message);
          break;

        case MessageType.Response:
        case MessageType.Anomaly:
        case MessageType.Error:
        case MessageType.End:
          if (responseQueue) {
            responseQueue.enqueue(message);
            responseQueue.flush();
          }
          break;

        case MessageType.Multi:
          if (responseQueue) {
            responseQueue.enqueue(message);
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
  public async send(data: S): Promise<void> {
    await this.requestOne(data);
  }

  public async requestOne(data: S): Promise<R> {
    const resp = await this.request(data);

    if (typeof resp === 'object' && (resp as AsyncIterableIterator<R>)[Symbol.asyncIterator]) {
      const resps: R[] = [];

      for await (const r of await (resp as AsyncIterableIterator<R>)) {
        resps.push(r);
      }

      if (resps.length > 1) {
        log('requestOne: multiple responses were returned -- all but the first were discarded');
      }

      return resps[0];
    } else {
      return resp as R;
    }
  }

  public async requestMulti(data: S): Promise<AsyncIterableIterator<R>> {
    const resp = await this.request(data);
    if (typeof resp === 'object' && (resp as AsyncIterableIterator<R>)[Symbol.asyncIterator]) {
      return resp as AsyncIterableIterator<R>;
    } else {
      return (async function*(): AsyncIterableIterator<R> {
        yield resp as R;
      })();
    }
  }

  public async request(data: S): Promise<AsyncIterableIterator<R> | R> {
    const id = idIterator.next().value;

    const requestMessage = { type: MessageType.Send, id, data };

    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Requester,
      request: requestMessage,
      responses: []
    };
    const start = hrtime();

    const responseQueue = new AsyncQueue<Message>();
    responseQueue.maxWaitTime = this.responseTimeout;
    this.responseQueues.set(id, responseQueue);

    await this.transport.send(requestMessage);

    const iter = responseQueue.iterator();
    const firstMsg = (await iter.next()).value;
    conversation.responses.push({ message: firstMsg, time: hrtime(start) });

    const conversationHandler = this.conversationHandler;

    if (firstMsg.type === MessageType.Multi) {
      return (async function*(): AsyncIterableIterator<R> {
        yield firstMsg.data as R;
        for await (const message of responseQueue.iterator()) {
          conversation.responses.push({ message, time: hrtime(start) });
          possiblyThrow(message);
          if (message.type === MessageType.Multi) {
            yield message.data as R;
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
      return firstMsg.data as R;
    }
  }

  public onReceive(receiveHandler: (message: R) => AsyncIterableIterator<S> | Promise<S>): void {
    this.receiveHandler = receiveHandler;
  }

  public addResponseMapper(mapper: ResponseMapper): void {
    this.responseMappers.push(mapper);
  }

  public onConversation(conversationHandler: (c: ConversationSummary) => void): void {
    this.conversationHandler = conversationHandler;
  }

  private mapResponse(requestData: Value, responseData: Value): Value {
    let data = responseData;
    this.responseMappers.forEach((mapper): void => {
      data = mapper(requestData, data);
    });
    return data;
  }

  private async handleReceive(message: Message<R>): Promise<void> {
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

    const send = (m: Message): void => {
      this.transport.send(m as Message<S>);
      conversation.responses.push({ message: m, time: hrtime(start) });
    };

    try {
      const result = this.receiveHandler(message.data);
      if (result instanceof Promise) {
        const responseData = await result;
        send({
          data: this.mapResponse(requestData, responseData),
          id: message.id,
          type: MessageType.Response
        });
      } else {
        for await (const responseData of result) {
          send({
            data: this.mapResponse(requestData, responseData),
            id: message.id,
            type: MessageType.Multi
          });
        }
        send({ id: message.id, type: MessageType.End, data: {} });
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
