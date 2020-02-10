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

export interface AnomalyMessage extends Message<{ message: string; info: unknown; requestPayload: unknown }> {
  t: MessageType.Anomaly;
}

export interface ErrorMessage extends Message<{ message: string; requestPayload: unknown }> {
  t: MessageType.Error;
}

export interface MessageTransport {
  send(message: Message): Promise<void>;
  onReceive(receive: (message: Message) => void): void;
  close(): Promise<void>;
}
