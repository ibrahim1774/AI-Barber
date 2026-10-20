import type { WebsiteData } from '@/web/types';
import { generateHTMLWithPlaceholders } from '@/web/lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '@/web/lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '@/web/lib/render/euphoria';

/** Same template switch as the web's lib/publishSite.ts renderSite. */
export function renderSite(siteData: WebsiteData): string {
  if (siteData.template === 'prime') return generatePrimeHTMLWithPlaceholders(siteData);
  if (siteData.template === 'euphoria') return generateEuphoriaHTMLWithPlaceholders(siteData);
  return generateHTMLWithPlaceholders(siteData);
}

/** Placeholder key -> real URL, keyed the same as the {{placeholders}} in rendered HTML. */
export function imageUrlMap(data: WebsiteData): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (key: string, url: unknown) => {
    if (typeof url === 'string' && url) map[key] = url;
  };
  put('hero', data.hero?.imageUrl);
  put('about', data.about?.imageUrl);
  (data.gallery || []).forEach((u, i) => put(`gallery${i}`, u));
  (data.craftImages || []).forEach((u, i) => put(`craft${i}`, u));
  (data.staff || []).forEach((s, i) => put(`staff${i}`, s?.photo));
  return map;
}

/**
 * The renderer wants 'has-image' markers where an image exists (the real URLs are
 * substituted afterwards). Mirrors forRender in the web's lib/publishSite.ts.
 */
export function forRender(sd: WebsiteData): WebsiteData {
  const m = imageUrlMap(sd);
  return {
    ...sd,
    hero: { ...sd.hero, imageUrl: m['hero'] ? 'has-image' : '' },
    about: { ...sd.about, imageUrl: m['about'] ? 'has-image' : '' },
    gallery: (sd.gallery || []).map((_, i) => (m[`gallery${i}`] ? 'has-image' : '')),
    craftImages: (sd.craftImages || []).map((_, i) => (m[`craft${i}`] ? 'has-image' : '')),
    staff: (sd.staff || []).map((s, i) => ({ ...s, photo: m[`staff${i}`] ? 'has-image' : '' })),
  };
}

/**
 * Fill {{hero}}, {{about}}, {{gallery{i}}}, {{craft{i}}}, {{staff{i}}} in rendered HTML
 * from the data's own URLs (preview). Mirrors the replacement in deployRenderedSite.
 */
export function withImages(html: string, data: WebsiteData): string {
  const m = imageUrlMap(data);
  return html.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (whole, key: string) => (m[key] !== undefined ? m[key] : whole));
}
