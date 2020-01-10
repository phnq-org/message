/* eslint-disable @typescript-eslint/no-explicit-any */
export const annotate = (val: any): any => {
  if (val instanceof Array) {
    const arr = val;
    return arr.map(annotate);
  }

  if (val instanceof Date) {
    const date = val;
    return `${date.toISOString()}@@@D`;
  }

  if (val && typeof val === 'object') {
    const obj: { [index: string]: any } = {};
    Object.keys(val).forEach((k: string) => {
      obj[k] = annotate(val[k]);
    });
    return obj;
  }

  return val;
};

const DATE_RE = /^(.+)@@@D$/;

export const deannotate = (val: any): any => {
  if (val instanceof Array) {
    const arr = val;
    return arr.map(deannotate);
  }

  const dateM = DATE_RE.exec(val);
  if (dateM) {
    return new Date(dateM[1]);
  }

  if (val && typeof val === 'object') {
    const obj = val;
    Object.keys(obj).forEach(k => {
      obj[k] = deannotate(obj[k]);
    });
    return obj;
  }

  return val;
};

export const serialize = (val: any): string => JSON.stringify(annotate(val));
export const deserialize = (str: string): any => deannotate(JSON.parse(str));
