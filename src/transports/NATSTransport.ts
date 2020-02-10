import { createLogger } from '@phnq/log';
import hash from 'object-hash';
import { Client, connect, NatsConnectionOptions, Payload, Subscription } from 'ts-nats';

import { Message, MessageTransport, MessageType } from '../MessageTransport';
import { annotate, deannotate, deserialize, serialize } from '../serialize';

const log = createLogger('NATSTransport');

const logTraffic = process.env.PHNQ_MESSAGE_LOG_NATS === '1';

type SubjectResolver = (message: Message) => string;

interface NATSTransportOptions {
  subscriptions: string[];
  publishSubject: string | SubjectResolver;
}

// Keep track of clients by config hash so they can be shared
const clients = new Map<string, Client>();

export class NATSTransport implements MessageTransport {
  public static async create(config: NatsConnectionOptions, options: NATSTransportOptions): Promise<NATSTransport> {
    config.payload = config.payload || Payload.JSON;
    const nc = clients.get(hash(config)) || (await connect(config));
    clients.set(hash(config), nc);
    const natsTransport = new NATSTransport(config, nc, options);
    await natsTransport.initialize();
    return natsTransport;
  }

  private config: NatsConnectionOptions;
  private nc: Client;
  private options: NATSTransportOptions;
  private receiveHandler?: (message: Message) => void;
  private subjectById = new Map<number, string>();

  private constructor(config: NatsConnectionOptions, nc: Client, options: NATSTransportOptions) {
    this.config = config;
    this.nc = nc;
    this.options = options;
  }

  public async close(): Promise<void> {
    this.nc.close();
    clients.delete(hash(this.config));
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

    this.nc.publish(subject, this.marshall(message));
  }

  public onReceive(receiveHandler: (message: Message) => void): void {
    this.receiveHandler = receiveHandler;
  }

  private marshall(message: Message): unknown {
    if (this.config.payload === Payload.JSON) {
      return annotate(message);
    } else if (this.config.payload === Payload.STRING) {
      return serialize(message);
    } else if (this.config.payload === Payload.BINARY) {
      // TODO: Binary
    }
    throw new Error(`Unsupported payload type: ${this.config.payload}`);
  }

  private unmarshall(data: unknown): Message {
    if (this.config.payload === Payload.JSON) {
      return deannotate(data);
    } else if (this.config.payload === Payload.STRING) {
      return deserialize(data as string);
    } else if (this.config.payload === Payload.BINARY) {
      // TODO: Binary
    }
    throw new Error(`Unsupported payload type: ${this.config.payload}`);
  }

  private async initialize(): Promise<void> {
    await Promise.all(
      this.options.subscriptions.map(
        (subject): Promise<Subscription> =>
          this.nc.subscribe(subject, (_, msg): void => {
            if (this.receiveHandler) {
              const message = this.unmarshall(msg.data);
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
