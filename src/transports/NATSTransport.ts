import { Client } from 'ts-nats';
import { IMessage, IMessageTransport, MessageType } from '../MessageTransport';
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
  private subjectById = new Map<number, string>();

  private constructor(nc: Client, options: INATSTransportOptions) {
    this.nc = nc;
    this.options = options;
  }

  public async send(message: IMessage): Promise<void> {
    const publishSubject = this.options.publishSubject;

    let subject: string | undefined;
    if (message.type === MessageType.End) {
      subject = this.subjectById.get(message.id);
    } else {
      subject = typeof publishSubject === 'string' ? publishSubject : publishSubject(message);
    }

    if (subject === undefined) {
      throw new Error('Could not get subject');
    }

    if (message.type === MessageType.End) {
      this.subjectById.delete(message.id);
    } else {
      this.subjectById.set(message.id, subject);
    }

    // console.log('SEND', serialize(message));

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
