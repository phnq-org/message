import { Anomaly, MessageConnection } from '../index.client';
import { ConversationPerspective, IConversationSummary } from '../MessageConnection';
import { MessageType } from '../MessageTransport';
import { DirectTransport } from '../transports/DirectTransport';

const serverTransport = new DirectTransport();
const serverConnection = new MessageConnection(serverTransport);
const clientConnection = new MessageConnection(serverTransport.getConnectedTransport());

describe('MessageConnection', () => {
  describe('with DirectTransport', () => {
    describe('requests with multiple responses', () => {
      it('should handle multiple responses with an async iterator', async () => {
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

      it('should handle a single returned response with a single value', async () => {
        serverConnection.onReceive<string>(async message => {
          return `you said ${message}`;
        });

        const resp = await clientConnection.request<string>('hello');
        expect(resp).toEqual('you said hello');
      });
    });

    describe('requestOne', () => {
      it('should handle a single returned response', async () => {
        serverConnection.onReceive<string>(async message => {
          return `you said ${message}`;
        });

        const resp = await clientConnection.requestOne<string>('hello');

        expect(resp).toEqual('you said hello');
      });

      it('should return the first response if multiple are provided', async () => {
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
    });

    describe('requestMulti', () => {
      it('should return an iterator when a single response is provided', async () => {
        serverConnection.onReceive<string>(async message => {
          return `you said ${message}`;
        });

        const resp = await clientConnection.requestMulti<string>('hello');
        expect(typeof resp).toBe('object');
        expect(typeof resp[Symbol.asyncIterator]).toBe('function');

        const resps = [];
        for await (const r of resp) {
          resps.push(r);
        }
        expect(resps).toEqual(['you said hello']);
      });

      it('should return an iterator when multiple responses are provided', async () => {
        serverConnection.onReceive<string>(message =>
          (async function*() {
            yield 'hey';
            yield 'there';
            yield message;
          })(),
        );

        const resp = await clientConnection.requestMulti<string>('hello');
        expect(typeof resp).toBe('object');
        expect(typeof resp[Symbol.asyncIterator]).toBe('function');

        const resps = [];
        for await (const r of resp) {
          resps.push(r);
        }
        expect(resps).toEqual(['hey', 'there', 'hello']);
      });
    });

    describe('one-way send (push)', () => {
      it('should handle pushes in both directions', async () => {
        const serverReceive = jest.fn();
        const clientReceive = jest.fn();

        serverConnection.onReceive<string>(async message => {
          serverReceive(message);
        });

        clientConnection.onReceive<string>(async message => {
          clientReceive(message);
        });

        await Promise.all([clientConnection.send('one way'), serverConnection.send('or another')]);

        expect(serverReceive).toHaveBeenCalledWith('one way');
        expect(clientReceive).toHaveBeenCalledWith('or another');
      });
    });

    describe('handling errors', () => {
      it('should handle internal errors', async () => {
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

  describe('requests with timeouts', () => {
    it('should throw an error if the response times out', async () => {
      clientConnection.responseTimeout = 50;

      serverConnection.onReceive<string>(async message => {
        await wait(100);
        return `you said ${message}`;
      });

      try {
        await clientConnection.requestOne<string>('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
    });
  });

  describe('Response mappers', () => {
    const serverTrans = new DirectTransport();
    const serverConn = new MessageConnection(serverTrans);
    const clientConn = new MessageConnection(serverTrans.getConnectedTransport());

    serverConn.addResponseMapper((req, resp) => {
      return { wrapped: resp, req };
    });

    it('should handle multiple responses with an async iterator', async () => {
      serverConn.onReceive<string>(message =>
        (async function*() {
          expect(message).toBe('knock knock');

          yield "who's";
          yield 'there';
          yield '?';
        })(),
      );

      const resps = [];
      for await (const resp of await clientConn.request<string>('knock knock')) {
        resps.push(resp);
      }

      expect(resps).toEqual([
        { wrapped: "who's", req: 'knock knock' },
        { wrapped: 'there', req: 'knock knock' },
        { wrapped: '?', req: 'knock knock' },
      ]);
    });

    it('should handle a single returned response with a single value', async () => {
      serverConn.onReceive<string>(async message => {
        return `you said ${message}`;
      });

      const resp = await clientConn.request<string>('hello');
      expect(resp).toEqual({ wrapped: 'you said hello', req: 'hello' });
    });
  });

  describe('Conversation Summaries', () => {
    const serverTrans = new DirectTransport();
    const serverConn = new MessageConnection(serverTrans);
    const clientConn = new MessageConnection(serverTrans.getConnectedTransport());

    it('should yield expected summaries that agree client vs. server', async () => {
      let clientConvSummary: IConversationSummary | undefined;
      let serverConvSummary: IConversationSummary | undefined;

      serverConn.onConversation(convSummary => {
        serverConvSummary = convSummary;
      });

      clientConn.onConversation(convSummary => {
        clientConvSummary = convSummary;
      });

      serverConn.onReceive<string>(message =>
        (async function*() {
          expect(message).toBe('knock knock');

          yield "who's";
          yield 'there';
          yield '?';
        })(),
      );

      const resps = [];
      for await (const resp of await clientConn.request<string>('knock knock')) {
        resps.push(resp);
      }

      expect(serverConvSummary).toBeDefined();
      expect(clientConvSummary).toBeDefined();

      if (serverConvSummary && clientConvSummary) {
        expect(clientConvSummary.perspective).toBe(ConversationPerspective.Requester);
        expect(serverConvSummary.perspective).toBe(ConversationPerspective.Responder);

        expect(serverConvSummary.responses.map(({ message }) => message)).toEqual(
          clientConvSummary.responses.map(({ message }) => message),
        );

        expect(serverConvSummary.responses.length).toBe(4);
        expect(serverConvSummary.responses[0].message.type).toBe(MessageType.Multi);
        expect(serverConvSummary.responses[1].message.type).toBe(MessageType.Multi);
        expect(serverConvSummary.responses[2].message.type).toBe(MessageType.Multi);
        expect(serverConvSummary.responses[3].message.type).toBe(MessageType.End);
      }
    });
  });
});

const wait = (millis: number = 0) =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });
