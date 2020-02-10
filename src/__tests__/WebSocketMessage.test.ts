import http from 'http';

import { MessageConnection } from '../MessageConnection';
import { WebSocketMessageClient } from '../WebSocketMessageClient';
import { ConnectionId, WebSocketMessageServer } from '../WebSocketMessageServer';

// const wait = (millis: number = 0): Promise<void> =>
//   new Promise(resolve => {
//     setTimeout(resolve, millis);
//   });

describe('MessageConnection', (): void => {
  describe('with WebSocketTransport', (): void => {
    it('should handle multiple responses with an iterator', async (): Promise<void> => {
      const httpServer = http.createServer();
      await new Promise((resolve): void => {
        httpServer.listen({ port: 55556 }, resolve);
      });

      const wsms = new WebSocketMessageServer({
        httpServer,
        onReceive: async (connectionId: ConnectionId, message: string): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');
            expect(wsms.getConnection(connectionId)).toBeInstanceOf(MessageConnection);

            yield "who's";
            yield 'there';
            yield '?';
          })(),
      });

      const clientConnection = WebSocketMessageClient.create('ws://localhost:55556');

      const resps1 = [];
      for await (const resp of await clientConnection.requestMulti('knock knock')) {
        resps1.push(resp);
      }

      expect(resps1).toEqual(["who's", 'there', '?']);

      const resps2 = [];
      for await (const resp of await clientConnection.requestMulti('knock knock')) {
        resps2.push(resp);
      }

      expect(resps2).toEqual(["who's", 'there', '?']);

      await clientConnection.close();

      await wsms.close();

      await new Promise((resolve): void => {
        httpServer.close(resolve);
      });
    });

    it('should close the socket if the wrong path is specified', async (): Promise<void> => {
      const httpServer = http.createServer();
      await new Promise((resolve): void => {
        httpServer.listen({ port: 55556 }, resolve);
      });

      const wsms = new WebSocketMessageServer({
        httpServer,
        onReceive: async (message: string): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })(),
        path: '/the-path',
      });

      const clientConnection = WebSocketMessageClient.create('ws://localhost:55556/the-wrong-path');

      await new Promise((resolve): void => {
        clientConnection.onClose = () => {
          resolve();
          return false;
        };
      });

      expect(await clientConnection.isOpen()).toBe(false);

      await clientConnection.close();

      await wsms.close();

      await new Promise((resolve): void => {
        httpServer.close(resolve);
      });
    });

    it('should re-open the socket on the next request after being closed', async (): Promise<void> => {
      const httpServer = http.createServer();
      await new Promise((resolve): void => {
        httpServer.listen({ port: 55556 }, resolve);
      });

      const wsms = new WebSocketMessageServer({
        httpServer,
        onReceive: async (connectionId: ConnectionId, message: string): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');
            expect(wsms.getConnection(connectionId)).toBeInstanceOf(MessageConnection);

            yield "who's";
            yield 'there';
            yield '?';
          })(),
      });

      const clientConnection = WebSocketMessageClient.create('ws://localhost:55556');

      const resps1 = [];
      for await (const resp of await clientConnection.requestMulti('knock knock')) {
        resps1.push(resp);
      }

      expect(resps1).toEqual(["who's", 'there', '?']);

      await clientConnection.close();

      const resps2 = [];
      for await (const resp of await clientConnection.requestMulti('knock knock')) {
        resps2.push(resp);
      }

      expect(resps2).toEqual(["who's", 'there', '?']);

      await clientConnection.close();

      await wsms.close();

      await new Promise((resolve): void => {
        httpServer.close(resolve);
      });
    });

    it('should share client connections for the same url', async (): Promise<void> => {
      const httpServer = http.createServer();
      await new Promise((resolve): void => {
        httpServer.listen({ port: 55556 }, resolve);
      });

      const wsms = new WebSocketMessageServer({
        httpServer,
        onReceive: async (connectionId: ConnectionId, message: string): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');
            expect(wsms.getConnection(connectionId)).toBeInstanceOf(MessageConnection);

            yield "who's";
            yield 'there';
            yield '?';
          })(),
      });

      const clientConnection1 = WebSocketMessageClient.create<string>('ws://localhost:55556');
      const clientConnection2 = WebSocketMessageClient.create<string>('ws://localhost:55556');

      expect(clientConnection1 === clientConnection2).toBe(true);

      await Promise.all([
        new Promise(async resolve => {
          const resps1 = [];
          for await (const resp of await clientConnection1.requestMulti('knock knock')) {
            resps1.push(resp);
          }
          expect(resps1).toEqual(["who's", 'there', '?']);
          resolve();
        }),
        new Promise(async resolve => {
          const resps2 = [];
          for await (const resp of await clientConnection2.requestMulti('knock knock')) {
            resps2.push(resp);
          }
          expect(resps2).toEqual(["who's", 'there', '?']);
          resolve();
        }),
      ]);

      await clientConnection1.close();
      await clientConnection2.close();

      await wsms.close();

      await new Promise((resolve): void => {
        httpServer.close(resolve);
      });
    });
  });
});
