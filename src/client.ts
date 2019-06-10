import WebSocket from 'isomorphic-ws';
import { Anomaly } from './anomaly';
import { IValue, MessageType, MultiData } from './constants';
import { deserialize, serialize } from './serialize';

const messageId = (function* messageIdGen() {
  let i = 0;
  while (true) {
    i += 1;
    yield i;
  }
})();

type PushHandler = (data: IValue) => void;

export class MessageClient {
  private url: string;
  private socket?: WebSocket;
  private pushHandlers = new Map<string, Set<PushHandler>>();

  constructor(url: string) {
    this.url = url;
    this.socket = undefined;
  }

  public async on(type: string, handler: PushHandler) {
    if (this.pushHandlers.size === 0) {
      const s = await this.getSocket();
      s.addEventListener('message', this.onReceive);
    }

    let handlers = this.pushHandlers.get(type);
    if (!handlers) {
      handlers = new Set<PushHandler>();
      this.pushHandlers.set(type, handlers);
    }
    handlers.add(handler);
  }

  public async send(
    type: string,
    data?: IValue,
    stats: MessageStats = new MessageStats(),
  ): Promise<IValue | MultiData> {
    const s = await this.getSocket();
    const id = messageId.next().value;

    const responseGen = await getResponseGen(id, s, stats);

    const msg = serialize({ id, type, data });

    stats.request.type = type;
    stats.request.size = msg.length;

    s.send(msg);

    const responseIter = responseGen();

    const { type: rcvType, data: rcvData } = (await responseIter.next()).value;

    switch (rcvType) {
      case MessageType.Anomaly:
        throw new Anomaly(rcvData.message, rcvData.data);

      case MessageType.InternalError:
        throw new Error(rcvData.message);

      case MessageType.Response:
        return rcvData;

      case MessageType.MultiBegin:
        return async function* multi() {
          for await (const { data: respData } of responseIter) {
            yield respData;
          }
        };

      default:
        throw new Error(`Unknown response message type '${rcvType}'`);
    }
  }

  public async close() {
    if (this.socket && [WebSocket.OPEN, WebSocket.CONNECTING].indexOf(this.socket.readyState) !== -1) {
      try {
        this.socket.close();
      } finally {
        this.socket = undefined;
      }
    }
  }

  private onReceive = ({ data: eventData }: { data: any }) => {
    const { type, data } = deserialize(eventData);

    const handlers = this.pushHandlers.get(type);
    if (handlers) {
      handlers.forEach(handler => {
        handler(data);
      });
    }
  };

  private async getSocket(): Promise<WebSocket> {
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
        reject(new Error(event.message));
      });
    });
  }
}

export default MessageClient;

// tslint:disable-next-line: max-classes-per-file
export class MessageStats {
  public request: { type: string; size: number } = { type: '', size: 0 };
  public responses: Array<{ type: string; size: number; time: number }> = [];
}

const getResponseGen = async (msgId: number, s: WebSocket, stats: MessageStats) => {
  let r: (msg: any) => void;
  let p = new Promise<any>(resolve => {
    r = resolve;
  });

  const start = Date.now();

  const listener = ({ data: eventData }: { data: any }) => {
    const { id, type, data } = deserialize(eventData);

    if (id === msgId) {
      switch (type) {
        case MessageType.Response:
        case MessageType.MultiResponse:
        case MessageType.InternalError:
        case MessageType.Anomaly:
          stats.responses.push({ type, time: Date.now() - start, size: (eventData as string).length });
      }

      r({ id, type, data });
      p = new Promise<any>(resolve => {
        r = resolve;
      });
    }
  };

  s.addEventListener('message', listener);

  return async function* respGen() {
    let hasMore = true;
    while (hasMore) {
      const { id, type, data } = await p;

      switch (type) {
        case MessageType.MultiEnd:
          hasMore = false;
          break;

        case MessageType.MultiBegin:
        case MessageType.MultiResponse:
          yield { id, type, data };
          break;

        default:
          yield { id, type, data };
      }
    }
    s.removeEventListener('message', listener);
  };
};
