import { createLogger } from '@phnq/log';
import hash from 'object-hash';

import { Message } from './MessageTransport';

const log = createLogger('sign');

/**
 * JSON.stringify changes values sometime (i.e. removes keys with undefined value) which
 * affects the hash value. JSON.parse(JSON.stringify(message)) has the effect of
 * normalizing the message.
 */
const normalize = (message: Message): Message => JSON.parse(JSON.stringify(message));

export const signMessage = <T = unknown>(message: Message<T>, salt: string): Message<T> => ({
  ...message,
  z: hash({ message: normalize(message), salt }),
});

export const verifyMessage = <T = unknown>(message: Message<T>, salt: string): Message<T> => {
  const { z, ...zLess } = message;

  const verifiedZ = hash({ message: normalize(zLess), salt });
  if (z !== verifiedZ) {
    log.error('Failed to verify message: ', verifiedZ, message);
    throw new Error('Failed to verify message');
  }
  return message;
};
