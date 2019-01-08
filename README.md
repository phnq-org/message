# phnq-message

Easy to use WebSocket-based messaging client and server. This module is optimized and intended for use
in web browser/server communication.

### Requests and Responses

With WebSockets there's no need to stick to the request/response idiom because communication is full-duplex.
This is what makes WebSockets good at "pushing" from server to client. WebSockets are actually often only
associated with server-initiated push; two-way client/server communication remains an underappreciated
ability of WebSockets. This is probably because request/response is a very common (and useful!) way of doing
client/server communication, but the WebSockets API doesn't explicitly support it. This module provides an
easy way to do request/response (and more) with WebSockets.

### Full-Duplex Performance Advantage

(http2?)

Fetch and XMLHttpRequest are easy to use but unfortunately they tie up sockets. Web browsers restrict
the number of connections to unique hosts that can be held open at a time. This

With HTTP (i.e. XMLHttpRequest, fetch)

- request -> response
- request -> response 1, response 2,...response N
- request -> response, increment,...increment N

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
