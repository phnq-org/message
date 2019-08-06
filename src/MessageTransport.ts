import { Value } from './MessageConnection';

export enum MessageType {
  Send = 'send',
  Error = 'error',
  Anomaly = 'anomaly',
  Response = 'response',
  Multi = 'multi',
  End = 'end'
}

export interface Message<T extends Value = Value> {
  id: number;
  type: MessageType;
  data: T;
}

export interface AnomalyMessage extends Message {
  type: MessageType.Anomaly;
  data: {
    message: string;
    info: Value;
    requestData: Value;
  };
}

export interface ErrorMessage extends Message {
  type: MessageType.Error;
  data: {
    message: string;
    requestData: Value;
  };
}

export interface MessageTransport<S extends Value = Value, R extends Value = Value> {
  send(message: Message<S>): Promise<void>;
  onReceive(receive: (message: Message<R>) => void): void;
}
