import type { MessageTransport, RequestMessage, ResponseMessage } from "../MessageTransport";

class DirectTransport<T, R> implements MessageTransport<T, R> {
  private connectedTransport: DirectTransport<T, R>;

  public constructor(transport?: DirectTransport<T, R>) {
    this.connectedTransport = transport || new DirectTransport(this);
  }

  public getConnectedTransport(): DirectTransport<T, R> {
    return this.connectedTransport;
  }

  public async send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void> {
    this.connectedTransport.handleReceive(message);
  }

  public onReceive(receive: (message: RequestMessage<T> | ResponseMessage<R>) => void): void {
    this.receive = receive;
  }

  private receive: (message: RequestMessage<T> | ResponseMessage<R>) => void = (): void => {
    // no-op
  };

  private handleReceive(message: RequestMessage<T> | ResponseMessage<R>): void {
    this.receive(message);
  }

  public async close(): Promise<void> {
    // no-op
  }
}

export default DirectTransport;
