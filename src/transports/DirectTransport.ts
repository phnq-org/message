import { Message, MessageTransport } from '../MessageTransport';

export class DirectTransport implements MessageTransport {
  private connectedTransport: DirectTransport;

  public constructor(transport?: DirectTransport) {
    this.connectedTransport = transport || new DirectTransport(this);
  }

  public getConnectedTransport(): DirectTransport {
    return this.connectedTransport;
  }

  public async send(message: Message): Promise<void> {
    this.connectedTransport.handleReceive(message);
  }

  public onReceive(receive: (message: Message) => void): void {
    this.receive = receive;
  }

  private receive: (message: Message) => void = (): void => {};

  private handleReceive(message: Message): void {
    this.receive(message);
  }
}
