import http from 'http';
import WebSocket from 'isomorphic-ws';
import net from 'net';
import uuid from 'uuid/v4';
import { Value, MessageConnection, ResponseMapper } from './MessageConnection';
import { WebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

interface Config {
  httpServer: http.Server;
  onReceive: (connectionId: ConnectionId, message: Value) => AsyncIterableIterator<Value> | Promise<Value>;
  path?: string;
}

export class WebSocketMessageServer {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private receiveHandler: (connectionId: ConnectionId, message: Value) => AsyncIterableIterator<Value> | Promise<Value>;
  private connections = new Map<ConnectionId, MessageConnection>();
  private responseMappers: ResponseMapper[] = [];

  public constructor({ httpServer, onReceive, path = '/' }: Config) {
    this.httpServer = httpServer;
    this.receiveHandler = onReceive;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId): MessageConnection | undefined {
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
      const connection = new MessageConnection(new WebSocketTransport(socket));

      this.responseMappers.forEach((mapper): void => {
        connection.addResponseMapper(mapper);
      });

      const connectionId = uuid();

      this.connections.set(connectionId, connection);

      connection.onReceive((message: Value): AsyncIterableIterator<Value> | Promise<Value> =>
        this.receiveHandler(connectionId, message)
      );
    });
  }
}
