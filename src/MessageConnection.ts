import { createLogger } from '@phnq/log';
import { AsyncQueue } from '@phnq/streams';
import { Anomaly } from './errors';
import { IAnomalyMessage, IErrorMessage, IMessage, IMessageTransport, MessageType } from './MessageTransport';

const log = createLogger('MessageConnection');

const idIterator = (function*() {
  let i = 0;
  while (true) {
    yield ++i;
  }
})();

export type IValue = string | number | boolean | Date | IData | undefined;

export interface IData {
  [key: string]: IValue | IValue[];
}

type ResponseMapper = (requestData: any, responseData: any) => any;

const DEFAULT_RESPONSE_TIMEOUT = 5000;

export class MessageConnection {
  public responseTimeout = DEFAULT_RESPONSE_TIMEOUT;
  private transport: IMessageTransport;
  private responseQueues = new Map<number, AsyncQueue<IMessage>>();
  private receiveHandler?: (message: any) => AsyncIterableIterator<IValue> | Promise<IValue | void>;
  private responseMappers: ResponseMapper[] = [];

  constructor(transport: IMessageTransport) {
    this.transport = transport;

    transport.onReceive(message => {
      const responseQueue = this.responseQueues.get(message.id);
      switch (message.type) {
        case MessageType.Send:
          this.handleReceive(message);
          break;

        case MessageType.Response:
        case MessageType.Anomaly:
        case MessageType.Error:
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

        case MessageType.End:
          if (responseQueue) {
            responseQueue.flush();
          }
          break;
      }
    });
  }

  public async send(data: any): Promise<void> {
    await this.requestOne<void>(data);
  }

  public async requestOne<R = any>(data: any): Promise<R> {
    const resp = await this.request(data);

    if (typeof resp === 'object' && resp[Symbol.asyncIterator]) {
      const resps: R[] = [];

      for await (const r of await resp) {
        resps.push(r);
      }

      if (resps.length > 1) {
        log('requestOne: multiple responses were returned -- all but the first were discarded');
      }

      return resps[0];
    } else {
      return resp;
    }
  }

  public async requestMulti<R = any>(data: any): Promise<AsyncIterableIterator<R>> {
    const resp = await this.request(data);
    if (typeof resp === 'object' && resp[Symbol.asyncIterator]) {
      return resp;
    } else {
      return (async function*() {
        yield resp;
      })();
    }
  }

  public async request<R = any>(data: any): Promise<AsyncIterableIterator<R> | R> {
    const id = idIterator.next().value;

    const responseQueue = new AsyncQueue<IMessage>();
    responseQueue.maxWaitTime = this.responseTimeout;
    this.responseQueues.set(id, responseQueue);

    await this.transport.send({ type: MessageType.Send, id, data });

    const iter = responseQueue.iterator();
    const firstMsg = (await iter.next()).value;

    if (firstMsg.type === MessageType.Multi) {
      return (async function*() {
        yield firstMsg.data;
        for await (const message of responseQueue.iterator()) {
          possiblyThrow(message);
          yield message.data;
        }
      })();
    } else {
      possiblyThrow(firstMsg);
      return firstMsg.data;
    }
  }

  public onReceive<R>(receiveHandler: (message: R) => AsyncIterableIterator<IValue> | Promise<IValue | void>) {
    this.receiveHandler = receiveHandler;
  }

  public addResponseMapper(mapper: ResponseMapper) {
    this.responseMappers.push(mapper);
  }

  private mapResponse(requestData: any, responseData: any): any {
    let data = responseData;
    this.responseMappers.forEach(mapper => {
      data = mapper(requestData, data);
    });
    return data;
  }

  private async handleReceive(message: IMessage) {
    if (!this.receiveHandler) {
      throw new Error('No receive handler set.');
    }

    const requestData = message.data;
    try {
      const result = this.receiveHandler(message.data);
      if (result instanceof Promise) {
        this.transport.send({
          data: this.mapResponse(requestData, await result),
          id: message.id,
          type: MessageType.Response,
        });
        return;
      }

      for await (const resp of result) {
        this.transport.send({
          data: this.mapResponse(requestData, await resp),
          id: message.id,
          type: MessageType.Multi,
        });
      }

      this.transport.send({ id: message.id, type: MessageType.End, data: {} });
    } catch (err) {
      if (err instanceof Anomaly) {
        this.transport.send({
          data: { message: err.message, info: err.info, requestData },
          id: message.id,
          type: MessageType.Anomaly,
        });
      } else if (err instanceof Error) {
        this.transport.send({
          data: { message: err.message, requestData },
          id: message.id,
          type: MessageType.Error,
        });
      } else {
        throw new Error('Errors should only throw instances of Error and Anomaly.');
      }
    }
  }
}

const possiblyThrow = (message: IMessage) => {
  switch (message.type) {
    case MessageType.Anomaly:
      const anomalyMessage = message as IAnomalyMessage;
      throw new Anomaly(anomalyMessage.data.message, anomalyMessage.data.info);

    case MessageType.Error:
      throw new Error((message as IErrorMessage).data.message);
  }
};
