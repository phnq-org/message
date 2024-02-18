export const annotate = (val: unknown): unknown => {
  /**
   * This is just a pass through no-op function.
   * Only dates are needed to be handled and JSON.stringify serializes dates to
   * the ISO 8601 by default.
   */
  return val;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d*)?)((-(\d{2}):(\d{2})|Z)?)$/gm;

export const deannotate = (val: unknown): unknown => {
  if (val instanceof Array) {
    const arr = val;
    return arr.map(deannotate);
  }

  if (typeof val === 'string' && val.match(DATE_RE)) {
    return new Date(val);
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
