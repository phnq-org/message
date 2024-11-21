import http from 'http';
import https from 'https';
import WebSocket from 'isomorphic-ws';

import { MessageConnection } from './MessageConnection';
import { ServerWebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

type ConnectHandler<T, R, A = never> = (
  conn: MessageConnection<T, R, A>,
  upgradeRequest: http.IncomingMessage,
) => Promise<void>;
type ReceiveHandler<T, R, A = never> = (
  conn: MessageConnection<T, R, A>,
  message: T,
) => Promise<R | AsyncIterableIterator<R>>;

interface Config {
  httpServer: http.Server | https.Server;
  path?: string;
}

export class WebSocketMessageServer<T = unknown, R = T, A = never> {
  private wss: WebSocket.Server;
  public onConnect: ConnectHandler<T, R, A> = async () => undefined;
  public onReceive: ReceiveHandler<T, R, A> = async () => {
    throw new Error('WebSocketMessageServer.onReceive not set');
  };
  private connectionsById = new Map<ConnectionId, MessageConnection<T, R, A>>();

  public constructor({ httpServer, path = '/' }: Config) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId): MessageConnection<T, R, A> | undefined {
    return this.connectionsById.get(id);
  }

  public get connections(): MessageConnection<T, R, A>[] {
    return [...this.connectionsById.values()];
  }

  public async close(): Promise<void> {
    for (const connection of this.connections) {
      await connection.transport.close();
    }

    await new Promise((resolve, reject): void => {
      try {
        this.wss.close(resolve);
      } catch (err) {
        reject(err);
      }
    });
  }

  private start(path: string): void {
    this.wss.on('connection', async (socket: WebSocket, req: http.IncomingMessage): Promise<void> => {
      if (req.url !== path) {
        socket.close(1008, `unsupported path: ${req.url}`);
        return;
      }

      const connection = new MessageConnection<T, R, A>(new ServerWebSocketTransport<T, R>(socket));

      this.connectionsById.set(connection.id, connection);

      connection.onReceive = (message: T): Promise<R | AsyncIterableIterator<R>> => this.onReceive(connection, message);

      await this.onConnect(connection, req);

      socket.addListener('close', () => {
        this.connectionsById.delete(connection.id);
      });
    });
  }
}
