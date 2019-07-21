import { IMessage, IMessageTransport } from '../MessageTransport';

export class DirectTransport implements IMessageTransport {
  private connectedTransport: DirectTransport;

  constructor(transport?: DirectTransport) {
    this.connectedTransport = transport || new DirectTransport(this);
  }

  public getConnectedTransport() {
    return this.connectedTransport;
  }

  public async send(message: IMessage) {
    this.connectedTransport.handleReceive(message);
  }

  public onReceive(receive: (message: IMessage) => void) {
    this.receive = receive;
  }

  private receive: (message: IMessage) => void = () => {};

  private handleReceive(message: IMessage) {
    this.receive(message);
  }
}
