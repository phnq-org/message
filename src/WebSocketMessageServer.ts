import http from 'http';
import WebSocket from 'isomorphic-ws';
import net from 'net';
import { IValue, MessageConnection } from './MessageConnection';
import WebSocketTransport from './transports/WebSocketTransport';

export default class WebSocketMessageServer<R> {
  private httpServer: http.Server;
  private wss: WebSocket.Server;
  private receive: (message: R) => AsyncIterableIterator<IValue> | Promise<IValue>;
  private connections = new Map<string, MessageConnection>();

  constructor({
    httpServer,
    onReceive,
    path = '/',
  }: {
    httpServer: http.Server;
    onReceive: (message: R) => AsyncIterableIterator<IValue> | Promise<IValue>;
    path?: string;
  }) {
    this.httpServer = httpServer;
    this.receive = onReceive;
    this.wss = new WebSocket.Server({ server: httpServer });
    this.start(path);
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

      this.connections.set(connection.id, connection);

      connection.onReceive<R>(this.receive);
    });
  }
}
