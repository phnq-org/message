import http from 'http';
import WebSocket from 'ws';
import { Anomaly } from './anomaly';
import { IValue, MessageType, MultiData } from './constants';
import { deserialize, serialize } from './serialize';

export class MessageServer {
  public onConnect: (conn: Connection) => void;
  public onMessage?: (type: string, data: IValue, conn: Connection) => Promise<IValue | MultiData>;
  private wss?: WebSocket.Server;

  constructor(httpServer: http.Server, path?: string) {
    this.wss = undefined;
    this.onConnect = () => {
      return;
    };
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
      let connection: Connection | undefined = new Connection();

      // Close socket from within the connection
      connection.onClose(() => {
        ws.close(1000, 'Closed by server');
      });

      // Notify of new connections
      this.onConnect(connection);

      const send = async (message: { type: MessageType; id: string; data: IValue }) => {
        // Need this for multi responses
        await wait(0);
        ws.send(serialize(message));
      };

      // Handle incoming messages from client to connection
      ws.on('message', async (messageRaw: string) => {
        const { id, type, data } = deserialize(messageRaw);

        if (connection) {
          try {
            if (!this.onMessage) {
              throw new Error('No message handler configured');
            }

            const resp = await this.onMessage(type, data, connection);

            if (typeof resp === 'function') {
              const respDataIterator = resp() as AsyncIterableIterator<any>;

              await send({ type: MessageType.MultiBegin, id, data: {} });

              let prev = null;

              for await (const respData of respDataIterator) {
                if (prev) {
                  await send({
                    data: respData,
                    id,
                    type: MessageType.MultiResponse,
                  });
                } else {
                  await send({
                    data: respData,
                    id,
                    type: MessageType.MultiResponse,
                  });
                }
                prev = respData;
              }

              await send({ type: MessageType.MultiEnd, id, data: {} });
            } else {
              const respData = resp;
              await send({ type: MessageType.Response, id, data: respData });
            }
          } catch (err) {
            if (err instanceof Anomaly) {
              await send({
                data: {
                  data: err.data,
                  message: err.message,
                },
                id,
                type: MessageType.Anomaly,
              });
            } else {
              await send({
                data: {
                  message: err.message,
                },
                id,
                type: MessageType.InternalError,
              });
            }
          }
        }
      });

      ws.on('close', () => {
        if (connection) {
          connection.onCloses.forEach(onClose => onClose());
          connection.destroy();
        }
        connection = undefined;
      });
    });
  }
}

/* tslint:disable max-classes-per-file */
export class Connection {
  public onCloses: Set<() => void>;
  private state: Map<string, any>;

  constructor() {
    this.onCloses = new Set();
    this.state = new Map<string, any>();
  }

  public onClose(fn: () => void) {
    this.onCloses.add(fn);
  }

  public destroy() {
    this.onCloses.clear();
  }

  public get(key: string): any {
    return this.state.get(key);
  }

  public set(key: string, value: any): void {
    this.state.set(key, value);
  }
}

const wait = (millis: number) =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });

export default MessageServer;
