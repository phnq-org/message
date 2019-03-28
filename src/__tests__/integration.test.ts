import http from 'http';
import { Anomaly } from '../anomaly';
import MessageClient from '../client';
import MessageServer from '../server';

let httpServer: http.Server;
let messageServer: MessageServer;
let messageClient: MessageClient;

beforeAll(async () => {
  httpServer = http.createServer();
  httpServer.listen(55555);

  messageServer = new MessageServer(httpServer);

  messageServer.onMessage = async (type: string, data: any) => {
    if (type === 'immediate-echo') {
      return data;
    }

    if (type === 'delayed-echo') {
      await wait(200);
      return data;
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
        let artist: { name: string; bio?: string; tags?: string[] } = {
          name: 'Artist Name',
        };
        yield artist;

        artist = {
          ...artist,
          bio: 'Aliquam tristique nisi ut felis scelerisque porttitor.',
        };
        yield artist;

        artist = {
          ...artist,
          tags: ['rock', 'indie', 'icelandic', 'female vocalist'],
        };
        yield artist;
      };
    }

    if (type === 'trigger-error') {
      throw new Error('triggered');
    }

    if (type === 'trigger-anomaly') {
      throw new Anomaly('anomaly', { foo: 42 });
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
  const result = await messageClient.send('immediate-echo', {
    date: new Date(2018, 0, 1),
    foo: 42,
  });
  expect(result).toEqual({ foo: 42, date: new Date(2018, 0, 1) });
});

test('delayed echo', async () => {
  const result = await messageClient.send('delayed-echo', { bar: 43 });
  expect(result).toEqual({ bar: 43 });
});

test('immediate multi-response', async () => {
  const result = await messageClient.send('immediate-multi');

  const respDatas = [];

  for await (const respData of result()) {
    respDatas.push(respData);
  }

  expect(respDatas).toEqual(['first', 'second', 'third', 'fourth']);
});

test('delayed multi-response', async () => {
  const result = await messageClient.send('delayed-multi');

  const respDatas = [];

  for await (const respData of result()) {
    respDatas.push(respData);
  }

  expect(respDatas).toEqual(['first', 'second', 'third', 'fourth']);
});

test('incremental', async () => {
  const result = await messageClient.send('incremental');

  const respDatas = [];

  for await (const respData of result()) {
    respDatas.push(JSON.parse(JSON.stringify(respData)));
  }

  expect(respDatas).toEqual([
    { name: 'Artist Name' },
    {
      bio: 'Aliquam tristique nisi ut felis scelerisque porttitor.',
      name: 'Artist Name',
    },
    {
      bio: 'Aliquam tristique nisi ut felis scelerisque porttitor.',
      name: 'Artist Name',
      tags: ['rock', 'indie', 'icelandic', 'female vocalist'],
    },
  ]);
});

test('internal error', async () => {
  try {
    await messageClient.send('trigger-error');
    fail('Should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('triggered');
  }
});

test('anomaly', async () => {
  try {
    await messageClient.send('trigger-anomaly');
    fail('Should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(Anomaly);
    expect(err.message).toBe('anomaly');
    expect(err.data).toEqual({ foo: 42 });
  }
});

const wait = (millis: number) =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });
