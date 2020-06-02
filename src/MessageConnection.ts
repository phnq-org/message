import { createLogger } from '@phnq/log';
import { AsyncQueue } from '@phnq/streams';
import hrtime from 'browser-process-hrtime';
import uuid from 'uuid/v4';

import { Anomaly } from './errors';
import { AnomalyMessage, ErrorMessage, Message, MessageTransport, MessageType } from './MessageTransport';
import { signMessage, verifyMessage } from './sign';

const log = createLogger('MessageConnection');

const idIterator = (function*(): IterableIterator<number> {
  let i = 0;
  while (true) {
    yield ++i;
  }
})();

const possiblyThrow = (message: Message): void => {
  switch (message.t) {
    case MessageType.Anomaly:
      const anomalyMessage = message as AnomalyMessage;
      throw new Anomaly(anomalyMessage.p.message, anomalyMessage.p.info);

    case MessageType.Error:
      throw new Error((message as ErrorMessage).p.message);
  }
};

export enum ConversationPerspective {
  Requester = 'requester',
  Responder = 'responder',
}

export interface ConversationSummary {
  perspective: ConversationPerspective;
  request: Message;
  responses: { message: Message; time: [number, number] }[];
}

const DEFAULT_RESPONSE_TIMEOUT = 5000;

export class MessageConnection<T = unknown> {
  public responseTimeout = DEFAULT_RESPONSE_TIMEOUT;
  private connId = uuid();
  public readonly transport: MessageTransport;
  private responseQueues = new Map<number, AsyncQueue<Message<T>>>();
  private receiveHandler?: (message: T) => Promise<T | AsyncIterableIterator<T> | void>;
  private conversationHandler?: (c: ConversationSummary) => void;
  private signSalt?: string;
  private data = new Map<string, unknown>();

  public constructor(transport: MessageTransport, { signSalt }: { signSalt?: string } = {}) {
    this.transport = transport;
    this.signSalt = signSalt;

    transport.onReceive(message => {
      if (this.signSalt) {
        verifyMessage(message, this.signSalt);
      }

      if (message.t === MessageType.Send) {
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
      const responseQueue = this.responseQueues.get(message.c);
      if (responseQueue) {
        switch (message.t) {
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

  public getData<D = unknown>(key: string): D {
    return this.data.get(key) as D;
  }

  /**
   * Set a keyed value on the connection. This key/value pair are cached on the
   * connection instance.
   * @param key the key
   * @param value the value
   */
  public setData(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  public deleteData(key: string): void {
    this.data.delete(key);
  }

  public async send(data: T): Promise<void> {
    await this.requestOne(data, false);
  }

  public async requestOne(data: T, expectResponse = true): Promise<T> {
    const resp = await this.request(data, expectResponse);

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

  public async request(data: T, expectResponse = true): Promise<AsyncIterableIterator<T> | T> {
    return this.doRequest(data, expectResponse) as Promise<AsyncIterableIterator<T> | T>;
  }

  private signMessage(message: Message): Message {
    if (this.signSalt) {
      return signMessage(message, this.signSalt);
    }
    return message;
  }

  private async doRequest(payload: T, expectResponse: boolean): Promise<AsyncIterableIterator<T> | T | undefined> {
    const reqId = idIterator.next().value;
    const responseQueues = this.responseQueues;
    const source = this.id;

    const requestMessage = this.signMessage({ t: MessageType.Send, c: reqId, p: payload, s: source });

    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Requester,
      request: requestMessage,
      responses: [],
    };
    const start = hrtime();

    const responseQueue = new AsyncQueue<Message<T>>();

    if (expectResponse) {
      responseQueue.maxWaitTime = this.responseTimeout;
      responseQueues.set(reqId, responseQueue);
    }

    await this.transport.send(requestMessage);

    if (expectResponse) {
      const iter = responseQueue.iterator();
      const firstMsg = (await iter.next()).value as Message<T>;
      conversation.responses.push({ message: firstMsg, time: hrtime(start) });

      const conversationHandler = this.conversationHandler;

      if (firstMsg.t === MessageType.Multi) {
        return (async function*(): AsyncIterableIterator<T> {
          yield firstMsg.p;
          try {
            for await (const message of responseQueue.iterator()) {
              if (message.s === firstMsg.s) {
                conversation.responses.push({ message, time: hrtime(start) });
                possiblyThrow(message);
                if (message.t === MessageType.Multi) {
                  yield message.p;
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
        return firstMsg.p;
      }
    }
  }

  public onReceive(receiveHandler: (value: T) => Promise<T | AsyncIterableIterator<T> | void>): void {
    this.receiveHandler = receiveHandler;
  }

  public onConversation(conversationHandler: (c: ConversationSummary) => void): void {
    this.conversationHandler = conversationHandler;
  }

  private async handleReceive(message: Message<T>): Promise<void> {
    const source = this.id;
    const conversation: ConversationSummary = {
      perspective: ConversationPerspective.Responder,
      request: message,
      responses: [],
    };
    const start = hrtime();
    const requestPayload = message.p;

    const send = (m: Message): void => {
      const signedMessage = this.signMessage(m);
      this.transport.send(signedMessage);
      conversation.responses.push({ message: signedMessage, time: hrtime(start) });
    };

    if (!this.receiveHandler) {
      throw new Error('No receive handler set.');
    }

    try {
      const result = await this.receiveHandler(requestPayload);
      if (typeof result === 'object' && (result as AsyncIterableIterator<T>)[Symbol.asyncIterator]) {
        for await (const responsePayload of result as AsyncIterableIterator<T>) {
          send({ p: responsePayload, c: message.c, s: source, t: MessageType.Multi });
        }
        send({ c: message.c, s: source, t: MessageType.End, p: {} });
      } else if (result) {
        const responsePayload = result;
        send({ p: responsePayload as T, c: message.c, s: source, t: MessageType.Response });
      } else {
        // kill the async queue
      }
    } catch (err) {
      if (err instanceof Anomaly) {
        const anomalyMessage: AnomalyMessage = {
          p: { message: err.message, info: err.info, requestPayload },
          c: message.c,
          s: source,
          t: MessageType.Anomaly,
        };
        send(anomalyMessage);
      } else if (err instanceof Error) {
        const errorMessage: ErrorMessage = {
          p: { message: err.message, requestPayload },
          c: message.c,
          s: source,
          t: MessageType.Error,
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
