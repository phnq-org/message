import { Anomaly, MessageConnection } from '../index.client';
import { ConversationPerspective, ConversationSummary, Value } from '../MessageConnection';
import { MessageType, Message } from '../MessageTransport';
import { DirectTransport } from '../transports/DirectTransport';

const serverTransport = new DirectTransport<string | undefined>();
const serverConnection = new MessageConnection<string | undefined, string | undefined>(serverTransport);
const clientConnection = new MessageConnection(serverTransport.getConnectedTransport());

const wait = (millis: number = 0): Promise<void> =>
  new Promise((resolve): void => {
    setTimeout(resolve, millis);
  });

describe('MessageConnection', (): void => {
  describe('with DirectTransport', (): void => {
    describe('requests with multiple responses', (): void => {
      it('should handle multiple responses with an async iterator', async (): Promise<void> => {
        serverConnection.onReceive(
          (message): AsyncIterableIterator<string> =>
            (async function*(): AsyncIterableIterator<string> {
              expect(message).toBe('knock knock');

              yield "who's";
              yield 'there';
              yield '?';
            })()
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

      it('should handle a single returned response with a single value', async (): Promise<void> => {
        serverConnection.onReceive(
          async (message): Promise<string> => {
            return `you said ${message}`;
          }
        );

        const resp = await clientConnection.requestOne('hello');
        expect(resp).toEqual('you said hello');
      });
    });

    describe('requestOne', (): void => {
      it('should handle a single returned response', async (): Promise<void> => {
        serverConnection.onReceive(
          async (message): Promise<string> => {
            return `you said ${message}`;
          }
        );

        const resp = await clientConnection.requestOne('hello');

        expect(resp).toEqual('you said hello');
      });

      it('should return the first response if multiple are provided', async (): Promise<void> => {
        serverConnection.onReceive(
          (message: Value): AsyncIterableIterator<string> =>
            (async function*(): AsyncIterableIterator<string> {
              yield 'hey';
              yield 'there';
              yield message as string;
            })()
        );

        const resp = await clientConnection.requestOne('hello');

        expect(resp).toEqual('hey');
      });
    });

    describe('requestMulti', (): void => {
      it('should return an iterator when a single response is provided', async (): Promise<void> => {
        serverConnection.onReceive(
          async (message): Promise<string> => {
            return `you said ${message}`;
          }
        );

        const resp = await clientConnection.requestMulti('hello');
        expect(typeof resp).toBe('object');
        expect(typeof resp[Symbol.asyncIterator]).toBe('function');

        const resps = [];
        for await (const r of resp) {
          resps.push(r);
        }
        expect(resps).toEqual(['you said hello']);
      });

      it('should return an iterator when multiple responses are provided', async (): Promise<void> => {
        serverConnection.onReceive(
          (message): AsyncIterableIterator<string | undefined> =>
            (async function*(): AsyncIterableIterator<string | undefined> {
              yield 'hey';
              yield 'there';
              yield message;
            })()
        );

        const resp = await clientConnection.requestMulti('hello');
        expect(typeof resp).toBe('object');
        expect(typeof resp[Symbol.asyncIterator]).toBe('function');

        const resps = [];
        for await (const r of resp) {
          resps.push(r);
        }
        expect(resps).toEqual(['hey', 'there', 'hello']);
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
          }
        );

        clientConnection.onReceive(
          async (message): Promise<undefined> => {
            clientReceive(message);
            return undefined;
          }
        );

        await Promise.all([clientConnection.send('one way'), serverConnection.send('or another')]);

        expect(serverReceive).toHaveBeenCalledWith('one way');
        expect(clientReceive).toHaveBeenCalledWith('or another');
      });
    });

    describe('handling errors', (): void => {
      it('should handle internal errors', async (): Promise<void> => {
        serverConnection.onReceive(
          async (message): Promise<undefined> => {
            throw new Error(`Error: ${message}`);
          }
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
          }
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

  describe('requests with timeouts', (): void => {
    it('should throw an error if the response times out', async (): Promise<void> => {
      clientConnection.responseTimeout = 50;

      serverConnection.onReceive(
        async (message): Promise<string> => {
          await wait(100);
          return `you said ${message}`;
        }
      );

      try {
        await clientConnection.requestOne('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
    });
  });

  describe('Response mappers', (): void => {
    const serverTrans = new DirectTransport();
    const serverConn = new MessageConnection(serverTrans);
    const clientConn = new MessageConnection(serverTrans.getConnectedTransport());

    serverConn.addResponseMapper(
      (req, resp): Value => {
        return { wrapped: resp, req };
      }
    );

    it('should handle multiple responses with an async iterator', async (): Promise<void> => {
      serverConn.onReceive(
        (message): AsyncIterableIterator<string> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })()
      );

      const resps = [];
      for await (const resp of await clientConn.requestMulti('knock knock')) {
        resps.push(resp);
      }

      expect(resps).toEqual([
        { wrapped: "who's", req: 'knock knock' },
        { wrapped: 'there', req: 'knock knock' },
        { wrapped: '?', req: 'knock knock' }
      ]);
    });

    it('should handle a single returned response with a single value', async (): Promise<void> => {
      serverConn.onReceive(
        async (message): Promise<string> => {
          return `you said ${message}`;
        }
      );

      const resp = await clientConn.request('hello');
      expect(resp).toEqual({ wrapped: 'you said hello', req: 'hello' });
    });
  });

  describe('Conversation Summaries', (): void => {
    const serverTrans = new DirectTransport();
    const serverConn = new MessageConnection(serverTrans);
    const clientConn = new MessageConnection(serverTrans.getConnectedTransport());

    it('should yield expected summaries that agree client vs. server', async (): Promise<void> => {
      let clientConvSummary: ConversationSummary | undefined;
      let serverConvSummary: ConversationSummary | undefined;

      serverConn.onConversation((convSummary): void => {
        serverConvSummary = convSummary;
      });

      clientConn.onConversation((convSummary): void => {
        clientConvSummary = convSummary;
      });

      serverConn.onReceive(
        (message): AsyncIterableIterator<string> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })()
      );

      const resps = [];
      for await (const resp of await clientConn.requestMulti('knock knock')) {
        resps.push(resp);
      }

      expect(serverConvSummary).toBeDefined();
      expect(clientConvSummary).toBeDefined();

      if (serverConvSummary && clientConvSummary) {
        expect(clientConvSummary.perspective).toBe(ConversationPerspective.Requester);
        expect(serverConvSummary.perspective).toBe(ConversationPerspective.Responder);

        expect(serverConvSummary.responses.map(({ message }): Message => message)).toEqual(
          clientConvSummary.responses.map(({ message }): Message => message)
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
