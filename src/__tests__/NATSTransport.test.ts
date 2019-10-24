import { Client, connect } from 'ts-nats';

import { Anomaly } from '../errors';
import { MessageConnection } from '../MessageConnection';
import { NATSTransport } from '../transports/NATSTransport';

const wait = (millis: number = 0): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });

describe('NATSTransport', (): void => {
  let nc: Client;
  let clientConnection: MessageConnection<string | undefined>;
  let serverConnection: MessageConnection<string | undefined>;

  beforeAll(
    async (): Promise<void> => {
      nc = await connect({ servers: ['nats://localhost:4223'] });
      clientConnection = new MessageConnection<string | undefined>(
        await NATSTransport.create(nc, { publishSubject: 's1', subscriptions: ['s2'] }),
      );
      serverConnection = new MessageConnection<string | undefined>(
        await NATSTransport.create(nc, { publishSubject: 's2', subscriptions: ['s1'] }),
      );
    },
  );

  afterAll((): void => {
    nc.close();
  });

  describe('requests with multiple responses', (): void => {
    it('should handle multiple responses with an async iterator', async (): Promise<void> => {
      serverConnection.onReceive(
        async (message): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })(),
      );

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
    });

    it('should handle a single returned response with an iterator', async (): Promise<void> => {
      serverConnection.onReceive(
        async (message): Promise<string> => {
          return `you said ${message}`;
        },
      );

      const resps1 = [];
      for await (const resp of await clientConnection.requestMulti('hello')) {
        resps1.push(resp);
      }

      expect(resps1).toEqual(['you said hello']);
    });
  });

  describe('requests with a single response', (): void => {
    it('should handle a single returned response', async (): Promise<void> => {
      serverConnection.onReceive(
        async (message): Promise<string> => {
          return `you said ${message}`;
        },
      );

      const resp = await clientConnection.requestOne('hello');

      expect(resp).toEqual('you said hello');
    });

    it('should return the first response if multiple are provided', async (): Promise<void> => {
      serverConnection.onReceive(
        async (message): Promise<AsyncIterableIterator<string | undefined>> =>
          (async function*(): AsyncIterableIterator<string | undefined> {
            yield 'hey';
            yield 'there';
            yield message;
          })(),
      );

      const resp = await clientConnection.requestOne('hello');

      expect(resp).toEqual('hey');
    });
  });

  describe('one-way send (push)', (): void => {
    it('should handle pushes in both directions', async (): Promise<void> => {
      const serverReceive = jest.fn();
      const clientReceive = jest.fn();

      serverConnection.onReceive(
        async (message): Promise<undefined> => {
          serverReceive(message);
          return undefined;
        },
      );

      clientConnection.onReceive(
        async (message): Promise<undefined> => {
          clientReceive(message);
          return undefined;
        },
      );

      await Promise.all([clientConnection.send('one way'), serverConnection.send('or another')]);

      await wait(100);

      expect(serverReceive).toHaveBeenCalledWith('one way');
      expect(clientReceive).toHaveBeenCalledWith('or another');
    });
  });

  describe('handling errors', (): void => {
    it('should handle internal errors', async (): Promise<void> => {
      serverConnection.onReceive(
        async (message): Promise<undefined> => {
          throw new Error(`Error: ${message}`);
        },
      );

      try {
        await clientConnection.requestOne('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err.message).toEqual('Error: hello');
      }
    });

    it('should handle anomalies', async (): Promise<void> => {
      serverConnection.onReceive(
        async (message): Promise<undefined> => {
          throw new Anomaly(`Anomaly: ${message}`, { foo: 'bar' });
        },
      );

      try {
        await clientConnection.requestOne('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Anomaly);
        expect(err.message).toEqual('Anomaly: hello');
        expect(err.info).toEqual({ foo: 'bar' });
      }
    });
  });
});
