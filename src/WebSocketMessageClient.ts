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

  private constructor(url: string) {
    super(new ClientWebSocketTransport(url));
  }

  public async isOpen(): Promise<boolean> {
    return (this.transport as ClientWebSocketTransport).isOpen();
  }

  public async close(): Promise<void> {
    await this.transport.close();
  }

  public set onClose(onClose: () => void) {
    (this.transport as ClientWebSocketTransport).onClose = onClose;
  }
}
