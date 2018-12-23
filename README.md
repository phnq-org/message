# phnq-message

Fairly simple-to-use WebSocket-based messaging client and server. This module is optimized and intended for use
in browser/server communication.

### Request/Response

Since WebSockets offer full-duplex communication, they're not bound by the limitations of the request/response idiom
like HTTP-based communication schemes (i.e. fetch, XMLHttpRequest) are. However, request/response is often a convenient
way to fulfill typical web client/server communicaton demands, and WebSockets alone don't support this. This module does.

## Usage

Here's a simple example to illustrate some basic communication.

### Server

<!-- prettier-ignore -->
```js
import http from 'http';
import { MessageServer } from 'phnq-message';

// Native Node.js HTTP server
const httpServer = http.createServer(() => {});
httpServer.listen(8080);

const messageServer = new MessageServer(httpServer);

messageServer.onMessage = async message => {
  const { type, data } = message;

  if (type === 'greet-me') {
    return `Hello ${data.name}`;
  }

  throw new Error(`Unsupported message type: ${type}`);
};
```

### Client

<!-- prettier-ignore -->
```js
import { MessageClient } from 'phnq-message';

const messageClient = new MessageClient('ws://localhost:8080');

const greeting = await messageClient.send('greet-me', { name: 'Patrick' });

console.log(greeting); // "Hello Patrick"
```

Note: this code won't work as-is because `await` can only be used in an `async` context.
