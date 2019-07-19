export enum MessageType {
  Send = 'send',
  Response = 'response',
  Error = 'error',
  Anomaly = 'anomaly',
  End = 'end',
}

export interface IMessage {
  id: number;
  type: MessageType;
  data: any;
}

export interface IAnomalyMessage extends IMessage {
  type: MessageType.Anomaly;
  data: {
    message: string;
    info: any;
  };
}

export interface IErrorMessage extends IMessage {
  type: MessageType.Error;
  data: {
    message: string;
  };
}

export interface IMessageTransport {
  send(message: IMessage): Promise<void>;
  onReceive(receive: (message: IMessage) => void): Promise<void>;
}

// implementations:
// WS Client, WS Server, Kafka Provider, Kafka Consumer
