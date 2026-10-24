// The pending-file shape for iOS-bound sites: image slots become 'uploaded'
// markers with the real URLs in imageUrlMap. Shared by the iOS publish flow and
// the /api/deploy-site gate (which refreshes the pending file after a web edit),
// so both write exactly the same thing.
import type { WebsiteData } from '../../types.js';

// The guide pages that have a hero photo (lib/render/heroes.ts HERO_EXTRA_PAGES); kept literal so this file imports nothing.
const HERO_PAGES = ['first-visit', 'hair-care', 'beard-care'] as const;
const hasV2 = (sd: WebsiteData): boolean => !!sd.extraPages && typeof sd.extraPages === 'object' && !Array.isArray(sd.extraPages);
const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);

/** Image slots that already hold an http(s) URL, keyed the way the renderer/deployer expects. */
export function buildImageUrlMap(sd: WebsiteData): Record<string, string> {
  const map: Record<string, string> = {};
  if (isHttp(sd.hero?.imageUrl)) map.hero = sd.hero.imageUrl;
  if (isHttp(sd.about?.imageUrl)) map.about = sd.about.imageUrl;
  (sd.gallery || []).forEach((u, i) => { if (isHttp(u)) map[`gallery${i}`] = u; });
  (sd.craftImages || []).forEach((u, i) => { if (isHttp(u)) map[`craft${i}`] = u; });
  (sd.staff || []).forEach((s, i) => { if (isHttp(s?.photo)) map[`staff${i}`] = s.photo; });
  // Page hero photos (pages v2): service<i> and page-<key>. Only for sites that carry extraPages; older sites keep their
  // service images blanked and gain no key.
  if (hasV2(sd)) {
    (sd.services || []).forEach((s, i) => { if (isHttp(s?.imageUrl)) map[`service${i}`] = s.imageUrl; });
    const images = (sd.extraPages as { images?: Record<string, unknown> }).images;
    if (images && typeof images === 'object') {
      for (const k of HERO_PAGES) if (Object.prototype.hasOwnProperty.call(images, k) && isHttp(images[k])) map[`page-${k}`] = images[k] as string;
    }
  }
  return map;
}

/** Same transform as GeneratedWebsite.tsx preparePendingSite: 'uploaded' markers, service images cleared. */
export function toPendingSiteData(sd: WebsiteData, map: Record<string, string>): WebsiteData {
  const v2 = hasV2(sd);
  return {
    ...sd,
    hero: { ...sd.hero, imageUrl: map['hero'] ? 'uploaded' : '' },
    about: { ...sd.about, imageUrl: map['about'] ? 'uploaded' : '' },
    gallery: (sd.gallery || []).map((_, i) => (map[`gallery${i}`] ? 'uploaded' : '')),
    craftImages: (sd.craftImages || []).map((_, i) => (map[`craft${i}`] ? 'uploaded' : '')),
    services: (sd.services || []).map((s, i) => ({ ...s, imageUrl: v2 && map[`service${i}`] ? 'uploaded' : '' })),
    staff: (sd.staff || []).map((s, i) => ({
      ...s,
      photo: map[`staff${i}`] ? 'uploaded' : (s?.photo?.startsWith?.('http') ? s.photo : ''),
    })),
    ...(v2 ? { extraPages: pendingExtraPages(sd.extraPages as unknown as Record<string, unknown>, map) as unknown as WebsiteData['extraPages'] } : {}),
  };
}

/** extraPages with its hero photos as 'uploaded' markers (the URLs live in the image map); a value with no URL is dropped. */
function pendingExtraPages(ep: Record<string, unknown>, map: Record<string, string>): Record<string, unknown> {
  if (!ep.images || typeof ep.images !== 'object') return ep;
  const images: Record<string, string> = {};
  for (const k of HERO_PAGES) if (map[`page-${k}`] && Object.prototype.hasOwnProperty.call(ep.images, k)) images[k] = 'uploaded';
  return { ...ep, images };
}
