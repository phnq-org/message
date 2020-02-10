import 'ws'; // need to explicitly import this so it gets loaded as a dependency

import WebSocket from 'isomorphic-ws';

import { Message, MessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

export class ServerWebSocketTransport implements MessageTransport {
  private readonly socket: WebSocket;

  public constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: Message): Promise<void> {
    this.socket.send(serialize(message));
  }

  public onReceive(receive: (message: Message) => void): void {
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

export class ClientWebSocketTransport implements MessageTransport {
  public onClose?: () => void;

  private readonly url: string;
  private socket?: WebSocket;
  private onReceiveFn?: (message: Message<unknown>) => void;

  public constructor(url: string) {
    this.url = url;
    this.socket = this.connect();
  }

  public async send(message: Message<unknown>): Promise<void> {
    if (!this.isOpen()) {
      this.socket = this.connect();
    }

    await this.waitUntilOpen();

    if (this.socket) {
      this.socket.send(serialize(message));
    }
  }

  public onReceive(onReceiveFn: (message: Message<unknown>) => void): void {
    this.onReceiveFn = onReceiveFn;
  }

  public async close(): Promise<void> {
    return new Promise(resolve => {
      if (this.socket) {
        this.socket.addEventListener('close', resolve);
        this.socket.close();
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
