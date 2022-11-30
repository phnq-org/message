import http from 'http';
import WebSocket from 'isomorphic-ws';

import { MessageConnection } from './MessageConnection';
import { ServerWebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

type ConnectHandler<T, R> = (conn: MessageConnection<T, R>, upgradeRequest: http.IncomingMessage) => Promise<void>;
type ReceiveHandler<T, R> = (conn: MessageConnection<T, R>, message: T) => Promise<R | AsyncIterableIterator<R>>;

interface Config {
  httpServer: http.Server;
  path?: string;
}

export class WebSocketMessageServer<T = unknown, R = T> {
  private wss: WebSocket.Server;
  public onConnect: ConnectHandler<T, R> = async () => undefined;
  public onReceive: ReceiveHandler<T, R> = async () => {
    throw new Error('WebSocketMessageServer.onReceive not set');
  };
  private connections = new Map<ConnectionId, MessageConnection<T, R>>();

  public constructor({ httpServer, path = '/' }: Config) {
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId): MessageConnection<T, R> | undefined {
    return this.connections.get(id);
  }

  public async close(): Promise<void> {
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

      const connection = new MessageConnection<T, R>(new ServerWebSocketTransport<T, R>(socket));

      this.connections.set(connection.id, connection);

      connection.onReceive = (message: T): Promise<R | AsyncIterableIterator<R>> => this.onReceive(connection, message);

      await this.onConnect(connection, req);

      socket.addEventListener('close', () => {
        this.connections.delete(connection.id);
      });
    });
  }
}
