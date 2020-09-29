import 'ws'; // need to explicitly import this so it gets loaded as a dependency

import WebSocket from 'isomorphic-ws';

import { MessageTransport, RequestMessage, ResponseMessage } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

export class ServerWebSocketTransport<T, R> implements MessageTransport<T, R> {
  private readonly socket: WebSocket;

  public constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void> {
    this.socket.send(serialize(message));
  }

  public onReceive(receive: (message: RequestMessage<T> | ResponseMessage<R>) => void): void {
    this.socket.addEventListener('message', ({ data }): void => {
      receive(deserialize(data));
    });
  }

  public async close(): Promise<void> {
    return new Promise(resolve => {
      this.socket.addEventListener('close', resolve);
      this.socket.close();
    });
  }
}

export class ClientWebSocketTransport<T, R> implements MessageTransport<T, R> {
  public onClose?: () => void;

  private readonly url: string;
  private socket?: WebSocket;
  private onReceiveFn?: (message: RequestMessage<T> | ResponseMessage<R>) => void;

  public constructor(url: string) {
    this.url = url;
    this.socket = this.connect();
  }

  public async send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void> {
    if (!this.isOpen()) {
      await this.reconnect();
    }

    await this.waitUntilOpen();

    if (this.socket) {
      this.socket.send(serialize(message));
    }
  }

  public onReceive(onReceiveFn: (message: RequestMessage<T> | ResponseMessage<R>) => void): void {
    this.onReceiveFn = onReceiveFn;
  }

  public async close(): Promise<void> {
    return new Promise(resolve => {
      if (this.socket) {
        this.socket.addEventListener('close', resolve);
        this.socket.close(1000);
      } else {
        resolve();
      }
    });
  }

  public isOpen(): boolean {
    return (
      this.socket !== undefined &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    );
  }

  public async reconnect(): Promise<void> {
    this.socket = this.connect();
    await this.waitUntilOpen();
  }

  private async waitUntilOpen(): Promise<void> {
    return new Promise(resolve => {
      if (this.socket !== undefined && this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.addEventListener('open', resolve);
      } else {
        resolve();
      }
    });
  }

  private connect(): WebSocket {
    const socket = new WebSocket(this.url);

    socket.addEventListener('message', ({ data }) => {
      if (this.onReceiveFn) {
        this.onReceiveFn(deserialize(data));
      }
    });

    socket.addEventListener('close', () => {
      if (this.onClose) {
        this.onClose();
      }
      this.socket = undefined;
    });
    return socket;
  }
}
