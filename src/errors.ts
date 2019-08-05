import { Value } from './MessageConnection';

export class Anomaly extends Error {
  public isAnomaly = true;
  public info?: Value;

  public constructor(message: string, info?: Value) {
    super(message);
    Object.setPrototypeOf(this, Anomaly.prototype);
    this.info = info;
  }
}
