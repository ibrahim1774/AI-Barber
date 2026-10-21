import * as ImagePicker from 'expo-image-picker';
import { uploadPhoto } from '@/lib/photos';

/**
 * Picks product photos (library: several at once; camera: one) and uploads
 * each to `ab-products/{shopId}`. Returns the public URLs in pick order, or []
 * when the barber cancels. Throws a friendly Error when camera access is off.
 */
export async function pickProductPhotos(
  source: 'camera' | 'library',
  remaining: number,
  shopId: string,
  onPicked?: () => void,
): Promise<string[]> {
  if (remaining <= 0) return [];
  let res: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera access is off. Turn it on in Settings to take product photos.');
    res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: false });
  } else {
    res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      base64: false,
    });
  }
  if (res.canceled || !res.assets?.length) return [];
  onPicked?.();
  const urls: string[] = [];
  for (const a of res.assets.slice(0, remaining)) urls.push(await uploadPhoto(a.uri, `ab-products/${shopId}`));
  return urls;
}

/** Makes photo `i` the cover (first). */
export function moveToCover<T>(photos: T[], i: number): T[] {
  if (i < 0 || i >= photos.length) return photos;
  return [photos[i], ...photos.slice(0, i), ...photos.slice(i + 1)];
}

export function removePhoto<T>(photos: T[], i: number): T[] {
  return photos.filter((_, k) => k !== i);
}
