import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { api, API_BASE } from '@/lib/api';
import { accessToken } from '@/lib/accessToken';
import { logoContrast, type LogoContrast } from '@/lib/logoContrast';
import { decodePngBase64 } from '@/lib/logoPixels';

const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.8;

export const PHOTO_FORMAT_MESSAGE = "This photo format isn't supported by your browser. Try a JPG or PNG photo, or take it with your camera.";

/** Web only: the browser could not read the picked picture (HEIC and other formats it cannot decode). */
export class PhotoFormatError extends Error {
  constructor() { super(PHOTO_FORMAT_MESSAGE); this.name = 'PhotoFormatError'; }
}

/** The words for a failed photo upload: the format advice when the browser could not read the picture, else `fallback`. */
export const photoFailMessage = (e: unknown, fallback: string): string => (e instanceof PhotoFormatError ? PHOTO_FORMAT_MESSAGE : fallback);

export interface UploadDeps {
  fetchFn?: typeof fetch;
}

const RELAY_MAX_BYTES = 3_500_000;

/** Web only: re-encodes a picture through a canvas (long edge <= maxEdge) at the given JPEG quality. */
async function webRecompress(blob: Blob, maxEdge: number, quality: number): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', quality));
}

/**
 * Sends the bytes to the signed storage URL. Browsers can't PUT to the bucket directly (no CORS), so on web the
 * upload goes through the server relay (same API base as the other calls, signed in with the user's token); a photo
 * is first shrunk to fit the relay's 4 MB limit. Native keeps the plain signed PUT.
 */
async function putSigned(signedUrl: string, blob: Blob, contentType: 'image/jpeg' | 'image/png', doFetch: typeof fetch): Promise<Response> {
  if (Platform.OS !== 'web') {
    return doFetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
  }
  let body = blob;
  if (contentType === 'image/jpeg') {
    let edge = 2000;
    let q = 0.85;
    body = await webRecompress(blob, edge, q);
    while (body.size > RELAY_MAX_BYTES && q > 0.3) {
      q -= 0.1;
      if (q < 0.55) edge = 1600;
      body = await webRecompress(blob, edge, q);
    }
  }
  const token = await accessToken();
  return doFetch(`${API_BASE()}/api/web-app/upload-proxy?u=${encodeURIComponent(signedUrl)}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
}

function filename(): string {
  let r = '';
  while (r.length < 6) r += Math.random().toString(36).slice(2);
  return `${Date.now()}-${r.slice(0, 6)}.jpg`;
}

/**
 * Shrinks (long edge > 2048 only, aspect kept), re-encodes as JPEG 0.8, uploads
 * with a signed PUT and returns the public https URL. The file is always
 * re-encoded so the bytes match the `image/jpeg` the URL was signed for
 * (HEIC/PNG picks included).
 */
export async function uploadPhoto(
  localUri: string,
  folder: string,
  deps: UploadDeps = {},
): Promise<string> {
  const doFetch = deps.fetchFn ?? fetch;

  // Dimensions are read from a first render; the resize is applied to that ref.
  let out;
  try {
    let ref = await ImageManipulator.manipulate(localUri).renderAsync();
    const longEdge = Math.max(ref.width, ref.height);
    if (longEdge > MAX_EDGE) {
      const size = ref.width >= ref.height ? { width: MAX_EDGE } : { height: MAX_EDGE };
      ref = await ImageManipulator.manipulate(ref).resize(size).renderAsync();
    }
    out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  } catch (e) {
    // Web: a picture the browser cannot decode (HEIC, some TIFF/RAW) fails here; say what to do about it.
    if (Platform.OS === 'web') throw new PhotoFormatError();
    throw e;
  }

  const name = filename();
  const [target] = await api.getUploadUrls(folder, [name]);
  if (!target) throw new Error('Photo upload failed: no upload URL was returned.');

  try {
    const blob = await (await doFetch(out.uri)).blob();
    const resp = await putSigned(target.signedUrl, blob, 'image/jpeg', doFetch);
    if (!resp.ok) throw new Error(`status ${resp.status}`);
  } catch (e: any) {
    throw new Error(`Photo upload failed (${e?.message ?? 'network'}). Check your connection and try again.`);
  }
  return target.publicUrl;
}

/**
 * Opens the photo library; null when the barber cancels. `onPicked` runs once
 * a photo is chosen, just before the upload starts (progress UI).
 */
export async function pickAndUploadPhoto(folder: string, onPicked?: () => void): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    base64: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  onPicked?.();
  return uploadPhoto(res.assets[0].uri, folder);
}

// ---------------------------------------------------------------------------
// Shop logo
// ---------------------------------------------------------------------------

export const LOGO_MAX_EDGE = 600;
export const LOGO_FALLBACK_EDGE = 400;
export const LOGO_MAX_BYTES = 300 * 1024;
export const LOGO_DECODE_MESSAGE = "Couldn't open that image";
export const LOGO_UPLOAD_MESSAGE = "Couldn't upload your logo. Check your connection and try again.";

/** `decode`: the file could not be read as an image. `upload`: the server or network failed; the site is unchanged, retry. */
export class LogoError extends Error {
  constructor(public kind: 'decode' | 'upload', message: string) {
    super(message);
    this.name = 'LogoError';
  }
}

export interface LogoUpload {
  /** The public https URL of the uploaded PNG. */
  url: string;
  /** Pixel size of the uploaded PNG (whole numbers, as the server requires). */
  w: number;
  h: number;
  /** The same image as a data URI, for the preview (the WebView cannot read file://). Never saved. */
  previewUri: string;
  /** Whether the logo may be hard to see on the dark header; null when it could not be checked (never blocks). */
  contrast: LogoContrast | null;
}

const CONTRAST_EDGE = 48;

/** Counts the hard-to-see pixels on a 48 px copy. Any failure gives null: the check never fails an upload. */
async function checkContrast(ref: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>>): Promise<LogoContrast | null> {
  try {
    let r = ref;
    if (Math.max(ref.width, ref.height) > CONTRAST_EDGE) {
      r = await ImageManipulator.manipulate(r).resize(ref.width >= ref.height ? { width: CONTRAST_EDGE } : { height: CONTRAST_EDGE }).renderAsync();
    }
    const out = await r.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (!out.base64) return null;
    return logoContrast(decodePngBase64(out.base64));
  } catch {
    return null;
  }
}

function logoFilename(): string {
  let r = '';
  while (r.length < 6) r += Math.random().toString(36).slice(2);
  return `${Date.now()}-${r.slice(0, 6)}.png`;
}

/**
 * Shrinks a logo (long edge to at most 600 px, never enlarged, aspect kept), saves it as PNG (transparency kept) and
 * uploads it with the signed PUT as image/png, kind 'logo'. A file over 300 KB is saved again at 400 px. Throws
 * LogoError: 'decode' when the file cannot be read, 'upload' when anything after that fails (nothing was changed).
 */
export async function uploadLogo(localUri: string, folder: string, deps: UploadDeps = {}): Promise<LogoUpload> {
  const doFetch = deps.fetchFn ?? fetch;

  let ref: Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>>;
  try {
    ref = await ImageManipulator.manipulate(localUri).renderAsync();
  } catch {
    throw new LogoError('decode', LOGO_DECODE_MESSAGE);
  }
  if (!(ref.width > 0 && ref.height > 0)) throw new LogoError('decode', LOGO_DECODE_MESSAGE);

  const encode = async (edge: number) => {
    let r = ref;
    if (Math.max(r.width, r.height) > edge) {
      r = await ImageManipulator.manipulate(ref).resize(r.width >= r.height ? { width: edge } : { height: edge }).renderAsync();
    }
    const out = await r.saveAsync({ format: SaveFormat.PNG, base64: true });
    const blob = await (await doFetch(out.uri)).blob();
    return { out, blob: blob as Blob };
  };

  let enc: Awaited<ReturnType<typeof encode>>;
  try {
    enc = await encode(LOGO_MAX_EDGE);
    if (((enc.blob as { size?: number }).size ?? 0) > LOGO_MAX_BYTES) enc = await encode(LOGO_FALLBACK_EDGE);
  } catch {
    throw new LogoError('decode', LOGO_DECODE_MESSAGE);
  }

  // No base64 means no preview image: treat it as a failed pick, not a blank logo.
  if (!enc.out.base64) throw new LogoError('decode', LOGO_DECODE_MESSAGE);
  const w = Math.round(enc.out.width);
  const h = Math.round(enc.out.height);
  let uploaded: Omit<LogoUpload, 'contrast'>;
  try {
    const name = logoFilename();
    const [target] = await api.getUploadUrls(folder, [name], { contentType: 'image/png', kind: 'logo' });
    if (!target) throw new Error('no upload URL');
    const resp = await putSigned(target.signedUrl, enc.blob as Blob, 'image/png', doFetch);
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    uploaded = { url: target.publicUrl, w, h, previewUri: `data:image/png;base64,${enc.out.base64}` };
  } catch {
    throw new LogoError('upload', LOGO_UPLOAD_MESSAGE);
  }
  return { ...uploaded, contrast: await checkContrast(ref) };
}

/** Opens the photo library for a logo; null when cancelled. `onPicked` runs once a file is chosen (progress UI). */
export async function pickAndUploadLogo(folder: string, onPicked?: () => void): Promise<LogoUpload | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    base64: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  onPicked?.();
  return uploadLogo(res.assets[0].uri, folder);
}
