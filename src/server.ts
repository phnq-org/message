import http from 'http';
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

  private setHttpServer(httpServer: http.Server, path: string = '/') {
    httpServer.on('upgrade', (request, socket) => {
      if (request.url !== path) {
        socket.destroy();
      }
    });

    // Create the WebSocket server
    this.wss = new WebSocket.Server({ server: httpServer });

    // When a connection is made...
    this.wss.on('connection', ws => {
      // Instantiate a Connection object to hold state
      let connection: IConnection | undefined = new Connection(ws, this.onMessage);

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
  push(type: string, data: IValue): Promise<void>;
  close(): void;
  onClose(fn: () => void): void;
  get(key: string): any;
  set(key: string, value: any): void;
}

/* tslint:disable max-classes-per-file */
class Connection {
  private ws: WebSocket;
  private onMessage?: MessageHandler;
  private state: Map<string, any>;
  private onCloses: Set<() => void>;

  constructor(ws: WebSocket, onMessage?: MessageHandler) {
    this.ws = ws;
    this.onMessage = onMessage;
    this.state = new Map<string, any>();
    this.onCloses = new Set();

    this.ws.on('close', this.onCloseFn);
    this.ws.on('message', this.onMessageFn);
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

    if (this) {
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
    }
  };
}

const wait = async (millis: number = 0): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });

export default MessageServer;
