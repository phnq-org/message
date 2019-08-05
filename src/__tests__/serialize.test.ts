import { deserialize, serialize } from '../serialize';

describe('serialize and deserialize', (): void => {
  it('should serialize, deserialize back to the same thing', (): void => {
    const obj = {
      date: new Date(),
      foo: 'bar',
      nums: [1, 2, 3, 4, 5]
    };

    expect(deserialize(serialize(obj))).toEqual(obj);
  });
});
