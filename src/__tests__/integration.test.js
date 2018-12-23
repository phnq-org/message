import http from 'http';
import { MessageClient, MessageServer } from '../..';

let httpServer;
let messageServer;
let messageClient;

beforeAll(async () => {
  httpServer = http.createServer(() => {});
  httpServer.listen(55555);

  messageServer = new MessageServer(httpServer);

  messageServer.onMessage = async (message, conn) => {
    const { type, data } = message;

    if (type === 'immediate-echo') {
      return data;
    }

    if (type === 'delayed-echo') {
      await wait(200);
      return data;
    }

    if (type === 'echo-response-with-send-function') {
      conn.send(data);
    }

    if (type === 'immediate-multi') {
      return async function* getImmediateMulti() {
        yield 'first';
        yield 'second';
        yield 'third';
        yield 'fourth';
      };
    }

    if (type === 'delayed-multi') {
      return async function* getDelayedMulti() {
        await wait(100);
        yield 'first';
        await wait(200);
        yield 'second';
        await wait(100);
        yield 'third';
        await wait(200);
        yield 'fourth';
      };
    }

    if (type === 'incremental') {
      return async function* getIncremental() {
        let artist = { name: 'Artist Name' };
        yield artist;

        artist = { ...artist, bio: 'Aliquam tristique nisi ut felis scelerisque porttitor.' };
        yield artist;

        artist = { ...artist, tags: ['rock', 'indie', 'icelandic', 'female vocalist'] };
        yield artist;
      };
    }

    return null;
  };
});

afterAll(async () => {
  httpServer.close();
});

beforeEach(async () => {
  messageClient = new MessageClient('ws://localhost:55555');
});

afterEach(async () => {
  await messageClient.close();
});

test('immediate echo', async () => {
  const result = await messageClient.send('immediate-echo', { foo: 42, date: new Date(2018, 0, 1) });
  expect(result).toEqual({ foo: 42, date: new Date(2018, 0, 1) });
});

test('delayed echo', async () => {
  const result = await messageClient.send('delayed-echo', { bar: 43 });
  expect(result).toEqual({ bar: 43 });
});

test('echo with send function', async () => {
  const result = await messageClient.send('echo-response-with-send-function', { bobo: 44 });
  expect(result).toEqual({ bobo: 44 });
});

test('immediate multi-response', async () => {
  const result = await messageClient.send('immediate-multi');

  const respDatas = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const respData of result()) {
    respDatas.push(respData);
  }

  expect(respDatas).toEqual(['first', 'second', 'third', 'fourth']);
});

test('delayed multi-response', async () => {
  const result = await messageClient.send('delayed-multi');

  const respDatas = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const respData of result()) {
    respDatas.push(respData);
  }

  expect(respDatas).toEqual(['first', 'second', 'third', 'fourth']);
});

test('incremental', async () => {
  const result = await messageClient.send('incremental');

  const respDatas = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const respData of result()) {
    respDatas.push(JSON.parse(JSON.stringify(respData)));
  }

  expect(respDatas).toEqual([
    { name: 'Artist Name' },
    { name: 'Artist Name', bio: 'Aliquam tristique nisi ut felis scelerisque porttitor.' },
    {
      name: 'Artist Name',
      bio: 'Aliquam tristique nisi ut felis scelerisque porttitor.',
      tags: ['rock', 'indie', 'icelandic', 'female vocalist'],
    },
  ]);
});

const wait = millis =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });
