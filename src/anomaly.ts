export class Anomaly extends Error {
  public data: {
    [key: string]: string | number | boolean;
  };

  constructor(message: string, data = {}) {
    super(message);
    this.data = data;
  }
}
