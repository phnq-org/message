import http from 'http';
import WebSocket from 'isomorphic-ws';
import net from 'net';
import uuid from 'uuid/v4';
import { Value, MessageConnection } from './MessageConnection';
import { WebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

interface Config<T> {
  httpServer: http.Server;
  onReceive: (connectionId: ConnectionId, message: T) => Promise<T | AsyncIterableIterator<T>>;
  path?: string;
}

export class WebSocketMessageServer<T extends Value> {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private receiveHandler: (connectionId: ConnectionId, message: T) => Promise<T | AsyncIterableIterator<T>>;
  private connections = new Map<ConnectionId, MessageConnection<T>>();

  public constructor({ httpServer, onReceive, path = '/' }: Config<T>) {
    this.httpServer = httpServer;
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

    this.wss.on('connection', (socket: WebSocket): void => {
      const connection = new MessageConnection<T>(new WebSocketTransport(socket));

      const connectionId = uuid();

      this.connections.set(connectionId, connection);

      connection.onReceive(
        (message: T): Promise<T | AsyncIterableIterator<T>> => this.receiveHandler(connectionId, message)
      );
    });
  }
}
