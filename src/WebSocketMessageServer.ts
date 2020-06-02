import http from 'http';
import WebSocket from 'isomorphic-ws';

import { MessageConnection } from './MessageConnection';
import { ServerWebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

type ConnectHandler = (connectionId: ConnectionId, upgradeRequest: http.IncomingMessage) => Promise<void>;
type ReceiveHandler<T> = (connectionId: ConnectionId, message: T) => Promise<T | AsyncIterableIterator<T>>;

interface Config<T> {
  httpServer: http.Server;
  onConnect?: ConnectHandler;
  onReceive: ReceiveHandler<T>;
  path?: string;
}

export class WebSocketMessageServer<T = unknown> {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private connectHandler?: ConnectHandler;
  private receiveHandler: ReceiveHandler<T>;
  private connections = new Map<ConnectionId, MessageConnection<T>>();

  public constructor({ httpServer, onConnect, onReceive, path = '/' }: Config<T>) {
    this.httpServer = httpServer;
    this.connectHandler = onConnect;
    this.receiveHandler = onReceive;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId): MessageConnection<T> | undefined {
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

        const connection = new MessageConnection<T>(new ServerWebSocketTransport(socket));

        this.connections.set(connection.id, connection);

        connection.onReceive(
          (message: T): Promise<T | AsyncIterableIterator<T>> => this.receiveHandler(connection.id, message),
        );

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
