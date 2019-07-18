import WebSocket from 'isomorphic-ws';
import { IMessage, IMessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

export default class WebSocketTransport implements IMessageTransport {
  private socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
  }

  public async send(message: IMessage) {
    this.socket.send(serialize(message));
  }

  public async onReceive(receive: (message: IMessage) => void) {
    this.socket.on('message', (message: string) => {
      receive(deserialize(message));
    });
  }
}
