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
let omitBase64 = false;
let saveBase64 = 'QUJD';
let failEdge: number | null = null;
/** The base64 every save returns (default "ABC", which is not a PNG). */
export function __setSaveBase64(b: string) {
  saveBase64 = b;
}
/** Makes a render fail when its long edge was resized to exactly this many px. */
export function __failAtEdge(n: number | null) {
  failEdge = n;
}
/** Makes saves return no base64 even when asked. */
export function __omitBase64(v = true) {
  omitBase64 = v;
}
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
  omitBase64 = false;
  saveBase64 = 'QUJD';
  failEdge = null;
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
        if (failEdge !== null && Math.max(size.width, size.height) === failEdge) throw new Error('render failed');
        return {
          ...size,
          async saveAsync(opts: unknown) {
            __calls.saveAsync.push(opts);
            const o = opts as { format?: string; base64?: boolean } | undefined;
            const ext = o?.format === 'png' ? 'png' : 'jpg';
            return { uri: `file:///tmp/manipulated.${ext}`, ...size, ...(o?.base64 && !omitBase64 ? { base64: saveBase64 } : {}) };
          },
        };
      },
    };
    return ctx;
  },
};
