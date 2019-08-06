import WebSocket from 'isomorphic-ws';
import { Message, MessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';
import { Value } from '../MessageConnection';

export class WebSocketTransport<S extends Value, R extends Value> implements MessageTransport<S, R> {
  private socket: WebSocket;

  public constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: Message<S>): Promise<void> {
    this.socket.send(serialize(message));
  }

  public onReceive(receive: (message: Message<R>) => void): void {
    this.socket.addEventListener('message', (event): void => {
      receive(deserialize(event.data));
    });
  }
}
