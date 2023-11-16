import { createLogger } from '@phnq/log';
import { get } from 'http';
import { connect, ConnectionOptions, JSONCodec, NatsConnection, SubscriptionOptions } from 'nats';
import hash from 'object-hash';
import { v4 as uuid } from 'uuid';

import { MessageTransport, MessageType, RequestMessage, ResponseMessage } from '../MessageTransport';
import { annotate, deannotate } from '../serialize';

const log = createLogger('NATSTransport');

const logTraffic = process.env.PHNQ_MESSAGE_LOG_NATS === '1';

const CHUNK_HEADER_PREFIX = Buffer.from('@phnq/message/chunk', 'utf-8');

interface NATSTransportConnectionOptions extends ConnectionOptions {
  monitorUrl?: string;
}

interface NATSConnection {
  name?: string;
  lang: string;
  version: string;
  subscriptions: number;
  uptime: string;
  ip: string;
  cid: number;
  port: number;
  rtt: string;
}

type SubjectResolver<T, R> = (message: RequestMessage<T> | ResponseMessage<R>) => string;

interface NATSTransportOptions<T, R> {
  subscriptions: (string | { subject: string; options: SubscriptionOptions })[];
  publishSubject: string | SubjectResolver<T, R>;
}

// Keep track of clients by config hash so they can be shared
const clients = new Map<string, [NatsConnection, number]>();

const JSON_CODEC = JSONCodec();

export class NATSTransport<T, R> implements MessageTransport<T, R> {
  public static async create<T, R>(
    config: NATSTransportConnectionOptions,
    options: NATSTransportOptions<T, R>,
  ): Promise<NATSTransport<T, R>> {
    const [nc, refCount] = clients.get(hash(config)) || [await connect(config), 0];
    clients.set(hash(config), [nc, refCount + 1]);
    const natsTransport = new NATSTransport<T, R>(config, nc, options);
    natsTransport.initialize();
    return natsTransport;
  }

  private config: NATSTransportConnectionOptions;
  private nc: NatsConnection;
  private options: NATSTransportOptions<T, R>;
  private maxPayload: number;
  private receiveHandler?: (message: RequestMessage<T> | ResponseMessage<R>) => void;
  private subjectById = new Map<number, string>();
  private chunkedMessages = new Map<string, Uint8Array[]>();

  private constructor(config: NATSTransportConnectionOptions, nc: NatsConnection, options: NATSTransportOptions<T, R>) {
    this.config = config;
    this.nc = nc;
    this.options = options;
    this.maxPayload = this.nc.info?.max_payload || 0;
    if (this.maxPayload === 0) {
      throw new Error('NATS max_payload not set');
    }
  }

  public async close(): Promise<void> {
    const clientPoolKey = hash(this.config);
    const clientInfo = clients.get(clientPoolKey);
    if (clientInfo) {
      const [nc, refCount] = clientInfo;
      if (refCount > 1) {
        clients.set(clientPoolKey, [nc, refCount - 1]);
      } else {
        log('Closing NATS connection: ', this.config);
        this.nc.close();
        clients.delete(clientPoolKey);
      }
    }
  }

  public async getConnections(): Promise<NATSConnection[]> {
    if (!this.config.monitorUrl) {
      throw new Error('monitorUrl not set');
    }

    return new Promise<NATSConnection[]>(resolve => {
      get([this.config.monitorUrl, 'connz'].join('/'), res => {
        const chunks: Uint8Array[] = [];
        res.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          const { connections } = JSON.parse(Buffer.concat(chunks).toString()) as { connections: NATSConnection[] };
          resolve(connections);
        });
      });
    });
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

    if (marshalledMessage.length > this.maxPayload) {
      this.sendMessageInChunks(subject, marshalledMessage);
    } else {
      this.nc.publish(subject, marshalledMessage);
    }
  }

  public onReceive(receiveHandler: (message: RequestMessage<T> | ResponseMessage<R>) => void): void {
    this.receiveHandler = receiveHandler;
  }

  private marshall(message: RequestMessage<T> | ResponseMessage<R>): Uint8Array {
    return new Uint8Array(JSON_CODEC.encode(annotate(message)));
  }

  private unmarshall(data: Uint8Array): RequestMessage<T> | ResponseMessage<R> {
    return deannotate(JSON_CODEC.decode(data)) as RequestMessage<T> | ResponseMessage<R>;
  }

  private initialize(): void {
    this.options.subscriptions.forEach(async subscription => {
      const subject = typeof subscription === 'string' ? subscription : subscription.subject;
      const options = typeof subscription === 'string' ? undefined : subscription.options;
      const sub = this.nc.subscribe(subject, options);
      for await (const msg of sub) {
        if (this.receiveHandler) {
          const msgData = msg.data;
          if (CHUNK_HEADER_PREFIX.some((b, i) => msgData[i] !== b)) {
            const message = this.unmarshall(msgData);
            if (logTraffic) {
              log('RECEIVE [%s] %O', subject, message);
            }
            this.receiveHandler(message);
          } else {
            this.receiveMessageChunk(msgData);
          }
        }
      }
    });
  }

  /**
   * |----- ? bytes -----|| 16 ||  1  ||  1  |
   * [CHUNK_HEADER_PREFIX][uuid][index][total]
   */
  private sendMessageInChunks(subject: string, marshalledMessage: Uint8Array): void {
    const chunkHeaderLen = CHUNK_HEADER_PREFIX.length + 18;
    const chunkBodyLen = this.maxPayload - chunkHeaderLen;
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
      this.nc.publish(subject, new Uint8Array(Buffer.concat([chunkHeader, chunkBody])));
    }
  }

  private receiveMessageChunk(chunkBuf: Uint8Array): void {
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
