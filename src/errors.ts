export class Anomaly extends Error {
  public info?: {
    [key: string]: string | number | boolean;
  };

  constructor(
    message: string,
    info?: {
      [key: string]: string | number | boolean;
    },
  ) {
    super(message);
    Object.setPrototypeOf(this, Anomaly.prototype);
    this.info = info;
  }
}
