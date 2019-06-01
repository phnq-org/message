import http from 'http';
import { Anomaly } from '../anomaly';
import MessageClient from '../client';
import { IData, IValue, MultiData } from '../constants';
import MessageServer, { IConnection } from '../server';

let httpServer: http.Server;
let messageServer: MessageServer;
let messageClient: MessageClient;
const connections = new Set<IConnection>();

const startServer = async () => {
  httpServer = http.createServer();
  await new Promise(resolve => {
    httpServer.listen({ port: 55555 }, resolve);
  });

  messageServer = new MessageServer(httpServer);

  connections.clear();
  messageServer.onConnect = (conn: IConnection) => {
    connections.add(conn);
  };

  messageServer.onMessage = async (type: string, data: IValue, conn: IConnection): Promise<IValue | MultiData> => {
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
      return async function*() {
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
      throw new Anomaly('anomaly');
    }

    if (type === 'trigger-anomaly-with-data') {
      throw new Anomaly('anomaly', { foo: 42 });
    }

    if (type === 'set-on-connection') {
      conn.set('the-data', data);
      return { dataSet: true };
    }

    if (type === 'get-from-connection') {
      return { dataFromConn: conn.get('the-data') };
    }

    return {};
  };
};

const stopServer = async () => {
  if (httpServer.listening) {
    await new Promise((resolve, reject) => {
      try {
        httpServer.close(() => {
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }
};

beforeEach(async () => {
  await startServer();
  messageClient = new MessageClient('ws://localhost:55555');
});

afterEach(async () => {
  try {
    await messageClient.close();
  } catch (err) {}

  try {
    await stopServer();
  } catch (err) {}
});

test('closed server', async () => {
  await stopServer();

  try {
    await messageClient.send('immediate-echo', {});
    fail('Should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
  }
});

test('wrong ws path', async () => {
  messageClient = new MessageClient('ws://localhost:55555/some-wrong-path');

  try {
    await messageClient.send('immediate-echo', {});
    fail('Should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
  }
});

test('no message handler set', async () => {
  messageServer.onMessage = undefined;
  try {
    await messageClient.send('immediate-echo', {});
    fail('Should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
  }
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
  const result = (await messageClient.send('immediate-multi')) as MultiData;

  const respDatas = [];

  for await (const respData of result()) {
    respDatas.push(respData);
  }

  expect(respDatas).toEqual(['first', 'second', 'third', 'fourth']);
});

test('delayed multi-response', async () => {
  const result = (await messageClient.send('delayed-multi')) as MultiData;

  const respDatas = [];

  for await (const respData of result()) {
    respDatas.push(respData);
  }

  expect(respDatas).toEqual(['first', 'second', 'third', 'fourth']);
});

test('incremental', async () => {
  const result = (await messageClient.send('incremental', {})) as MultiData;

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

test('get/set on connection', async () => {
  const setResult = (await messageClient.send('set-on-connection', { fruit: 'apple' })) as IData;
  expect(setResult.dataSet).toBe(true);

  const getResult = (await messageClient.send('get-from-connection')) as IData;
  expect(getResult.dataFromConn).toEqual({ fruit: 'apple' });
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
  }
});

test('anomaly with data', async () => {
  try {
    await messageClient.send('trigger-anomaly-with-data');
    fail('Should have thrown');
  } catch (err) {
    expect(err).toBeInstanceOf(Anomaly);
    expect(err.message).toBe('anomaly');
    expect(err.data).toEqual({ foo: 42 });
  }
});

test('push from server', async () => {
  const handler = jest.fn();

  await messageClient.on('push-me', handler);

  expect(connections.size).toBe(1);

  connections.forEach(async conn => {
    await conn.push('push-me', { foo: 'bar', num: 42 });
  });

  await wait();
  expect(handler).toHaveBeenCalled();
});

const wait = (millis: number = 0) =>
  new Promise(resolve => {
    setTimeout(resolve, millis);
  });
