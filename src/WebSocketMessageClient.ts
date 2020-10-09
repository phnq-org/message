import { MessageConnection } from './MessageConnection';
import { ClientWebSocketTransport } from './transports/WebSocketTransport';

const clients = new Map<string, WebSocketMessageClient<unknown, unknown>>();

export class WebSocketMessageClient<T, R> extends MessageConnection<T, R> {
  public static create<T, R>(url: string): WebSocketMessageClient<T, R> {
    let client = clients.get(url);
    if (!client) {
      client = new WebSocketMessageClient(url);
      clients.set(url, client);
    }
    return client as WebSocketMessageClient<T, R>;
  }

  private onCloseHandlers: Set<() => void> = new Set();

  private constructor(url: string) {
    super(new ClientWebSocketTransport<T, R>(url));

    (this.transport as ClientWebSocketTransport<T, R>).onClose = () => [...this.onCloseHandlers].forEach(fn => fn());
  }

  public isOpen(): boolean {
    return (this.transport as ClientWebSocketTransport<T, R>).isOpen();
  }

  public async close(): Promise<void> {
    await this.transport.close();
  }

  public set onClose(onClose: () => void) {
    this.onCloseHandlers.add(onClose);
  }
}
