import { createLogger } from '@phnq/log';
import { Client, Subscription } from 'ts-nats';

import { Message, MessageTransport, MessageType } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';

const log = createLogger('NATSTransport');

const logTraffic = process.env.PHNQ_MESSAGE_LOG_NATS === '1';

type SubjectResolver = (message: Message) => string;

interface NATSTransportOptions {
  subscriptions: string[];
  publishSubject: string | SubjectResolver;
}

export class NATSTransport implements MessageTransport {
  public static async create(nc: Client, options: NATSTransportOptions): Promise<NATSTransport> {
    const natsTransport = new NATSTransport(nc, options);
    await natsTransport.initialize();
    return natsTransport;
  }

  private nc: Client;
  private options: NATSTransportOptions;
  private receiveHandler?: (message: Message) => void;
  private subjectById = new Map<number, string>();

  private constructor(nc: Client, options: NATSTransportOptions) {
    this.nc = nc;
    this.options = options;
  }

  public async send(message: Message): Promise<void> {
    const publishSubject = this.options.publishSubject;

    let subject: string | undefined;
    if (message.t === MessageType.End) {
      subject = this.subjectById.get(message.c);
    } else {
      subject = typeof publishSubject === 'string' ? publishSubject : publishSubject(message);
    }

    if (subject === undefined) {
      throw new Error('Could not get subject');
    }

    if (message.t === MessageType.End) {
      this.subjectById.delete(message.c);
    } else {
      this.subjectById.set(message.c, subject);
    }

    if (logTraffic) {
      log('PUBLISH [%s] %O', subject, message);
    }

    await this.nc.publish(subject, serialize(message));
  }

  public onReceive(receiveHandler: (message: Message) => void): void {
    this.receiveHandler = receiveHandler;
  }

  private async initialize(): Promise<void> {
    await Promise.all(
      this.options.subscriptions.map(
        (subject): Promise<Subscription> =>
          this.nc.subscribe(subject, (_, msg): void => {
            if (this.receiveHandler) {
              const message = deserialize(msg.data);
              if (logTraffic) {
                log('RECEIVE [%s] %O', subject, message);
              }
              this.receiveHandler(message);
            }
          }),
      ),
    );
  }
}
