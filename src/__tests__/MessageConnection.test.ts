import { Anomaly, DirectTransport, MessageConnection } from '../index.client';

describe('MessageConnection', () => {
  describe('with DirectTransport', () => {
    it('should handle multiple responses with an async iterator', async () => {
      const serverTransport = new DirectTransport();
      const clientTransport = serverTransport.getConnectedTransport();
      const clientConnection = new MessageConnection(clientTransport);
      const serverConnection = new MessageConnection(serverTransport);

      serverConnection.onReceive<string>(message =>
        (async function*() {
          expect(message).toBe('knock knock');

          yield "who's";
          yield 'there';
          yield '?';
        })(),
      );

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
    });

    it('should handle a single returned response with an iterator', async () => {
      const serverTransport = new DirectTransport();
      const clientTransport = serverTransport.getConnectedTransport();
      const clientConnection = new MessageConnection(clientTransport);
      const serverConnection = new MessageConnection(serverTransport);

      serverConnection.onReceive<string>(async message => {
        return `you said ${message}`;
      });

      const resps1 = [];
      for await (const resp of await clientConnection.request<string>('hello')) {
        resps1.push(resp);
      }

      expect(resps1).toEqual(['you said hello']);
    });

    it('should handle a single returned response', async () => {
      const serverTransport = new DirectTransport();
      const clientTransport = serverTransport.getConnectedTransport();
      const clientConnection = new MessageConnection(clientTransport);
      const serverConnection = new MessageConnection(serverTransport);

      serverConnection.onReceive<string>(async message => {
        return `you said ${message}`;
      });

      const resp = await clientConnection.requestOne<string>('hello');

      expect(resp).toEqual('you said hello');
    });

    it('should return the first response if multiple are provided', async () => {
      const serverTransport = new DirectTransport();
      const clientTransport = serverTransport.getConnectedTransport();
      const clientConnection = new MessageConnection(clientTransport);
      const serverConnection = new MessageConnection(serverTransport);

      serverConnection.onReceive<string>(message =>
        (async function*() {
          yield 'hey';
          yield 'there';
          yield message;
        })(),
      );

      const resp = await clientConnection.requestOne<string>('hello');

      expect(resp).toEqual('hey');
    });

    it('should handle errors', async () => {
      const serverTransport = new DirectTransport();
      const clientTransport = serverTransport.getConnectedTransport();
      const clientConnection = new MessageConnection(clientTransport);
      const serverConnection = new MessageConnection(serverTransport);

      serverConnection.onReceive<string>(async message => {
        throw new Error(`Error: ${message}`);
      });

      try {
        await clientConnection.requestOne<string>('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toEqual('Error: hello');
      }
    });

    it('should handle anomalies', async () => {
      const serverTransport = new DirectTransport();
      const clientTransport = serverTransport.getConnectedTransport();
      const clientConnection = new MessageConnection(clientTransport);
      const serverConnection = new MessageConnection(serverTransport);

      serverConnection.onReceive<string>(async message => {
        throw new Anomaly(`Anomaly: ${message}`, { foo: 'bar' });
      });

      try {
        await clientConnection.requestOne<string>('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        expect(err.message).toEqual('Anomaly: hello');
        expect(err.info).toEqual({ foo: 'bar' });
      }
    });
  });
});
