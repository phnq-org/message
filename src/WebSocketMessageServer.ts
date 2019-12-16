import http from 'http';
import WebSocket from 'isomorphic-ws';
import net from 'net';
import uuid from 'uuid/v4';

import { MessageConnection } from './MessageConnection';
import { WebSocketTransport } from './transports/WebSocketTransport';

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
  }

  private start(path: string): void {
    this.httpServer.on('upgrade', (req: http.IncomingMessage, socket: net.Socket): void => {
      if (req.url !== path) {
        socket.destroy();
      }
    });

    this.wss.on(
      'connection',
      async (socket: WebSocket, req: http.IncomingMessage): Promise<void> => {
        const connection = new MessageConnection<T>(new WebSocketTransport(socket));

        const connectionId = uuid();

        this.connections.set(connectionId, connection);

        connection.onReceive(
          (message: T): Promise<T | AsyncIterableIterator<T>> => this.receiveHandler(connectionId, message),
        );

        if (this.connectHandler) {
          await this.connectHandler(connectionId, req);
        }
      },
    );
  }
}
