import { MessageConnection } from './MessageConnection';
import { ClientWebSocketTransport } from './transports/WebSocketTransport';

const clients = new Map<string, WebSocketMessageClient>();

export class WebSocketMessageClient<T = unknown> extends MessageConnection<T> {
  public static create<T = unknown>(url: string): WebSocketMessageClient<T> {
    let client = clients.get(url);
    if (!client) {
      client = new WebSocketMessageClient(url);
      clients.set(url, client);
    }
    return client as WebSocketMessageClient<T>;
  }

  private onCloseHandlers: Set<() => void> = new Set();

  private constructor(url: string) {
    super(new ClientWebSocketTransport(url));

    (this.transport as ClientWebSocketTransport).onClose = () => [...this.onCloseHandlers].forEach(fn => fn());
  }

  public isOpen(): boolean {
    return (this.transport as ClientWebSocketTransport).isOpen();
  }

  public async close(): Promise<void> {
    await this.transport.close();
  }

  public set onClose(onClose: () => void) {
    this.onCloseHandlers.add(onClose);
  }

  public async reconnect(): Promise<void> {
    await (this.transport as ClientWebSocketTransport).reconnect();
  }
}
