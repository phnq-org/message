# @phnq/message

[![CircleCI](https://circleci.com/gh/pgostovic/message.svg?style=svg)](https://circleci.com/gh/pgostovic/message)

[![npm version](https://badge.fury.io/js/%40phnq%2Fmessage.svg)](https://badge.fury.io/js/%40phnq%2Fmessage)

Message-based communication between agents:
- request/response semantics
- multiple async responses
- symmetric full-duplex communication
- transport abstraction

## Usage

[See tests for usage examples.](src/__tests__/)


## Protocol

Messages are passed as JSON. For example:

```json
{
  "type": "send",
  "requestId": 1,
  "sourceId": "2dbb50ed-2cd6-4fe3-af79-baf5cd643ce3",
  "payload": { "greeting": "Hello" }
}
```

- **type** - one of `send`, `error`, `anomaly`, `response`, `multi`, `end`
- **requestId** - identifies the "conversation"
- **sourceId** - unique id that identifies the message agent
- **payload** - the data being sent to another agent


### Conversation
A conversation between agents consists of a single request by one agent, followed by zero or more responses from another agent. The request is always of type `send`, and the responses can be of various types depending on the situation:

#### Single Response
A single, non-error response will be of type `response`. For example:

Request:
```json
{
  "type": "send",
  "requestId": 1,
  "sourceId": "2dbb50ed-2cd6-4fe3-af79-baf5cd643ce3",
  "payload": { "question": "How are you?" }
}
```

Response:
```json
{
  "type": "response",
  "requestId": 1,
  "sourceId": "13c5a54d-4e25-478b-a6be-295be08e8f01",
  "payload": { "answer": "I'm fine." }
}
```

#### Multiple responses
Multiple responses will consist of payload-carrying messages with the type `multi`, followed by a single message of type `end`.

Request:
```json
{
  "type": "send",
  "requestId": 2,
  "sourceId": "2dbb50ed-2cd6-4fe3-af79-baf5cd643ce3",
  "payload": {
    "question": "What are the names of your pets?"
  }
}
```

Responses:
```json
{
  "type": "multi",
  "requestId": 2,
  "sourceId": "13c5a54d-4e25-478b-a6be-295be08e8f01",
  "payload": { "dog": "Fido" }
}
```
```json
{
  "type": "multi",
  "requestId": 2,
  "sourceId": "13c5a54d-4e25-478b-a6be-295be08e8f01",
  "payload": { "cat": "Fritz" }
}
```
```json
{
  "type": "multi",
  "requestId": 2,
  "sourceId": "13c5a54d-4e25-478b-a6be-295be08e8f01",
  "payload": { "fish": "Fred" }
}
```
```json
{
  "type": "end",
  "requestId": 2,
  "sourceId": "13c5a54d-4e25-478b-a6be-295be08e8f01",
  "payload": {}
}
```

#### Error responses
Error responses are similar to the single response, but have the type `error` or `anomaly`. The difference between `error` and `anomaly` is only semantic; `error` is meant to depict something unexpected whereas `anomaly` is meant to depict something unusal.

## Transport
The transport for transmitting the messages in the protocol is abstract. The abstraction is very simple. The TypeScript interface is the following:

```TypeScript
export interface MessageTransport {
  send(message: Message<Value>): Promise<void>;
  onReceive(receive: (message: Message<Value>) => void): void;
}
```

With this simple abstraction, creating transport implementation is fairly trivial. There are two included:
- `WebSocketTransport` - for transmitting the protocol over WebSockets
- `NATSTransport` - for transmitting the protocol between services attached to a NATS pub/sub messaging system
