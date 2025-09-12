import MessageConnection, { type ReceiveHandler } from "./MessageConnection";
import { ClientWebSocketTransport } from "./transports/WebSocketTransport";

const clients = new Map<string, WebSocketMessageClient<unknown, unknown>>();

class WebSocketMessageClient<T, R> extends MessageConnection<T, R> {
  public static create<T, R>(url: string): WebSocketMessageClient<T, R> {
    let client = clients.get(url);
    if (!client) {
      client = new WebSocketMessageClient(url);
      clients.set(url, client);
    }
    return client as WebSocketMessageClient<T, R>;
  }

  private onCloseHandlers = new Set<() => void>();
  private receiveHandlers = new Set<ReceiveHandler<T, R>>();

  private constructor(url: string) {
    super(new ClientWebSocketTransport<T, R>(url));

    (this.transport as ClientWebSocketTransport<T, R>).onClose = () => {
      for (const onClose of this.onCloseHandlers) {
        onClose();
      }
    };

    super.onReceive = async (message) => {
      for (const receiveHandler of this.receiveHandlers) {
        await receiveHandler(message);
      }
      return undefined;
    };
  }

  public override set onReceive(_handler: ReceiveHandler<T, R>) {
    throw new Error(
      "onReceive is not supported on WebSocketMessageClient. Use addReceiveHandler instead.",
    );
  }

  public addReceiveHandler(receiveHandler: ReceiveHandler<T, R>): void {
    this.receiveHandlers.add(receiveHandler);
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

export default WebSocketMessageClient;
