import { Message, MessageType } from '../MessageTransport';
import { deserialize, serialize } from '../serialize';
import { signMessage, verifyMessage } from '../sign';

const SALT = 'abcd1234';

describe('sign/verify', (): void => {
  it('should successfully sign and verify a simple message', (): void => {
    const message: Message = {
      t: MessageType.Send,
      c: 1,
      s: 'source',
      p: 'hello',
    };

    const signedMessage = signMessage(message, SALT);

    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      verifyMessage(signedMessage, SALT);
    }).not.toThrowError();
  });

  it('should throw during verification of a modified signed message', (): void => {
    const message: Message = {
      t: MessageType.Send,
      c: 1,
      s: 'source',
      p: 'hello',
    };

    const signedMessage = signMessage(message, SALT);

    expect(() => {
      verifyMessage({ ...signedMessage, p: 'goodbye' }, SALT);
    }).toThrowError();
  });

  it('should throw during verification of a message with no signature', (): void => {
    const message: Message = {
      t: MessageType.Send,
      c: 1,
      s: 'source',
      p: 'hello',
    };

    const signedMessage = signMessage(message, SALT);

    expect(() => {
      verifyMessage({ ...signedMessage, z: undefined }, SALT);
    }).toThrowError();
  });

  it('should successfully sign and verify a message with object payload', (): void => {
    const message: Message = {
      t: MessageType.Send,
      c: 1,
      s: 'source',
      p: {
        date: new Date(),
        foo: 'bar',
        nums: [1, 2, 3, 4, 5],
        nope: undefined,
        stuff: null,
      },
    };

    const signedMessage = signMessage(message, SALT);

    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      verifyMessage(signedMessage, SALT);
    }).not.toThrowError();
  });

  it('should successfully sign and verify a message with serialized/deserialized message', (): void => {
    const message: Message = {
      t: MessageType.Send,
      c: 1,
      s: 'source',
      p: {
        date: new Date(),
        foo: 'bar',
        nums: [1, 2, 3, 4, 5],
        nope: undefined,
        stuff: null,
      },
    };

    const signedMessage = signMessage(message, SALT);

    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      verifyMessage(deserialize(serialize(signedMessage)), SALT);
    }).not.toThrowError();
  });
});
