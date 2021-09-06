import { Anomaly } from '../errors';
import { ConversationPerspective, ConversationSummary, MessageConnection } from '../MessageConnection';
import { MessageType, ResponseMessage } from '../MessageTransport';
import { DirectTransport } from '../transports/DirectTransport';

const serverTransport = new DirectTransport<string, string>();
const serverConnection = new MessageConnection<string, string>(serverTransport);
const clientConnection = new MessageConnection<string, string>(serverTransport.getConnectedTransport());

const wait = (millis: number = 0): Promise<void> =>
  new Promise((resolve): void => {
    setTimeout(resolve, millis);
  });

describe('MessageConnection', (): void => {
  describe('with DirectTransport', (): void => {
    describe('requests with multiple responses', (): void => {
      it('should handle multiple responses with an async iterator', async (): Promise<void> => {
        serverConnection.onReceive = async (message): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            expect(message).toBe('knock knock');

            yield "who's";
            yield 'there';
            yield '?';
          })();

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
        serverConnection.onReceive = async (message): Promise<string> => {
          return `you said ${message}`;
        };

        const resp = await clientConnection.requestOne('hello');
        expect(resp).toEqual('you said hello');
      });
    });

    describe('requestOne', (): void => {
      it('should handle a single returned response', async (): Promise<void> => {
        serverConnection.onReceive = async (message): Promise<string> => {
          return `you said ${message}`;
        };

        const resp = await clientConnection.requestOne('hello');

        expect(resp).toEqual('you said hello');
      });

      it('should return the first response if multiple are provided', async (): Promise<void> => {
        serverConnection.onReceive = async (message: string): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            yield 'hey';
            yield 'there';
            yield message as string;
          })();

        const resp = await clientConnection.requestOne('hello');

        expect(resp).toEqual('hey');
      });
    });

    describe('requestMulti', (): void => {
      it('should return an iterator when a single response is provided', async (): Promise<void> => {
        serverConnection.onReceive = async (message): Promise<string> => {
          return `you said ${message}`;
        };

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
        serverConnection.onReceive = async (message): Promise<AsyncIterableIterator<string>> =>
          (async function*(): AsyncIterableIterator<string> {
            yield 'hey';
            yield 'there';
            yield message;
          })();

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

        serverConnection.onReceive = async (message): Promise<string> => {
          serverReceive(message);
          return '';
        };

        clientConnection.onReceive = async (message): Promise<string> => {
          clientReceive(message);
          return '';
        };

        await Promise.all([clientConnection.send('one way'), serverConnection.send('or another')]);

        expect(serverReceive).toHaveBeenCalledWith('one way');
        expect(clientReceive).toHaveBeenCalledWith('or another');
      });
    });

    describe('handling errors', (): void => {
      it('should handle internal errors', async (): Promise<void> => {
        serverConnection.onReceive = async (message): Promise<string> => {
          throw new Error(`Error: ${message}`);
        };

        try {
          await clientConnection.requestOne('hello');
          fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).message).toEqual('Error: hello');
        }
      });

      it('should handle anomalies', async (): Promise<void> => {
        serverConnection.onReceive = async (message): Promise<string> => {
          throw new Anomaly(`Anomaly: ${message}`, { foo: 'bar' });
        };

        try {
          await clientConnection.requestOne('hello');
          fail('Should have thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(Anomaly);
          expect((err as Anomaly).message).toEqual('Anomaly: hello');
          expect((err as Anomaly).info).toEqual({ foo: 'bar' });
        }
      });
    });
  });

  describe('requests with timeouts', (): void => {
    it('should throw an error if the response times out', async (): Promise<void> => {
      clientConnection.responseTimeout = 50;

      serverConnection.onReceive = async (message): Promise<string> => {
        await wait(100);
        return `you said ${message}`;
      };

      try {
        await clientConnection.requestOne('hello');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
    });
  });

  describe('Conversation Summaries', (): void => {
    const serverTrans = new DirectTransport<string, string>();
    const serverConn = new MessageConnection<string, string>(serverTrans);
    const clientConn = new MessageConnection<string, string>(serverTrans.getConnectedTransport());

    it('should yield expected summaries that agree client vs. server', async (): Promise<void> => {
      let clientConvSummary: ConversationSummary<string, string> | undefined;
      let serverConvSummary: ConversationSummary<string, string> | undefined;

      serverConn.onConversation = (convSummary): void => {
        serverConvSummary = convSummary;
      };

      clientConn.onConversation = (convSummary): void => {
        clientConvSummary = convSummary;
      };

      serverConn.onReceive = async (message): Promise<AsyncIterableIterator<string>> =>
        (async function*(): AsyncIterableIterator<string> {
          expect(message).toBe('knock knock');

          yield "who's";
          yield 'there';
          yield '?';
        })();

      const resps = [];
      for await (const resp of await clientConn.requestMulti('knock knock')) {
        resps.push(resp);
      }

      expect(serverConvSummary).toBeDefined();
      expect(clientConvSummary).toBeDefined();

      if (serverConvSummary && clientConvSummary) {
        expect(clientConvSummary.perspective).toBe(ConversationPerspective.Requester);
        expect(serverConvSummary.perspective).toBe(ConversationPerspective.Responder);

        expect(serverConvSummary.responses.map(({ message }): ResponseMessage<string> => message)).toEqual(
          clientConvSummary.responses.map(({ message }): ResponseMessage<string> => message),
        );

        expect(serverConvSummary.responses.length).toBe(4);
        expect(serverConvSummary.responses[0].message.t).toBe(MessageType.Multi);
        expect(serverConvSummary.responses[1].message.t).toBe(MessageType.Multi);
        expect(serverConvSummary.responses[2].message.t).toBe(MessageType.Multi);
        expect(serverConvSummary.responses[3].message.t).toBe(MessageType.End);
      }
    });
  });

  // describe('ping/pong', (): void => {
  //   it('should return true for ping when connected', async (): Promise<void> => {
  //     const serverTrans = new DirectTransport();
  //     const serverConn = new MessageConnection<string>(serverTrans);
  //     const clientConn = new MessageConnection<string>(serverTrans.getConnectedTransport());

  //     expect(await serverConn.ping()).toBe(true);
  //     expect(await clientConn.ping()).toBe(true);
  //   });

  //   it('should throw for ping when not connected', async (): Promise<void> => {
  //     const nonConn = new MessageConnection<string>(new DirectTransport());
  //     nonConn.responseTimeout = 50;

  //     try {
  //       await nonConn.ping();
  //       fail('Should have thrown');
  //     } catch (err) {
  //       expect(err).toBeInstanceOf(Error);
  //     }
  //   });
  // });
});
