import WebSocket from 'isomorphic-ws';
import { MessageConnection } from './MessageConnection';
import WebSocketTransport from './transports/WebSocketTransport';

export default class WebSocketMessageClient extends MessageConnection {
  public static async create(url: string): Promise<WebSocketMessageClient> {
    return new WebSocketMessageClient(
      await new Promise<WebSocket>(resolve => {
        const s = new WebSocket(url);
        s.on('open', () => {
          resolve(s);
        });
      }),
    );
  }

  public onClose?: () => void;

  private socket: WebSocket;

  private constructor(s: WebSocket) {
    super(new WebSocketTransport(s));
    this.socket = s;

    s.on('close', () => {
      if (this.onClose) {
        this.onClose();
      }
    });
  }

  public isOpen() {
    return this.socket.readyState === WebSocket.OPEN;
  }
}
