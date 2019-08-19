import 'ws'; // need to explicitly import this so it gets loaded as a dependency

import WebSocket from 'isomorphic-ws';

import { Value } from '../MessageConnection';
import { Message, MessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

export class WebSocketTransport implements MessageTransport {
  private socket: WebSocket;

  public constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: Message<Value>): Promise<void> {
    this.socket.send(serialize(message));
  }

  public onReceive(receive: (message: Message<Value>) => void): void {
    this.socket.addEventListener('message', (event): void => {
      receive(deserialize(event.data));
    });
  }
}
