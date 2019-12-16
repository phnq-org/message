export class Anomaly extends Error {
  public isAnomaly = true;
  public info?: unknown;

  public constructor(message: string, info?: unknown) {
    super(message);
    Object.setPrototypeOf(this, Anomaly.prototype);
    this.info = info;
  }
}
