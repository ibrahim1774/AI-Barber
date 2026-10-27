// Jest stand-in for expo-image-manipulator (context API). Tests drive it via
// `__setImage({width,height})` and inspect `__calls`.
export const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' } as const;

export const __calls: { resize: any[]; saveAsync: any[]; manipulate: any[] } = {
  resize: [],
  saveAsync: [],
  manipulate: [],
};
let image = { width: 1000, height: 800 };
let failRender: Error | null = null;
/** Makes the next renders throw (an undecodable file). */
export function __failRender(e: Error | null) {
  failRender = e;
}

export function __setImage(size: { width: number; height: number }) {
  image = size;
}
export function __reset() {
  __calls.resize = [];
  __calls.saveAsync = [];
  __calls.manipulate = [];
  image = { width: 1000, height: 800 };
  failRender = null;
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
        if (failRender) throw failRender;
        return {
          ...size,
          async saveAsync(opts: unknown) {
            __calls.saveAsync.push(opts);
            const o = opts as { format?: string; base64?: boolean } | undefined;
            const ext = o?.format === 'png' ? 'png' : 'jpg';
            return { uri: `file:///tmp/manipulated.${ext}`, ...size, ...(o?.base64 ? { base64: 'QUJD' } : {}) };
          },
        };
      },
    };
    return ctx;
  },
};
