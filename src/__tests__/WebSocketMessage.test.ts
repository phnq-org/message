import http from 'http';
import { IValue, WebSocketMessageClient } from '../index.client';
import { WebSocketMessageServer } from '../index.server';

describe('MessageConnection', () => {
  describe('with WebSocketTransport', () => {
    it('should handle multiple responses with an iterator', async () => {
      const httpServer = http.createServer();
      await new Promise(resolve => {
        httpServer.listen({ port: 55555 }, resolve);
      });

      const wsms = new WebSocketMessageServer<string>({
        httpServer,
        onReceive: (message: string): AsyncIterableIterator<IValue> | Promise<IValue> =>
          (async function*() {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })(),
      });

      const clientConnection = await WebSocketMessageClient.create('ws://localhost:55555');

      const resps1 = [];
      for await (const resp of await clientConnection.request<string>('knock knock')) {
        resps1.push(resp);
      }

      expect(resps1).toEqual(["who's", 'there', '?']);

      const resps2 = [];
      for await (const resp of await clientConnection.request<string>('knock knock')) {
        resps2.push(resp);
      }

      expect(resps2).toEqual(["who's", 'there', '?']);

      await wsms.close();

      await new Promise(resolve => {
        httpServer.close(resolve);
      });
    });

    it('should close the socket if the wrong path is specified', async () => {
      const httpServer = http.createServer();
      await new Promise(resolve => {
        httpServer.listen({ port: 55555 }, resolve);
      });

      const wsms = new WebSocketMessageServer<string>({
        httpServer,
        onReceive: (message: string): AsyncIterableIterator<IValue> | Promise<IValue> =>
          (async function*() {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })(),
        path: '/the-path',
      });

      const clientConnection = await WebSocketMessageClient.create('ws://localhost:55555/the-wrong-path');

      await new Promise(resolve => {
        clientConnection.onClose = resolve;
      });

      expect(clientConnection.isOpen()).toBe(false);

      await wsms.close();

      await new Promise(resolve => {
        httpServer.close(resolve);
      });
    });
  });
});

// const wait = (millis: number = 0) =>
//   new Promise(resolve => {
//     setTimeout(resolve, millis);
//   });
