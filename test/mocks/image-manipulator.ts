// Jest stand-in for expo-image-manipulator (context API). Tests drive it via
// `__setImage({width,height})` and inspect `__calls`.
export const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } as const;

export const __calls: { resize: any[]; saveAsync: any[]; manipulate: any[] } = {
  resize: [],
  saveAsync: [],
  manipulate: [],
};
let image = { width: 1000, height: 800 };

export function __setImage(size: { width: number; height: number }) {
  image = size;
}
export function __reset() {
  __calls.resize = [];
  __calls.saveAsync = [];
  __calls.manipulate = [];
  image = { width: 1000, height: 800 };
}

export const ImageManipulator = {
  manipulate(source: unknown) {
    __calls.manipulate.push(source);
    let size = { ...image };
    const ctx: any = {
      resize(s: { width?: number | null; height?: number | null }) {
        __calls.resize.push(s);
        const w = s.width ?? Math.round(((s.height as number) * size.width) / size.height);
        const h = s.height ?? Math.round(((s.width as number) * size.height) / size.width);
        size = { width: w, height: h };
        return ctx;
      },
      async renderAsync() {
        return {
          ...size,
          async saveAsync(opts: unknown) {
            __calls.saveAsync.push(opts);
            return { uri: 'file:///tmp/manipulated.jpg', ...size };
          },
        };
      },
    };
    return ctx;
  },
};
