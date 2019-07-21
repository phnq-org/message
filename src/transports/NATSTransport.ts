import { Client } from 'ts-nats';
import { IMessage, IMessageTransport } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

type SubjectResolver = (message: IMessage) => string;

interface INATSTransportOptions {
  subscriptions: string[];
  publishSubject: string | SubjectResolver;
}

export class NATSTransport implements IMessageTransport {
  public static async create(nc: Client, options: INATSTransportOptions): Promise<NATSTransport> {
    const natsTransport = new NATSTransport(nc, options);
    await natsTransport.initialize();
    return natsTransport;
  }

  private nc: Client;
  private options: INATSTransportOptions;
  private receiveHandler?: (message: IMessage) => void;

  private constructor(nc: Client, options: INATSTransportOptions) {
    this.nc = nc;
    this.options = options;
  }

  public async send(message: IMessage): Promise<void> {
    const publishSubject = this.options.publishSubject;
    const subject = typeof publishSubject === 'string' ? publishSubject : publishSubject(message);
    await this.nc.publish(subject, serialize(message));
  }
  public onReceive(receiveHandler: (message: IMessage) => void): void {
    this.receiveHandler = receiveHandler;
  }

  private async initialize() {
    await Promise.all(
      this.options.subscriptions.map(subject =>
        this.nc.subscribe(subject, (_, msg) => {
          if (this.receiveHandler) {
            this.receiveHandler(deserialize(msg.data));
          }
        }),
      ),
    );
  }
}
