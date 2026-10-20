import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/lib/api';

const MAX_EDGE = 2048;
const JPEG_QUALITY = 0.8;

export interface UploadDeps {
  fetchFn?: typeof fetch;
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
  let ref = await ImageManipulator.manipulate(localUri).renderAsync();
  const longEdge = Math.max(ref.width, ref.height);
  if (longEdge > MAX_EDGE) {
    const size = ref.width >= ref.height ? { width: MAX_EDGE } : { height: MAX_EDGE };
    ref = await ImageManipulator.manipulate(ref).resize(size).renderAsync();
  }
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });

  const name = filename();
  const [target] = await api.getUploadUrls(folder, [name]);
  if (!target) throw new Error('Photo upload failed: no upload URL was returned.');

  try {
    const blob = await (await doFetch(out.uri)).blob();
    const resp = await doFetch(target.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
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
