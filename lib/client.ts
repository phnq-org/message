import WebSocket from 'isomorphic-ws';
import { applyChange } from 'deep-diff';
import { serialize, deserialize } from './serialize';
import { MessageType } from './constants';

const messageId = (function* messageIdGen() {
  let i = 0;
  while (true) {
    i += 1;
    yield i;
  }
})();

class Client {
  url: string;

  socket?: WebSocket;

  constructor(url: string) {
    this.url = url;
    this.socket = undefined;
  }

  async send(type: string, data: any) {
    const s = await this.getSocket();
    const id = messageId.next().value;

    const responseGen = await this.getResponseGen(id);

    // Send the message
    s.send(serialize({ id, type, data }));

    const responseIter = responseGen();

    const { type: rcvType, data: rcvData } = (await responseIter.next()).value;

    if (rcvType === MessageType.Response) {
      return rcvData;
    }

    if (rcvType === MessageType.MultiBegin) {
      return async function* multi() {
        // eslint-disable-next-line no-restricted-syntax
        for await (const { data: respData } of responseIter) {
          yield respData;
        }
      };
    }

    throw new Error(`Unknown response message type '${rcvType}'`);
  }

  async getResponseGen(msgId: number) {
    const s = await this.getSocket();

    let r: (msg: any) => void;
    let p = new Promise<any>(resolve => {
      r = resolve;
    });

    const listener = (event: any) => {
      const { id, type, data } = deserialize(event.data);

      if (id === msgId) {
        r({ id, type, data });
        p = new Promise<any>(resolve => {
          r = resolve;
        });
      }
    };

    s.addEventListener('message', listener);

    return async function* respGen() {
      let prev = null;
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { id, type, data } = await p;
        if (type === MessageType.MultiEnd) {
          break;
        } else if (type === MessageType.MultiIncrement) {
          if (prev) {
            const incData: any = prev;
            data.forEach((diff: any) => {
              applyChange(incData, diff, diff);
            });
            yield { id, type, data: incData };
            prev = incData;
          } else {
            throw new Error('received response increment without previous state');
          }
        } else {
          yield { id, type, data };
          if (type === MessageType.Response) {
            break;
          }
          prev = data;
        }
      }
      s.removeEventListener('message', listener);
    };
  }

  async close() {
    (await this.getSocket()).close();
  }

  async getSocket(): Promise<WebSocket> {
    if (this.socket) {
      return this.socket;
    }

    return new Promise((resolve, reject) => {
      const s = new WebSocket(this.url);

      s.addEventListener('open', () => {
        this.socket = s;
        resolve(this.socket);
      });

      s.addEventListener('close', () => {
        this.socket = undefined;
      });

      s.addEventListener('error', event => {
        console.log('Socket error: %s', event.message);
        reject(new Error(event.message));
      });
    });
  }
}

export default Client;
