import { createLogger } from '@phnq/log';
import hash from 'object-hash';
import { Client, connect, NatsConnectionOptions, Payload, ServerInfo, Subscription } from 'ts-nats';
import uuid from 'uuid/v4';

import { MessageTransport, MessageType, RequestMessage, ResponseMessage } from '../MessageTransport';
import { annotate, deannotate, deserialize, serialize } from '../serialize';

const log = createLogger('NATSTransport');

const logTraffic = process.env.PHNQ_MESSAGE_LOG_NATS === '1';

const CHUNK_HEADER_PREFIX = Buffer.from('@phnq/message/chunk', 'utf-8');

type SubjectResolver<T, R> = (message: RequestMessage<T> | ResponseMessage<R>) => string;

interface NATSTransportOptions<T, R> {
  subscriptions: string[];
  publishSubject: string | SubjectResolver<T, R>;
}

// Keep track of clients by config hash so they can be shared
const clients = new Map<string, [Client, ServerInfo, number]>();

export class NATSTransport<T, R> implements MessageTransport<T, R> {
  public static async create<T, R>(
    config: NatsConnectionOptions,
    options: NATSTransportOptions<T, R>,
  ): Promise<NATSTransport<T, R>> {
    config.payload = config.payload || Payload.BINARY;
    const [nc, serverInfo, refCount] =
      clients.get(hash(config)) ||
      (await new Promise<[Client, ServerInfo, number]>(async (resolve, reject) => {
        try {
          const client = await connect(config);
          client.on('connect', (_, __, info: ServerInfo) => {
            resolve([client, info, 0]);
          });
        } catch (err) {
          reject(err);
        }
      }));

    clients.set(hash(config), [nc, serverInfo, refCount + 1]);
    const natsTransport = new NATSTransport<T, R>(config, nc, options, serverInfo);
    await natsTransport.initialize();
    return natsTransport;
  }

  private config: NatsConnectionOptions;
  private nc: Client;
  private options: NATSTransportOptions<T, R>;
  private receiveHandler?: (message: RequestMessage<T> | ResponseMessage<R>) => void;
  private subjectById = new Map<number, string>();
  private serverInfo: ServerInfo;
  private chunkedMessages = new Map<string, Buffer[]>();

  private constructor(
    config: NatsConnectionOptions,
    nc: Client,
    options: NATSTransportOptions<T, R>,
    serverInfo: ServerInfo,
  ) {
    this.config = config;
    this.nc = nc;
    this.serverInfo = serverInfo;
    this.options = options;
  }

  public async close(): Promise<void> {
    const clientPoolKey = hash(this.config);
    const clientInfo = clients.get(clientPoolKey);
    if (clientInfo) {
      const [nc, serverInfo, refCount] = clientInfo;
      if (refCount > 1) {
        clients.set(clientPoolKey, [nc, serverInfo, refCount - 1]);
      } else {
        log('Closing NATS connection: ', this.config);
        this.nc.close();
        clients.delete(clientPoolKey);
      }
    }
  }

  public async send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void> {
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

    const marshalledMessage = this.marshall(message);

    if (this.config.payload === Payload.BINARY && (marshalledMessage as Buffer).length > this.serverInfo.max_payload) {
      this.sendMessageInChunks(subject, marshalledMessage as Buffer);
    } else {
      this.nc.publish(subject, marshalledMessage);
    }
  }

  public onReceive(receiveHandler: (message: RequestMessage<T> | ResponseMessage<R>) => void): void {
    this.receiveHandler = receiveHandler;
  }

  private marshall(message: RequestMessage<T> | ResponseMessage<R>): unknown {
    if (this.config.payload === Payload.JSON) {
      return annotate(message);
    } else if (this.config.payload === Payload.STRING) {
      return serialize(message);
    } else if (this.config.payload === Payload.BINARY) {
      return Buffer.from(serialize(message), 'utf-8');
    }
    throw new Error(`Unsupported payload type: ${this.config.payload}`);
  }

  private unmarshall(data: unknown): RequestMessage<T> | ResponseMessage<R> {
    if (this.config.payload === Payload.JSON) {
      return deannotate(data);
    } else if (this.config.payload === Payload.STRING) {
      return deserialize(data as string);
    } else if (this.config.payload === Payload.BINARY) {
      return deserialize((data as Buffer).toString('utf-8'));
    }
    throw new Error(`Unsupported payload type: ${this.config.payload}`);
  }

  private async initialize(): Promise<void> {
    await Promise.all(
      this.options.subscriptions.map(
        (subject): Promise<Subscription> =>
          this.nc.subscribe(subject, (_, msg) => {
            if (this.receiveHandler) {
              if (this.config.payload === Payload.BINARY && (msg.data as Buffer).indexOf(CHUNK_HEADER_PREFIX) === 0) {
                this.receiveMessageChunk(msg.data);
              } else {
                const message = this.unmarshall(msg.data);
                if (logTraffic) {
                  log('RECEIVE [%s] %O', subject, message);
                }
                this.receiveHandler(message);
              }
            }
          }),
      ),
    );
  }

  /**
   * |----- ? bytes -----|| 16 ||  1  ||  1  |
   * [CHUNK_HEADER_PREFIX][uuid][index][total]
   */
  private sendMessageInChunks(subject: string, marshalledMessage: Buffer): void {
    const chunkHeaderLen = CHUNK_HEADER_PREFIX.length + 18;
    const chunkBodyLen = this.serverInfo.max_payload - chunkHeaderLen;
    const numChunks = Math.ceil(marshalledMessage.length / chunkBodyLen);

    const uuidBuf: number[] = [];
    uuid(undefined, uuidBuf);

    for (let i = 0; i < numChunks; i++) {
      const chunkHeader = Buffer.concat(
        [CHUNK_HEADER_PREFIX, Buffer.from(uuidBuf), Buffer.from([i, numChunks])],
        chunkHeaderLen,
      );
      const chunkBody = marshalledMessage.slice(
        i * chunkBodyLen,
        Math.min((i + 1) * chunkBodyLen, marshalledMessage.length),
      );
      this.nc.publish(subject, Buffer.concat([chunkHeader, chunkBody]));
    }
  }

  private receiveMessageChunk(chunkBuf: Buffer): void {
    if (!this.receiveHandler) {
      return;
    }

    const prefixLen = CHUNK_HEADER_PREFIX.length;
    const uuidStr = hash(chunkBuf.slice(prefixLen, prefixLen + 16));
    const [chunkIndex, numChunks] = chunkBuf.slice(prefixLen + 16, prefixLen + 18);

    let chunkedMessage = this.chunkedMessages.get(uuidStr);
    if (!chunkedMessage) {
      chunkedMessage = new Array<Buffer>(numChunks);
      this.chunkedMessages.set(uuidStr, chunkedMessage);
    }

    chunkedMessage[chunkIndex] = chunkBuf.slice(prefixLen + 18);

    if (chunkedMessage.length === chunkedMessage.filter(Boolean).length) {
      this.receiveHandler(this.unmarshall(Buffer.concat(chunkedMessage)));
      this.chunkedMessages.delete(uuidStr);
    }
  }
}
