import http from 'http';
import WebSocket from 'isomorphic-ws';

import { MessageConnection } from './MessageConnection';
import { ServerWebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

type ConnectHandler = (connectionId: ConnectionId, upgradeRequest: http.IncomingMessage) => Promise<void>;
type ReceiveHandler<T, R> = (connectionId: ConnectionId, message: T) => Promise<R | AsyncIterableIterator<R>>;

interface Config<T, R> {
  httpServer: http.Server;
  onConnect?: ConnectHandler;
  onReceive: ReceiveHandler<T, R>;
  path?: string;
}

export class WebSocketMessageServer<T = unknown, R = T> {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private connectHandler?: ConnectHandler;
  private receiveHandler: ReceiveHandler<T, R>;
  private connections = new Map<ConnectionId, MessageConnection<T, R>>();

  public constructor({ httpServer, onConnect, onReceive, path = '/' }: Config<T, R>) {
    this.httpServer = httpServer;
    this.connectHandler = onConnect;
    this.receiveHandler = onReceive;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId): MessageConnection<T, R> | undefined {
    return this.connections.get(id);
  }

  public async close(): Promise<void> {
    await new Promise((resolve): void => {
      this.wss.close(resolve);
    });
    await new Promise((resolve): void => {
      this.httpServer.close(resolve);
    });
  }

  private start(path: string): void {
    this.wss.on(
      'connection',
      async (socket: WebSocket, req: http.IncomingMessage): Promise<void> => {
        if (req.url !== path) {
          socket.close(1008, 'Wrong path');
          return;
        }

        const connection = new MessageConnection<T, R>(new ServerWebSocketTransport<T, R>(socket));

        this.connections.set(connection.id, connection);

        connection.onReceive = (message: T): Promise<R | AsyncIterableIterator<R>> =>
          this.receiveHandler(connection.id, message);

        if (this.connectHandler) {
          await this.connectHandler(connection.id, req);
        }

        socket.addEventListener('close', () => {
          this.connections.delete(connection.id);
        });
      },
    );
  }
}
