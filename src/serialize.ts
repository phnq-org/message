// /* eslint-disable @typescript-eslint/no-explicit-any */
export const annotate = (val: unknown): unknown => {
  if (val instanceof Array) {
    const arr = val;
    return arr.map(annotate);
  }

  if (val instanceof Date) {
    const date = val;
    return `${date.toISOString()}@@@D`;
  }

  if (val && typeof val === 'object') {
    const srcObj = val as Record<string, unknown>;
    const destObj: Record<string, unknown> = {};
    Object.keys(val).forEach((k: string) => {
      destObj[k] = annotate(srcObj[k]);
    });
    return destObj;
  }

  return val;
};

const DATE_RE = /^(.+)@@@D$/;

export const deannotate = (val: unknown): unknown => {
  if (val instanceof Array) {
    const arr = val;
    return arr.map(deannotate);
  }

  const dateM = typeof val === 'string' ? DATE_RE.exec(val) : undefined;
  if (dateM) {
    return new Date(dateM[1]);
  }

  if (val && typeof val === 'object') {
    const srcObj = val as Record<string, unknown>;
    const destObj: Record<string, unknown> = {};
    Object.keys(srcObj).forEach(k => {
      destObj[k] = deannotate(srcObj[k]);
    });
    return destObj;
  }

  return val;
};

export const serialize = (val: unknown): string => JSON.stringify(annotate(val));
export const deserialize = <T>(str: string): T => deannotate(JSON.parse(str)) as T;
