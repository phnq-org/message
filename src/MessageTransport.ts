import { Value } from './MessageConnection';

export enum MessageType {
  Send = 'send',
  Error = 'error',
  Anomaly = 'anomaly',
  Response = 'response',
  Multi = 'multi',
  End = 'end',
}

export interface Message<T extends Value> {
  t: MessageType;
  c: number;
  s: string;
  p: T;
}

export interface AnomalyMessage extends Message<{ message: string; info: Value; requestPayload: Value }> {
  t: MessageType.Anomaly;
}

export interface ErrorMessage extends Message<{ message: string; requestPayload: Value }> {
  t: MessageType.Error;
}

export interface MessageTransport {
  send(message: Message<Value>): Promise<void>;
  onReceive(receive: (message: Message<Value>) => void): void;
}
