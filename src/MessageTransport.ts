import { Value } from './MessageConnection';

export enum MessageType {
  Send = 'send',
  Error = 'error',
  Anomaly = 'anomaly',
  Response = 'response',
  Multi = 'multi',
  End = 'end'
}

export interface Message<T extends Value> {
  id: number;
  type: MessageType;
  data: T;
}

export interface AnomalyMessage extends Message<Value> {
  type: MessageType.Anomaly;
  data: {
    message: string;
    info: Value;
    requestData: Value;
  };
}

export interface ErrorMessage extends Message<Value> {
  type: MessageType.Error;
  data: {
    message: string;
    requestData: Value;
  };
}

export interface MessageTransport {
  send(message: Message<Value>): Promise<void>;
  onReceive(receive: (message: Message<Value>) => void): void;
}
