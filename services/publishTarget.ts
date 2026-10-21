// Pure helpers for the browser publish path (services/publishService.ts), kept
// free of browser/storage imports so they can be unit tested in node.
import type { WebsiteData } from '../types';

export const SUBSCRIPTION_ENDED_MESSAGE =
  "This site's subscription has ended. Open the AI Barber app to resubscribe and bring it back.";

/** Replace any remaining inline data: URL (at any depth) with ''; they belong in GCS, not in a request body. */
function stripDataUrls<T>(v: T): T {
  if (typeof v === 'string') return (/^\s*data:/i.test(v) ? '' : v) as T;
  if (Array.isArray(v)) return v.map(stripDataUrls) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripDataUrls(x)])) as T;
  }
  return v;
}

/**
 * The site data with uploaded image URLs substituted, as PublishOverlay saves
 * it after a publish (hero, about, gallery), plus staff photos. Sent to
 * /api/deploy-site so an iOS-bound site's stored copy matches what went live.
 */
export function withUploadedImageUrls(data: WebsiteData, imageUrlMap: Record<string, string>): WebsiteData {
  return stripDataUrls({
    ...data,
    hero: { ...data.hero, imageUrl: imageUrlMap['hero'] || data.hero?.imageUrl },
    about: { ...data.about, imageUrl: imageUrlMap['about'] || data.about?.imageUrl },
    gallery: (data.gallery || []).map((u, i) => imageUrlMap[`gallery${i}`] || u || ''),
    ...(data.staff
      ? { staff: data.staff.map((s, i) => ({ ...s, photo: imageUrlMap[`staff${i}`] || s?.photo })) }
      : {}),
  });
}
