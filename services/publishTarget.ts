// Pure helpers for the browser publish path (services/publishService.ts), kept
// free of browser/storage imports so they can be unit tested in node.
import type { WebsiteData } from '../types';

export const SUBSCRIPTION_ENDED_MESSAGE =
  "This site's subscription has ended. Open the AI Barber app to resubscribe and bring it back.";

const VERCEL_APP = '.vercel.app';

const slugFromShopName = (shopName: string): string =>
  (shopName || '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

/**
 * The project slug a republish deploys to. A site already deployed to a
 * `*.vercel.app` URL keeps that project (the host label before `.vercel.app`),
 * so a renamed shop, or an iOS site with a suffixed slug like
 * `fade-studio-x7k2`, updates its own link instead of a different (or someone
 * else's) project. Otherwise the slug comes from the shop name, as before.
 */
export function deriveSiteSlug(deployedUrl: string | null | undefined, shopName: string): string {
  if (deployedUrl) {
    try {
      const host = new URL(deployedUrl).hostname.toLowerCase();
      if (host.endsWith(VERCEL_APP)) {
        const labels = host.slice(0, -VERCEL_APP.length).split('.');
        const label = labels[labels.length - 1];
        if (label && /^[a-z0-9-]+$/.test(label)) return label;
      }
    } catch {
      // Not a URL: fall through to the shop-name slug.
    }
  }
  return slugFromShopName(shopName);
}

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
