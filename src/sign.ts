import { createLogger } from "@phnq/log";
import hash from "object-hash";
import { v4 as uuid } from "uuid";

import type { RequestMessage, ResponseMessage } from "./MessageTransport";

const log = createLogger("sign");

/**
 * JSON.stringify changes values sometime (i.e. removes keys with undefined value) which
 * affects the hash value. JSON.stringify(payload) has the effect of
 * normalizing the payload.
 */
const hashMessage = (
  message: RequestMessage<unknown> | ResponseMessage<unknown>,
  u: string,
  salt: string,
): string =>
  hash({ m: { t: message.t, c: message.c, s: message.s, p: JSON.stringify(message.p), u }, salt });

export const signMessage = <T, R>(
  message: RequestMessage<T> | ResponseMessage<R>,
  salt: string,
): RequestMessage<T> | ResponseMessage<R> => {
  const u = uuid().replace(/-/g, "");
  return { ...message, z: [u, hashMessage(message, u, salt)].join(":") };
};

export const verifyMessage = <T, R>(
  message: RequestMessage<T> | ResponseMessage<R>,
  salt: string,
): RequestMessage<T> | ResponseMessage<R> => {
  const { z, ...zLess } = message;

  const [u, h] = z ? z.split(":") : [];

  const verifiedZ = hashMessage(zLess, u ?? "", salt);
  if (h !== verifiedZ) {
    log.error("Failed to verify message: ", verifiedZ, message);
    throw new Error("Failed to verify message");
  }
  return message;
};
