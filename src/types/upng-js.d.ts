declare module 'upng-js' {
  const UPNG: {
    decode(buffer: ArrayBuffer): { width: number; height: number };
    toRGBA8(img: { width: number; height: number }): ArrayBuffer[];
    encode(frames: ArrayBuffer[], w: number, h: number, cnum: number): ArrayBuffer;
  };
  export default UPNG;
}
