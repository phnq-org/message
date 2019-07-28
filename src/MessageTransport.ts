export enum MessageType {
  Send = 'send',
  Error = 'error',
  Anomaly = 'anomaly',
  Response = 'response',
  Multi = 'multi',
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
    requestData: any;
  };
}

export interface IErrorMessage extends IMessage {
  type: MessageType.Error;
  data: {
    message: string;
    requestData: any;
  };
}

export interface IMessageTransport {
  send(message: IMessage): Promise<void>;
  onReceive(receive: (message: IMessage) => void): void;
}
