declare module 'jsonpack' {
  export const pack: (val: any) => string;
  export const unpack: (str: string) => any;
}
