import http from 'http';
import net from 'net';
import WebSocket from 'ws';
import { Anomaly } from './anomaly';
import { IValue, MessageType, MultiData } from './constants';
import { deserialize, serialize } from './serialize';

type MessageHandler = (type: string, data: IValue, conn: IConnection) => Promise<IValue | MultiData>;

export class MessageServer {
  public onConnect?: (conn: IConnection) => void;
  public onMessage?: MessageHandler;
  private wss?: WebSocket.Server;

  constructor(httpServer: http.Server, path?: string) {
    this.wss = undefined;
    this.setHttpServer(httpServer, path);
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wss) {
        this.wss.close(err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  }

  private setHttpServer(httpServer: http.Server, path: string = '/') {
    httpServer.on('upgrade', (req: http.IncomingMessage, socket: net.Socket) => {
      if (req.url !== path) {
        socket.destroy();
      }
    });

    // Create the WebSocket server
    this.wss = new WebSocket.Server({ server: httpServer });

    // When a connection is made...
    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      // Instantiate a Connection object to hold state
      let connection: IConnection | undefined = new Connection(ws, req.headers, this.onMessage);

      // Close socket from within the connection
      connection.onClose(() => {
        connection = undefined;
      });

      // Notify of new connections
      if (this.onConnect) {
        this.onConnect(connection);
      }
    });
  }
}

export interface IConnection {
  getUpgradeHeaders(): http.IncomingHttpHeaders;
  push(type: string, data: IValue): Promise<void>;
  close(): void;
  onClose(fn: () => void): void;
  get(key: string): any;
  set(key: string, value: any): void;
}

/* tslint:disable max-classes-per-file */
class Connection {
  private ws: WebSocket;
  private headers: http.IncomingHttpHeaders;
  private onMessage?: MessageHandler;
  private state: Map<string, any>;
  private onCloses: Set<() => void>;

  constructor(ws: WebSocket, headers: http.IncomingHttpHeaders, onMessage?: MessageHandler) {
    this.ws = ws;
    this.headers = headers;
    this.onMessage = onMessage;
    this.state = new Map<string, any>();
    this.onCloses = new Set();

    this.ws.on('close', this.onCloseFn);
    this.ws.on('message', this.onMessageFn);
  }

  public getUpgradeHeaders(): http.IncomingHttpHeaders {
    return this.headers;
  }

  public async send(message: { type: MessageType; id: string; data: IValue }) {
    this.ws.send(serialize(message));
  }

  public async push(type: string, data: IValue) {
    this.ws.send(serialize({ type, data }));
  }

  public onClose(fn: () => void) {
    this.onCloses.add(fn);
  }

  public close() {
    this.ws.close(1000, 'Closed by server');
  }

  public get(key: string): any {
    return this.state.get(key);
  }

  public set(key: string, value: any): void {
    this.state.set(key, value);
  }

  private destroy() {
    this.onCloses.clear();
  }

  private onCloseFn = () => {
    this.onCloses.forEach(o => o());
    this.destroy();
  };

  private onMessageFn = async (messageRaw: string) => {
    const { id, type, data } = deserialize(messageRaw);

    try {
      if (!this.onMessage) {
        throw new Error('No message handler configured');
      }

      const resp = await this.onMessage(type, data, this);

      if (typeof resp === 'function') {
        const respDataIterator = resp() as AsyncIterableIterator<any>;

        await this.send({ type: MessageType.MultiBegin, id, data: {} });

        let prev = null;

        for await (const respData of respDataIterator) {
          if (prev) {
            await wait();
            await this.send({
              data: respData,
              id,
              type: MessageType.MultiResponse,
            });
          } else {
            await wait();
            await this.send({
              data: respData,
              id,
              type: MessageType.MultiResponse,
            });
          }
          prev = respData;
        }

        await wait();
        await this.send({ type: MessageType.MultiEnd, id, data: {} });
      } else {
        const respData = resp;
        await this.send({ type: MessageType.Response, id, data: respData });
      }
    } catch (err) {
      if (err instanceof Anomaly) {
        await this.send({
          data: {
            data: err.data,
            message: err.message,
          },
          id,
          type: MessageType.Anomaly,
        });
      } else {
        await this.send({
          data: {
            message: err.message,
          },
          id,
          type: MessageType.InternalError,
        });
      }
    }
  };
}

const wait = async (millis: number = 0): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });

export default MessageServer;
