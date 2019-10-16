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
  type: MessageType;
  requestId: number;
  sourceId: string;
  payload: T;
}

export interface AnomalyMessage extends Message<{ message: string; info: Value; requestPayload: Value }> {
  type: MessageType.Anomaly;
}

export interface ErrorMessage extends Message<{ message: string; requestPayload: Value }> {
  type: MessageType.Error;
}

export interface MessageTransport {
  send(message: Message<Value>): Promise<void>;
  onReceive(receive: (message: Message<Value>) => void): void;
}
