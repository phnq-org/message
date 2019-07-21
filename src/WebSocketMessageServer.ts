import http from 'http';
import WebSocket from 'isomorphic-ws';
import net from 'net';
import uuid from 'uuid/v4';
import { IValue, MessageConnection } from './MessageConnection';
import { WebSocketTransport } from './transports/WebSocketTransport';

export type ConnectionId = string;

interface IConfig<R> {
  httpServer: http.Server;
  onReceive: (connectionId: ConnectionId, message: R) => AsyncIterableIterator<IValue> | Promise<IValue | undefined>;
  path?: string;
}

export class WebSocketMessageServer<R> {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private receiveHandler: (
    connectionId: ConnectionId,
    message: R,
  ) => AsyncIterableIterator<IValue> | Promise<IValue | undefined>;
  private connections = new Map<ConnectionId, MessageConnection>();

  constructor({ httpServer, onReceive, path = '/' }: IConfig<R>) {
    this.httpServer = httpServer;
    this.receiveHandler = onReceive;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
  }

  public getConnection(id: ConnectionId) {
    return this.connections.get(id);
  }

  public async close() {
    await new Promise(resolve => {
      this.wss.close(resolve);
    });
  }

  private start(path: string) {
    this.httpServer.on('upgrade', (req: http.IncomingMessage, socket: net.Socket) => {
      if (req.url !== path) {
        socket.destroy();
      }
    });

    this.wss.on('connection', (socket: WebSocket) => {
      const connection = new MessageConnection(new WebSocketTransport(socket));

      const connectionId = uuid();

      this.connections.set(connectionId, connection);

      connection.onReceive<R>((message: R) => {
        return this.receiveHandler(connectionId, message);
      });
    });
  }
}
