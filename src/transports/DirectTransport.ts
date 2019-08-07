import { Message, MessageTransport } from '../MessageTransport';
import { Value } from '../MessageConnection';

export class DirectTransport implements MessageTransport {
  private connectedTransport: DirectTransport;

  public constructor(transport?: DirectTransport) {
    this.connectedTransport = transport || new DirectTransport(this);
  }

  public getConnectedTransport(): DirectTransport {
    return this.connectedTransport;
  }

  public async send(message: Message<Value>): Promise<void> {
    this.connectedTransport.handleReceive(message);
  }

  public onReceive(receive: (message: Message<Value>) => void): void {
    this.receive = receive;
  }

  private receive: (message: Message<Value>) => void = (): void => {};

  private handleReceive(message: Message<Value>): void {
    this.receive(message);
  }
}
