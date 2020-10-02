export enum MessageType {
  Request = 'request',
  Response = 'response',
  Multi = 'multi',
  End = 'end',
  Error = 'error',
  Anomaly = 'anomaly',
}

interface Message<T> {
  t: MessageType; // message type
  c: number; // conversation id, for grouping multiple messages together
  s: string; // source, unique id that identifies the agent sending the message
  p: T; // payload, the data being sent to another agent
  z?: string; // signature
}

export interface RequestMessage<T> extends Message<T> {
  t: MessageType.Request;
}

export interface SingleResponseMessage<R> extends Message<R> {
  t: MessageType.Response;
}

export interface MultiResponseMessage<R> extends Message<R> {
  t: MessageType.Multi;
}

export interface EndMessage extends Message<'END'> {
  t: MessageType.End;
}

export interface AnomalyMessage
  extends Message<{
    message: string;
    info: unknown;
    requestPayload: unknown;
  }> {
  t: MessageType.Anomaly;
}

export interface ErrorMessage
  extends Message<{
    message: string;
    requestPayload: unknown;
  }> {
  t: MessageType.Error;
}

export type ResponseMessage<R> =
  | SingleResponseMessage<R>
  | MultiResponseMessage<R>
  | EndMessage
  | ErrorMessage
  | AnomalyMessage;

export interface MessageTransport<T, R> {
  send(message: RequestMessage<T> | ResponseMessage<R>): Promise<void>;
  onReceive(receive: (message: RequestMessage<T> | ResponseMessage<R>) => void): void;
  close(): Promise<void>;
}
