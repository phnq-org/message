import hash from 'object-hash';

import { Message } from './MessageTransport';

export const signMessage = <T = unknown>(message: Message<T>, salt: string): Message<T> => ({
  ...message,
  z: hash({ message, salt }),
});

export const verifyMessage = <T = unknown>(message: Message<T>, salt: string): Message<T> => {
  const { z, ...zLess } = message;
  if (z !== hash({ message: zLess, salt })) {
    throw new Error('Failed to verify message');
  }
  return message;
};
