import { Message, MessageTransport } from '../MessageTransport';
import { Value } from '../MessageConnection';

export class DirectTransport<T extends Value> implements MessageTransport {
  private connectedTransport: DirectTransport<T>;

  public constructor(transport?: DirectTransport<T>) {
    this.connectedTransport = transport || new DirectTransport<T>(this);
  }

  public getConnectedTransport(): DirectTransport<T> {
    return this.connectedTransport;
  }

  public async send(message: Message<T>): Promise<void> {
    this.connectedTransport.handleReceive(message);
  }

  public onReceive(receive: (message: Message<T>) => void): void {
    this.receive = receive;
  }

  private receive: (message: Message<T>) => void = (): void => {};

  private handleReceive(message: Message<T>): void {
    this.receive(message);
  }
}
