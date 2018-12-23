import WebSocket from 'ws';
import diff from 'deep-diff';
import { serialize, deserialize } from './serialize';
import {
  MESSAGE_TYPE_MULTI_BEGIN,
  MESSAGE_TYPE_MULTI_RESPONSE,
  MESSAGE_TYPE_MULTI_INCREMENT,
  MESSAGE_TYPE_MULTI_END,
  MESSAGE_TYPE_RESPONSE,
} from './constants';

class Server {
  constructor(httpServer, path) {
    this.wss = null;
    this.onConnect = () => {};
    this.onMessage = () => {};

    if (httpServer) {
      this.setHttpServer(httpServer, path);
    }
  }

  setHttpServer(httpServer, path = '/') {
    httpServer.on('upgrade', (request, socket) => {
      if (request.url !== path) {
        socket.destroy();
      }
    });

    // Create the WebSocket server
    this.wss = new WebSocket.Server({ server: httpServer });

    // When a connection is made...
    this.wss.on('connection', ws => {
      // Instantiate a Connection object to hold state
      let connection = new Connection();

      // Close socket from within the connection
      connection.onClose(() => {
        ws.close(1000, 'Closed by server');
      });

      // Notify of new connections
      this.onConnect(connection);

      const send = async message => {
        // Need this for multi responses
        await wait(0);
        ws.send(serialize(message));
      };

      // Handle incoming messages from client to connection
      ws.on('message', async messageRaw => {
        const { id, type, data } = deserialize(messageRaw);

        const resp = await this.onMessage(
          { type, data },
          {
            ...connection,
            send: async respData => {
              await send({ type: MESSAGE_TYPE_RESPONSE, id, data: respData });
            },
          }
        );

        if (typeof resp === 'function') {
          const respDataIterator = resp();

          await send({ type: MESSAGE_TYPE_MULTI_BEGIN, id, data: {} });

          let prev = null;

          // eslint-disable-next-line no-restricted-syntax
          for await (const respData of respDataIterator) {
            if (prev) {
              const inc = diff(prev, respData);
              // If increment size is less than raw size then send back the increment
              if (JSON.stringify(inc) < JSON.stringify(respData)) {
                await send({ type: MESSAGE_TYPE_MULTI_INCREMENT, id, data: inc });
              } else {
                await send({ type: MESSAGE_TYPE_MULTI_RESPONSE, id, data: respData });
              }
            } else {
              await send({ type: MESSAGE_TYPE_MULTI_RESPONSE, id, data: respData });
            }
            prev = respData;
          }

          await send({ type: MESSAGE_TYPE_MULTI_END, id, data: {} });
        } else {
          const respData = resp;
          await send({ type: MESSAGE_TYPE_RESPONSE, id, data: respData });
        }
      });

      ws.on('close', () => {
        connection.onCloses.forEach(onClose => onClose(connection));
        connection.destroy();
        connection = null;
      });
    });
  }
}

class Connection {
  constructor() {
    this.onCloses = new Set();
  }

  onClose(fn) {
    this.onCloses.add(fn);
  }

  destroy() {
    this.onCloses.clear();
  }
}

const wait = millis =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });

export default Server;
