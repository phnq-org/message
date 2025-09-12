import { describe, expect, it } from "bun:test";
import { MessageType, type RequestMessage } from "../MessageTransport";
import { deserialize, serialize } from "../serialize";
import { signMessage, verifyMessage } from "../sign";

const SALT = "abcd1234";

describe("sign/verify", (): void => {
  it("should successfully sign and verify a simple message", (): void => {
    const message: RequestMessage<string> = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: "hello",
    };

    const signedMessage = signMessage(message, SALT);

    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      verifyMessage(signedMessage, SALT);
    }).not.toThrowError();
  });

  it("should throw during verification of a modified signed message", (): void => {
    const message: RequestMessage<string> = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: "hello",
    };

    const signedMessage = signMessage(message, SALT);

    expect(() => {
      const doctoredMessage = { ...signedMessage, s: "wrong source" };

      verifyMessage(doctoredMessage, SALT);
    }).toThrowError();
  });

  it("should throw during verification of a message with no signature", (): void => {
    const message: RequestMessage<string> = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: "hello",
    };

    const signedMessage = signMessage(message, SALT);

    expect(() => {
      verifyMessage({ ...signedMessage, z: undefined }, SALT);
    }).toThrowError();
  });

  it("should successfully sign and verify a message with object payload", (): void => {
    const message: RequestMessage = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: {
        date: new Date(),
        foo: "bar",
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

  it("should successfully sign and verify a message with serialized/deserialized message", (): void => {
    const message: RequestMessage = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: {
        date: new Date(),
        foo: "bar",
        nums: [1, 2, 3, 4, 5],
        nope: undefined,
        stuff: null,
      },
    };

    const signedMessage = signMessage(message, SALT);

    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      verifyMessage(deserialize(serialize(signedMessage)), SALT) as typeof signedMessage;
    }).not.toThrowError();
  });

  it("should successfully sign and verify a message with serialized/deserialized message, dates and date strings", (): void => {
    const message: RequestMessage = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: {
        date1: new Date(),
        date2: "2025-03-22T11:53:26.424",
        date3: "2025-03-22T11:53:26.424Z",
        foo: "bar",
        nums: [1, 2, 3, 4, 5],
        nope: undefined,
        stuff: null,
      },
    };

    const signedMessage = signMessage(message, SALT);

    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      verifyMessage(deserialize(serialize(signedMessage)), SALT) as typeof signedMessage;
    }).not.toThrowError();
  });

  it("should successfully sign and verify a message with a large payload", (): void => {
    const num = 20000;

    const streams: {
      time: number[];
      hr: number[];
      altitude: number[];
      power: number[];
      cadence: number[];
      temp: number[];
    } = {
      time: [],
      hr: [],
      altitude: [],
      power: [],
      cadence: [],
      temp: [],
    };

    for (let i = 0; i < num; i++) {
      streams.time.push(i);
      streams.hr.push(150);
      streams.altitude.push(1000);
      streams.power.push(200);
      streams.cadence.push(90);
      streams.temp.push(20);
    }

    const largeMessage: RequestMessage = {
      t: MessageType.Request,
      c: 1,
      s: "source",
      p: {
        streams,
      },
    };

    const signedMessage = signMessage(largeMessage, SALT);
    expect(signedMessage.z).toBeTruthy();

    expect(() => {
      const serDeser = deserialize(serialize(signedMessage)) as typeof signedMessage;
      verifyMessage(serDeser, SALT);
    }).not.toThrowError();
  });
});
