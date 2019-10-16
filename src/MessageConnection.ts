import { createLogger } from '@phnq/log';
import { AsyncQueue } from '@phnq/streams';
import hrtime from 'browser-process-hrtime';
import uuid from 'uuid/v4';

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
      throw new Anomaly(anomalyMessage.payload.message, anomalyMessage.payload.info);

    case MessageType.Error:
      throw new Error((message as ErrorMessage).payload.message);
  }
};

export type Value = string | number | boolean | Date | Data | undefined;

export interface Data {
  [key: string]: Value | Value[];
}

export enum ConversationPerspective {
  Requester = 'requester',
  Responder = 'responder',
}

export interface ConversationSummary {
  perspective: ConversationPerspective;
  request: Message<Value>;
  responses: { message: Message<Value>; time: [number, number] }[];
}

const DEFAULT_RESPONSE_TIMEOUT = 5000;

export class MessageConnection<T extends Value> {
  public responseTimeout = DEFAULT_RESPONSE_TIMEOUT;
  private connId = uuid();
  private transport: MessageTransport;
  private responseQueues = new Map<number, AsyncQueue<Message<T>>>();
  private receiveHandler?: (message: T) => Promise<T | AsyncIterableIterator<T>>;
  private conversationHandler?: (c: ConversationSummary) => void;

  public constructor(transport: MessageTransport) {
    this.transport = transport;

    transport.onReceive((message): void => {
      if (message.type === MessageType.Send) {
        this.handleReceive(message as Message<T>);
        return;
      }

      /**
       * It is, in fact, possible to receive messages that are not intended for
       * this MessageConnection instance. This is because multiple connections
       * may share a single MessageTransport; in this case, they will all receive
       * every incoming message. Since request ids are assigned by the global
       * idIterator, there is a zero collision guarantee.
       */
      const responseQueue = this.responseQueues.get(message.requestId);
      if (responseQueue) {
        switch (message.type) {
          case MessageType.Response:
          case MessageType.Anomaly:
          case MessageType.Error:
          case MessageType.End:
            responseQueue.enqueue(message as Message<T>);
            responseQueue.flush();
            break;

          case MessageType.Multi:
            responseQueue.enqueue(message as Message<T>);
            break;
        }
      }
    });
  }

  public get id(): string {
    return this.connId;
  }

  public async ping(): Promise<boolean> {
    return (await this.doRequest('__ping__')) === '__pong__';
  }

  /**
   * Note: this will yield a response of undefined even if the handler
   * returns nothing. The caller can ignore the response for a "fire and forget"
   * interaction.
   */
  public async send(data: T): Promise<void> {
    await this.requestOne(data);
  }

  public async requestOne(data: T): Promise<T> {
    const resp = await this.request(data);

    if (typeof resp === 'object' && (resp as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
      const resps: T[] = [];

      for await (const r of resp as AsyncIterableIterator<T>) {
        resps.push(r);
      }

      if (resps.length > 1) {
        log.warn('requestOne: multiple responses were returned -- all but the first were discarded');
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
    return this.doRequest(data) as Promise<AsyncIterableIterator<T> | T>;
  }

  private async doRequest(payload: Value): Promise<AsyncIterableIterator<Value> | Value> {
    const reqId = idIterator.next().value;
    const responseQueues = this.responseQueues;
    const sourceId = this.id;

    const requestMessage: Message<Value> = { type: MessageType.Send, requestId: reqId, payload, sourceId };

    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Requester,
      request: requestMessage,
      responses: [],
    };
    const start = hrtime();

    const responseQueue = new AsyncQueue<Message<T>>();
    responseQueue.maxWaitTime = this.responseTimeout;
    responseQueues.set(reqId, responseQueue);

    await this.transport.send(requestMessage);

    const iter = responseQueue.iterator();
    const firstMsg = (await iter.next()).value;
    conversation.responses.push({ message: firstMsg, time: hrtime(start) });

    const conversationHandler = this.conversationHandler;

    if (firstMsg.type === MessageType.Multi) {
      return (async function*(): AsyncIterableIterator<T> {
        yield firstMsg.payload;
        try {
          for await (const message of responseQueue.iterator()) {
            if (message.sourceId === firstMsg.sourceId) {
              conversation.responses.push({ message, time: hrtime(start) });
              possiblyThrow(message);
              if (message.type === MessageType.Multi) {
                yield message.payload;
              }
            } else {
              log.warn(
                'Received responses from multiple sources for request -- keeping the first, ignoring the rest: %s',
                JSON.stringify(payload),
              );
            }
          }
          if (conversationHandler) {
            conversationHandler(conversation);
          }
        } finally {
          responseQueues.delete(reqId);
        }
      })();
    } else {
      responseQueues.delete(reqId);
      if (conversationHandler) {
        conversationHandler(conversation);
      }
      possiblyThrow(firstMsg);
      return firstMsg.payload;
    }
  }

  public onReceive(receiveHandler: (value: T) => Promise<T | AsyncIterableIterator<T>>): void {
    this.receiveHandler = receiveHandler;
  }

  public onConversation(conversationHandler: (c: ConversationSummary) => void): void {
    this.conversationHandler = conversationHandler;
  }

  private async handleReceive(message: Message<T>): Promise<void> {
    const sourceId = this.id;
    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Responder,
      request: message,
      responses: [],
    };
    const start = hrtime();
    const requestPayload = message.payload;

    const send = (m: Message<Value>): void => {
      this.transport.send(m);
      conversation.responses.push({ message: m, time: hrtime(start) });
    };

    if (requestPayload === '__ping__') {
      send({ payload: '__pong__', requestId: message.requestId, sourceId, type: MessageType.Response });
      return;
    }

    if (!this.receiveHandler) {
      throw new Error('No receive handler set.');
    }

    try {
      const result = await this.receiveHandler(requestPayload);
      if (typeof result === 'object' && (result as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
        for await (const responsePayload of result as AsyncIterableIterator<T>) {
          send({ payload: responsePayload, requestId: message.requestId, sourceId, type: MessageType.Multi });
        }
        send({ requestId: message.requestId, sourceId, type: MessageType.End, payload: {} });
      } else {
        const responsePayload = result;
        send({ payload: responsePayload as T, requestId: message.requestId, sourceId, type: MessageType.Response });
      }
    } catch (err) {
      if (err instanceof Anomaly) {
        const anomalyMessage: AnomalyMessage = {
          payload: { message: err.message, info: err.info, requestPayload },
          requestId: message.requestId,
          sourceId,
          type: MessageType.Anomaly,
        };
        send(anomalyMessage);
      } else if (err instanceof Error) {
        const errorMessage: ErrorMessage = {
          payload: { message: err.message, requestPayload },
          requestId: message.requestId,
          sourceId,
          type: MessageType.Error,
        };
        send(errorMessage);
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
