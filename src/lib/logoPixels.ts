import UPNG from 'upng-js';

/** Decodes a base64 PNG to RGBA bytes with pure JS (upng-js). Throws when it is not a valid PNG. */
export function decodePngBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const img = UPNG.decode(bytes.buffer);
  const frame = UPNG.toRGBA8(img)[0];
  if (!frame) throw new Error('empty png');
  return new Uint8Array(frame);
}
