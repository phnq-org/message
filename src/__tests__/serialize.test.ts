import { deserialize, serialize } from '../serialize';

describe('serialize and deserialize', (): void => {
  it('should serialize, deserialize back to the same thing', (): void => {
    const obj = {
      date: new Date(),
      foo: 'bar',
      nums: [1, 2, 3, 4, 5],
      nope: undefined,
      stuff: null,
    };

    const serDeser = deserialize(serialize(obj));

    expect(serDeser).toEqual(obj);
  });

  it('should serialize, deserialize back to the same thing, keeping date strings as strings', (): void => {
    const obj = {
      date: new Date(),
      dateStr1: '2025-03-22T11:53:26.424Z',
      dateStr2: '2025-03-22T11:53:26.424',
      foo: 'bar',
      nums: [1, 2, 3, 4, 5],
      nope: undefined,
      stuff: null,
    };

    const serDeser = deserialize(serialize(obj));

    expect((serDeser as typeof obj).dateStr1).toEqual('2025-03-22T11:53:26.424Z');
    expect((serDeser as typeof obj).dateStr2).toEqual('2025-03-22T11:53:26.424');

    expect(serDeser).toEqual(obj);
  });
});
