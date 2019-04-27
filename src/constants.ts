export enum MessageType {
  Response,
  MultiBegin,
  MultiResponse,
  MultiIncrement,
  MultiEnd,
  InternalError,
  Anomaly,
}

export type IValue = string | number | boolean | Date | IData | undefined;

export interface IData {
  [key: string]: IValue | IValue[];
}
