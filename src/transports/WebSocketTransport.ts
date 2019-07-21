import WebSocket from 'isomorphic-ws';
import { IMessage, IMessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

export class WebSocketTransport implements IMessageTransport {
  private socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: IMessage) {
    this.socket.send(serialize(message));
  }

  public onReceive(receive: (message: IMessage) => void) {
    this.socket.on('message', (message: string) => {
      receive(deserialize(message));
    });
  }
}
