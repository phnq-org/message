import { Value } from './MessageConnection';

export enum MessageType {
  Send = 'send',
  Error = 'error',
  Anomaly = 'anomaly',
  Response = 'response',
  Multi = 'multi',
  End = 'end'
}

export interface Message {
  id: number;
  type: MessageType;
  data: Value;
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

export interface MessageTransport {
  send(message: Message): Promise<void>;
  onReceive(receive: (message: Message) => void): void;
}
