import http from 'http';
import WebSocket from 'isomorphic-ws';
import net from 'net';
import uuid from 'uuid/v4';
import { Value, MessageConnection, ResponseMapper } from './MessageConnection';
import { WebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

interface Config<S extends Value, R extends Value> {
  httpServer: http.Server;
  onReceive: (connectionId: ConnectionId, message: R) => AsyncIterableIterator<S> | Promise<S>;
  path?: string;
}

export class WebSocketMessageServer<S extends Value, R extends Value> {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private receiveHandler: (connectionId: ConnectionId, message: R) => AsyncIterableIterator<S> | Promise<S>;
  private connections = new Map<ConnectionId, MessageConnection<S, R>>();
  private responseMappers: ResponseMapper[] = [];

  public constructor({ httpServer, onReceive, path = '/' }: Config<S, R>) {
    this.httpServer = httpServer;
    this.receiveHandler = onReceive;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId): MessageConnection<S, R> | undefined {
    return this.connections.get(id);
  }

  public async close(): Promise<void> {
    await new Promise((resolve): void => {
      this.wss.close(resolve);
    });
  }

  public addResponseMapper(mapper: ResponseMapper): void {
    this.responseMappers.push(mapper);
  }

  private start(path: string): void {
    this.httpServer.on('upgrade', (req: http.IncomingMessage, socket: net.Socket): void => {
      if (req.url !== path) {
        socket.destroy();
      }
    });

    this.wss.on('connection', (socket: WebSocket): void => {
      const connection = new MessageConnection<S, R>(new WebSocketTransport<S, R>(socket));

      this.responseMappers.forEach((mapper): void => {
        connection.addResponseMapper(mapper);
      });

      const connectionId = uuid();

      this.connections.set(connectionId, connection);

      connection.onReceive((message: R): AsyncIterableIterator<S> | Promise<S> =>
        this.receiveHandler(connectionId, message)
      );
    });
  }
}
