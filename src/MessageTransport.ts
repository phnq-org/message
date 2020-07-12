export enum MessageType {
  Send = 'send',
  Error = 'error',
  Anomaly = 'anomaly',
  Response = 'response',
  Multi = 'multi',
  End = 'end',
}

export interface Message<T = unknown> {
  t: MessageType;
  c: number;
  s: string;
  p: T;
  z?: string; // signature
}

export interface AnomalyPayload {
  message: string;
  info: unknown;
  requestPayload: unknown;
}

export interface AnomalyMessage extends Message<AnomalyPayload> {
  t: MessageType.Anomaly;
}

export interface ErrorPayload {
  message: string;
  requestPayload: unknown;
}

export interface ErrorMessage extends Message<ErrorPayload> {
  t: MessageType.Error;
}

export interface MessageTransport {
  send(message: Message): Promise<void>;
  onReceive(receive: (message: Message) => void): void;
  close(): Promise<void>;
}
