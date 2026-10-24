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

const HERO_PAGES = ['first-visit', 'hair-care', 'beard-care'] as const;
const hasPageHeroes = (sd: WebsiteData): boolean => !!sd.extraPages && typeof sd.extraPages === 'object' && !Array.isArray(sd.extraPages);
/** Page hero photos (pages v2): services[i].imageUrl and extraPages.images, back from 'uploaded' to the URL in the map. */
function pageHeroesBack(sd: WebsiteData, back: (v: string | undefined, key: string) => string | undefined): Partial<WebsiteData> {
  const out: Partial<WebsiteData> = {
    services: (sd.services || []).map((s, i) => ({ ...s, imageUrl: back(s?.imageUrl, `service${i}`) as string })),
  };
  const ep = sd.extraPages as unknown as Record<string, unknown>;
  if (ep.images && typeof ep.images === 'object') {
    const images: Record<string, string | undefined> = { ...(ep.images as Record<string, string>) };
    for (const k of HERO_PAGES) if (Object.prototype.hasOwnProperty.call(images, k)) images[k] = back(images[k], `page-${k}`);
    out.extraPages = { ...ep, images } as unknown as WebsiteData['extraPages'];
  }
  return out;
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
    ...(hasPageHeroes(sd) ? pageHeroesBack(sd, back) : {}),
  };
}

/**
 * Why the renderers can't take this siteData (null when they can). Deeper than validSiteData:
 * these are what the templates dereference. Shared by admin saves and the phone publish (both
 * also dry-render before storing anything).
 */
export function validationProblem(sd: unknown): string | null {
  if (!validSiteData(sd)) return 'siteData needs shopName, hero, about, gallery[] and services[] (craftImages/staff must be lists)';
  if (!isObj(sd.contact)) return 'contact must be an object ({ address, email })';
  const badService = sd.services.findIndex((x: unknown) => !isObj(x) || typeof (x as any).title !== 'string');
  if (badService >= 0) return `services.${badService} must be an object with a text title`;
  const desc = (sd.about as any).description;
  if (!Array.isArray(desc) || desc.some((d: unknown) => typeof d !== 'string')) return 'about.description must be a list of text paragraphs';
  if (hasDataUrl(sd)) return 'inline data: images are not allowed; upload the image and use its https URL';
  if (jsonBytes(sd) > MAX_BODY_BYTES) return 'siteData is larger than 3 MB';
  return null;
}
