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
  private connections = new Map<number, IConnection>();

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

  public getConnectionById(id: number): IConnection | undefined {
    return this.connections.get(id);
  }

  public getConnections() {
    return [...this.connections.values()];
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

      this.connections.set(connection.getId(), connection);

      // Close socket from within the connection
      connection.onClose(() => {
        if (connection) {
          this.connections.delete(connection.getId());
        }
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
  getId(): number;
  getUpgradeHeaders(): http.IncomingHttpHeaders;
  send(type: MessageType, id: string, data: IValue): void;
  push(type: string, data: IValue): void;
  close(): void;
  onClose(fn: () => void): void;
  get(key: string): any;
  set(key: string, value: any): void;
}

const connectionId = (function* connectionIdGen() {
  let i = 0;
  while (true) {
    i += 1;
    yield i;
  }
})();

/* tslint:disable max-classes-per-file */
class Connection {
  private id: number;
  private ws: WebSocket;
  private headers: http.IncomingHttpHeaders;
  private onMessage?: MessageHandler;
  private state: Map<string, any>;
  private onCloses: Set<() => void>;

  constructor(ws: WebSocket, headers: http.IncomingHttpHeaders, onMessage?: MessageHandler) {
    this.id = connectionId.next().value;
    this.ws = ws;
    this.headers = headers;
    this.onMessage = onMessage;
    this.state = new Map<string, any>();
    this.onCloses = new Set();

    this.ws.on('close', this.onCloseFn);
    this.ws.on('message', this.onMessageFn);
  }

  public getId() {
    return this.id;
  }

  public getUpgradeHeaders(): http.IncomingHttpHeaders {
    return this.headers;
  }

  public send(type: MessageType, id: string, data: IValue) {
    this.ws.send(serialize({ type, id, data }));
  }

  public push(type: string, data: IValue) {
    this.ws.send(serialize({ type, data }));
  }

  public onClose(fn: () => void) {
    this.onCloses.add(fn);
  }

  public close() {
    // this allows the response to be sent before closing.
    setTimeout(() => {
      this.ws.close(1000, 'Closed by server');
    }, 0);
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

        this.send(MessageType.MultiBegin, id, {});

        for await (const respData of respDataIterator) {
          await wait();
          this.send(MessageType.MultiResponse, id, respData);
        }

        await wait();
        this.send(MessageType.MultiEnd, id, {});
      } else {
        const respData = resp;
        this.send(MessageType.Response, id, respData);
      }
    } catch (err) {
      if (err instanceof Anomaly) {
        this.send(MessageType.Anomaly, id, { data: err.data, message: err.message });
      } else {
        this.send(MessageType.InternalError, id, { message: err.message });
      }
    }
  };
}

const wait = async (millis: number = 0): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });

export default MessageServer;
