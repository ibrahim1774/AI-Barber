// The pending-file shape for iOS-bound sites: image slots become 'uploaded'
// markers with the real URLs in imageUrlMap. Shared by the iOS publish flow and
// the /api/deploy-site gate (which refreshes the pending file after a web edit),
// so both write exactly the same thing.
import type { WebsiteData } from '../../types.js';

const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);

/** Image slots that already hold an http(s) URL, keyed the way the renderer/deployer expects. */
export function buildImageUrlMap(sd: WebsiteData): Record<string, string> {
  const map: Record<string, string> = {};
  if (isHttp(sd.hero?.imageUrl)) map.hero = sd.hero.imageUrl;
  if (isHttp(sd.about?.imageUrl)) map.about = sd.about.imageUrl;
  (sd.gallery || []).forEach((u, i) => { if (isHttp(u)) map[`gallery${i}`] = u; });
  (sd.craftImages || []).forEach((u, i) => { if (isHttp(u)) map[`craft${i}`] = u; });
  (sd.staff || []).forEach((s, i) => { if (isHttp(s?.photo)) map[`staff${i}`] = s.photo; });
  return map;
}

/** Same transform as GeneratedWebsite.tsx preparePendingSite: 'uploaded' markers, service images cleared. */
export function toPendingSiteData(sd: WebsiteData, map: Record<string, string>): WebsiteData {
  return {
    ...sd,
    hero: { ...sd.hero, imageUrl: map['hero'] ? 'uploaded' : '' },
    about: { ...sd.about, imageUrl: map['about'] ? 'uploaded' : '' },
    gallery: (sd.gallery || []).map((_, i) => (map[`gallery${i}`] ? 'uploaded' : '')),
    craftImages: (sd.craftImages || []).map((_, i) => (map[`craft${i}`] ? 'uploaded' : '')),
    services: (sd.services || []).map((s) => ({ ...s, imageUrl: '' })),
    staff: (sd.staff || []).map((s, i) => ({
      ...s,
      photo: map[`staff${i}`] ? 'uploaded' : (s?.photo?.startsWith?.('http') ? s.photo : ''),
    })),
  };
}
