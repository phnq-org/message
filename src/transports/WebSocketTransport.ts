import WebSocket from 'isomorphic-ws';
import { Message, MessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

export class WebSocketTransport implements MessageTransport {
  private socket: WebSocket;

  public constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: Message): Promise<void> {
    this.socket.send(serialize(message));
  }

  public onReceive(receive: (message: Message) => void): void {
    this.socket.addEventListener('message', (event): void => {
      receive(deserialize(event.data));
    });
  }
}
