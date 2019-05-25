export enum MessageType {
  Response = 'r',
  MultiBegin = 'mb',
  MultiResponse = 'mr',
  MultiEnd = 'me',
  InternalError = 'err',
  Anomaly = 'an',
}

export type IValue = string | number | boolean | Date | IData | undefined;

export interface IData {
  [key: string]: IValue | IValue[];
}

export type MultiData = (() => AsyncIterableIterator<IValue>);
