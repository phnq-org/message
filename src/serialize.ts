/**
 * Although it may be tempting to no-op this and let `JSON.stringify` serialize
 * dates to ISO 8601 strings, this is not a good idea. The reason is that a
 * string that happens to be an ISO 8601 date string when serialized will be
 * deserialized as a Date object. This could have implications during message
 * signing and verification.
 *
 * {
 *  str: "2025-03-22T11:53:26.424"
 * }
 *
 * will have the `str` deserialized as a Date object. But when verifying the message,
 * which involves using `JSON.stringify`, it will be serialized as:
 * {
 *  str: "2025-03-22T11:53:26.424Z"
 * }
 *
 * The additional `Z` at the end of the string will cause the hash to be different
 * and the verification to fail.
 */
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
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, annotate(v)]));
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
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, deannotate(v)]));
  }

  return val;
};

export const serialize = (val: unknown): string => JSON.stringify(annotate(val));
export const deserialize = <T>(str: string): T => deannotate(JSON.parse(str)) as T;
