import WebSocket from 'isomorphic-ws';
import { serialize, deserialize } from './serialize';

const messageId = (function* messageIdGen() {
  let i = 0;
  while (true) {
    i += 1;
    yield i;
  }
})();

class Client {
  constructor(url) {
    this.url = url;
    this.socket = null;
  }

  async send(type, data) {
    const s = await this.getSocket();
    const id = messageId.next().value;

    const responseGen = await this.getResponseGen(id);

    // Send the message
    s.send(serialize({ id, type, data }));

    const responseIter = responseGen();

    const { type: rcvType, data: rcvData } = (await responseIter.next()).value;

    if (rcvType === 'response') {
      return rcvData;
    }

    if (rcvType === 'multi-begin') {
      return async function* multi() {
        // eslint-disable-next-line no-restricted-syntax
        for await (const { data: respData } of responseIter) {
          yield respData;
        }
      };
    }

    throw new Error(`Unknown response message type '${rcvType}'`);
  }

  async getResponseGen(msgId) {
    const s = await this.getSocket();

    let r;
    let p = new Promise(resolve => {
      r = resolve;
    });

    const listener = event => {
      const { id, type, data } = deserialize(event.data);
      if (id === msgId) {
        r({ id, type, data });
        p = new Promise(resolve => {
          r = resolve;
        });
      }
    };

    s.addEventListener('message', listener);

    return async function* respGen() {
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { id, type, data } = await p;
        if (type === 'multi-end') {
          break;
        } else {
          yield { id, type, data };
          if (type === 'response') {
            break;
          }
        }
      }
      s.removeEventListener('message', listener);
    };
  }

  async close() {
    (await this.getSocket()).close();
  }

  async getSocket() {
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
        this.socket = null;
      });

      s.addEventListener('error', event => {
        console.log('Socket error: %s', event.message);
        reject(new Error(event.message));
      });
    });
  }
}

export default Client;
