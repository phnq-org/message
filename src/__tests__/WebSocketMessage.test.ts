import http from 'http';

import { Value, WebSocketMessageClient } from '../index.client';
import { WebSocketMessageServer } from '../index.server';
import { MessageConnection } from '../MessageConnection';
import { ConnectionId } from '../WebSocketMessageServer';

describe('MessageConnection', (): void => {
  describe('with WebSocketTransport', (): void => {
    it('should handle multiple responses with an iterator', async (): Promise<void> => {
      const httpServer = http.createServer();
      await new Promise((resolve): void => {
        httpServer.listen({ port: 55556 }, resolve);
      });

      const wsms = new WebSocketMessageServer({
        httpServer,
        onReceive: async (connectionId: ConnectionId, message: Value): Promise<AsyncIterableIterator<Value>> =>
          (async function*(): AsyncIterableIterator<Value> {
            expect(message).toBe('knock knock');
            expect(wsms.getConnection(connectionId)).toBeInstanceOf(MessageConnection);

            yield "who's";
            yield 'there';
            yield '?';
          })(),
      });

      const clientConnection = await WebSocketMessageClient.create('ws://localhost:55556');

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

      const clientConnection = await WebSocketMessageClient.create('ws://localhost:55556/the-wrong-path');

      await new Promise((resolve): void => {
        clientConnection.onClose = resolve;
      });

      expect(clientConnection.isOpen()).toBe(false);

      await wsms.close();

      await new Promise((resolve): void => {
        httpServer.close(resolve);
      });
    });
  });
});

// const wait = (millis: number = 0) =>
//   new Promise(resolve => {
//     setTimeout(resolve, millis);
//   });
