import WebSocket from 'isomorphic-ws';

import { MessageConnection, Value } from './MessageConnection';
import { WebSocketTransport } from './transports/WebSocketTransport';

const webSocketPromises = new Map<string, Promise<WebSocket>>();

export class WebSocketMessageClient<T extends Value> extends MessageConnection<T> {
  public static async create<T extends Value>(url: string): Promise<WebSocketMessageClient<T>> {
    let wsPromise = webSocketPromises.get(url);
    if (!wsPromise) {
      wsPromise = new Promise<WebSocket>((resolve): void => {
        const s = new WebSocket(url);
        s.addEventListener('open', (): void => {
          resolve(s);
        });
      });
      webSocketPromises.set(url, wsPromise);
    }
    return new WebSocketMessageClient<T>(await wsPromise);
  }

  public onClose?: () => void;

  private socket: WebSocket;

  private constructor(s: WebSocket) {
    super(new WebSocketTransport(s));
    this.socket = s;

    s.addEventListener('close', (): void => {
      if (this.onClose) {
        this.onClose();
      }
    });
  }

  public isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }
}
