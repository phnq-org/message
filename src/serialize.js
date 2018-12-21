import jsonpack from 'jsonpack';

// export const serialize = o => JSON.stringify(o);

// export const deserialize = s => JSON.parse(s);

export const serialize = val => jsonpack.pack(annotate(val));

const annotate = val => {
  if (val instanceof Array) {
    const arr = val;
    return arr.map(annotate);
  }

  if (val instanceof Date) {
    const date = val;
    return `${date.toISOString()}@@@D`;
  }

  if (val && typeof val === 'object') {
    const obj = {};
    Object.keys(val).forEach(k => {
      obj[k] = annotate(val[k]);
    });
    return obj;
  }

  return val;
};

export const deserialize = str => deannotate(jsonpack.unpack(str));

const DATE_RE = /^(.+)@@@D$/;

const deannotate = val => {
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
