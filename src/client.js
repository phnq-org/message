import WebSocket from 'isomorphic-ws';
import { applyChange } from 'deep-diff';
import { serialize, deserialize } from './serialize';
import {
  MESSAGE_TYPE_MULTI_BEGIN,
  MESSAGE_TYPE_MULTI_INCREMENT,
  MESSAGE_TYPE_MULTI_END,
  MESSAGE_TYPE_RESPONSE,
} from './constants';

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

    if (rcvType === MESSAGE_TYPE_RESPONSE) {
      return rcvData;
    }

    if (rcvType === MESSAGE_TYPE_MULTI_BEGIN) {
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
      let prev = null;
      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { id, type, data } = await p;
        if (type === MESSAGE_TYPE_MULTI_END) {
          break;
        } else if (type === MESSAGE_TYPE_MULTI_INCREMENT) {
          if (prev) {
            const incData = prev;
            data.forEach(diff => {
              applyChange(incData, diff);
            });
            yield { id, type, data: incData };
            prev = incData;
          } else {
            throw new Error('received response increment without previous state');
          }
        } else {
          yield { id, type, data };
          if (type === MESSAGE_TYPE_RESPONSE) {
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
