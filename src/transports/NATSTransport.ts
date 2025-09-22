import { createLogger } from "@phnq/log";
import {
  type ConnectionOptions,
  connect,
  JSONCodec,
  type NatsConnection,
  type SubscriptionOptions,
} from "nats";
import hash from "object-hash";
import { v4 as uuid } from "uuid";

import {
  type MessageTransport,
  MessageType,
  type RequestMessage,
  type ResponseMessage,
} from "../MessageTransport";
import { annotate, deannotate } from "../serialize";

const log = createLogger("NATSTransport");

const logTraffic = process.env.PHNQ_MESSAGE_LOG_NATS === "1";

const CHUNK_HEADER_PREFIX = new Uint8Array(Buffer.from("@phnq/message/chunk", "utf-8"));

export interface NATSTransportConnectionOptions extends ConnectionOptions {
  monitorUrl?: string;
  /**
   * Sets the maximum count of per-server initial connect attempts before giving up
   * and throwing an error.
   * Set to `-1` to never give up.
   *
   * @default 1
   */
  maxConnectAttempts?: number;
  /**
   * Set the number of millisecods between initial connect attempts.
   *
   * @default 2000 millis
   */
  connectTimeWait?: number;
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

const connectToNats = async (config: NATSTransportConnectionOptions): Promise<NatsConnection> => {
  const maxConnectAttempts = config.maxConnectAttempts || 1;
  const connectTimeWait = config.connectTimeWait || 2000;
  let connectAttempts = 0;

  while (maxConnectAttempts === -1 || connectAttempts < maxConnectAttempts) {
    try {
      return await connect(config);
    } catch (err) {
      if (maxConnectAttempts === 1) {
        throw err;
      }
      log.error("NATS connection failed: ", err);
      log("Retrying in %d ms", connectTimeWait);
      await sleep(connectTimeWait);
    }

    connectAttempts += 1;
  }
  throw new Error(`NATS connection failed after ${connectAttempts} attempts`);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class NATSTransport<T, R> implements MessageTransport<T, R> {
  public static async create<T, R>(
    config: NATSTransportConnectionOptions,
    options: NATSTransportOptions<T, R>,
  ): Promise<NATSTransport<T, R>> {
    const [nc, refCount] = clients.get(hash(config)) || [await connectToNats(config), 0];
    clients.set(hash(config), [nc, refCount + 1]);
    const natsTransport = new NATSTransport<T, R>(config, nc, options);
    natsTransport.initialize();
    return natsTransport;
  }

  private config: NATSTransportConnectionOptions;
  public readonly nc: NatsConnection;
  private options: NATSTransportOptions<T, R>;
  private maxPayload: number;
  private receiveHandler?: (message: RequestMessage<T> | ResponseMessage<R>) => void;
  private subjectById = new Map<number, string>();
  private chunkedMessages = new Map<string, Uint8Array[]>();

  private constructor(
    config: NATSTransportConnectionOptions,
    nc: NatsConnection,
    options: NATSTransportOptions<T, R>,
  ) {
    this.config = config;
    this.nc = nc;
    this.options = options;
    this.maxPayload = this.nc.info?.max_payload || 0;
    if (this.maxPayload === 0) {
      throw new Error("NATS max_payload not set");
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
        log("Closing NATS connection: ", this.config);
        await this.nc.close();
        clients.delete(clientPoolKey);
      }
    }
  }

  public async getConnections(): Promise<NATSConnection[]> {
    if (!this.config.monitorUrl) {
      throw new Error("monitorUrl not set");
    }

    const connz = (await (
      await fetch([this.config.monitorUrl, "connz"].join("/"), { headers: { Connection: "close" } })
    ).json()) as {
      connections: NATSConnection[];
    };
    return connz.connections;
  }

  public async send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void> {
    const publishSubject = this.options.publishSubject;

    let subject: string | undefined;
    if (message.t === MessageType.End) {
      subject = this.subjectById.get(message.c);
    } else {
      subject = typeof publishSubject === "string" ? publishSubject : publishSubject(message);
    }

    if (subject === undefined) {
      throw new Error("Could not get subject");
    }

    if (message.t === MessageType.End) {
      this.subjectById.delete(message.c);
    } else {
      this.subjectById.set(message.c, subject);
    }

    if (logTraffic) {
      log("PUBLISH [%s] %O", subject, message);
    }

    const marshalledMessage = this.marshall(message);

    if (marshalledMessage.length > this.maxPayload) {
      this.sendMessageInChunks(subject, marshalledMessage);
    } else {
      this.nc.publish(subject, marshalledMessage);
    }
  }

  public onReceive(
    receiveHandler: (message: RequestMessage<T> | ResponseMessage<R>) => void,
  ): void {
    this.receiveHandler = receiveHandler;
  }

  private marshall(message: RequestMessage<T> | ResponseMessage<R>): Uint8Array {
    return new Uint8Array(JSON_CODEC.encode(annotate(message)));
  }

  private unmarshall(data: Uint8Array): RequestMessage<T> | ResponseMessage<R> {
    return deannotate(JSON_CODEC.decode(data)) as RequestMessage<T> | ResponseMessage<R>;
  }

  private initialize(): void {
    this.options.subscriptions.forEach(async (subscription) => {
      const subject = typeof subscription === "string" ? subscription : subscription.subject;
      const options = typeof subscription === "string" ? undefined : subscription.options;
      const sub = this.nc.subscribe(subject, options);
      for await (const msg of sub) {
        if (this.receiveHandler) {
          const msgData = msg.data;
          if (CHUNK_HEADER_PREFIX.some((b, i) => msgData[i] !== b)) {
            const message = this.unmarshall(msgData);
            if (logTraffic) {
              log("RECEIVE [%s] %O", subject, message);
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
      const bufs = [
        CHUNK_HEADER_PREFIX,
        new Uint8Array(Buffer.from(uuidBuf)),
        new Uint8Array([i, numChunks]),
      ];
      const chunkHeader = new Uint8Array(Buffer.concat(bufs, chunkHeaderLen));
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

    if (typeof chunkIndex !== "number" || typeof numChunks !== "number") {
      log.error("Invalid chunk index or total in message chunk: ", chunkBuf);
      return;
    }

    let chunkedMessage = this.chunkedMessages.get(uuidStr);
    if (!chunkedMessage) {
      chunkedMessage = new Array<Uint8Array>(numChunks);
      this.chunkedMessages.set(uuidStr, chunkedMessage);
    }

    chunkedMessage[chunkIndex] = chunkBuf.slice(prefixLen + 18);

    if (chunkedMessage.length === chunkedMessage.filter(Boolean).length) {
      this.receiveHandler(this.unmarshall(new Uint8Array(Buffer.concat(chunkedMessage))));
      this.chunkedMessages.delete(uuidStr);
    }
  }
}

export default NATSTransport;
