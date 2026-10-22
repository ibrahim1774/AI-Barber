// Site-data shape rules shared by every path that stores or renders an app site:
// the iOS publish (publishFlow.ts) and the admin edit tools (lib/admin/sites.ts).
// No imports on purpose beyond types: the admin CLI must not pull in the App Store library.
import type { WebsiteData } from '../../types.js';

/** Largest publish body (or admin site) accepted, serialized. */
export const MAX_BODY_BYTES = 3 * 1024 * 1024;

export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Shape checks for everything the pending transform and renderers touch. */
export function validSiteData(sd: unknown): sd is WebsiteData {
  if (!isObj(sd) || typeof sd.shopName !== 'string' || !sd.shopName.trim()) return false;
  if (!isObj(sd.hero) || !isObj(sd.about)) return false;
  if (!Array.isArray(sd.gallery) || !Array.isArray(sd.services)) return false;
  if (sd.craftImages != null && !Array.isArray(sd.craftImages)) return false;
  if (sd.staff != null && !Array.isArray(sd.staff)) return false;
  return true;
}

/** True if any string value, at any depth, is a data: URL (inline image bytes). */
export function hasDataUrl(v: unknown): boolean {
  if (typeof v === 'string') return /^\s*data:/i.test(v);
  if (Array.isArray(v)) return v.some(hasDataUrl);
  if (isObj(v)) return Object.values(v).some(hasDataUrl);
  return false;
}

/** Serialized size in bytes, or Infinity when it can't be serialized. */
export function jsonBytes(v: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
  } catch {
    return Infinity;
  }
}

/** Inverse of toPendingSiteData for the image slots: 'uploaded' markers back to real URLs. */
export function restoreImageUrls(sd: WebsiteData, map: Record<string, string>): WebsiteData {
  const back = (v: string | undefined, key: string) => (v === 'uploaded' ? map[key] || '' : v);
  return {
    ...sd,
    hero: sd.hero ? { ...sd.hero, imageUrl: back(sd.hero.imageUrl, 'hero') } : sd.hero,
    about: sd.about ? { ...sd.about, imageUrl: back(sd.about.imageUrl, 'about') } : sd.about,
    gallery: (sd.gallery || []).map((v, i) => back(v, `gallery${i}`)),
    craftImages: sd.craftImages ? sd.craftImages.map((v, i) => back(v, `craft${i}`)) : sd.craftImages,
    staff: sd.staff ? sd.staff.map((s, i) => ({ ...s, photo: back(s.photo, `staff${i}`) })) : sd.staff,
  };
}
