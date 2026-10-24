import type { WebsiteData } from '@/web/types';
import { generateHTMLWithPlaceholders } from '@/web/lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '@/web/lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '@/web/lib/render/euphoria';
import { imageUrlMapOf } from '@/web/lib/render/site';

/** Same template switch as the web's lib/publishSite.ts renderSite. */
export function renderSite(siteData: WebsiteData): string {
  if (siteData.template === 'prime') return generatePrimeHTMLWithPlaceholders(siteData);
  if (siteData.template === 'euphoria') return generateEuphoriaHTMLWithPlaceholders(siteData);
  return generateHTMLWithPlaceholders(siteData);
}

/** Placeholder key -> real URL, keyed the same as the {{placeholders}} in rendered HTML. */
export function imageUrlMap(data: WebsiteData): Record<string, string> {
  // The vendored renderer's own map, so the preview and the deploy agree (it adds the page-hero keys `service<i>` and
  // `page-<key>` for a site that carries extraPages).
  return imageUrlMapOf(data);
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
 * An image URL as it may appear inside a double-quoted HTML attribute: only
 * http(s) URLs are allowed (anything else, e.g. javascript: or data:, becomes
 * ''), and the HTML-significant characters are entity-encoded so a URL can
 * never close the attribute or open a tag.
 */
export function safeImageUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return '';
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Fill {{hero}}, {{about}}, {{gallery{i}}}, {{craft{i}}}, {{staff{i}}}, {{service{i}}}, {{page-<key>}} in rendered HTML
 * from the data's own URLs (preview). Mirrors the replacement in deployRenderedSite,
 * plus safeImageUrl() on every substituted value.
 */
export function withImages(html: string, data: WebsiteData): string {
  const m = imageUrlMap(data);
  return html.replace(/\{\{([a-zA-Z0-9-]+)\}\}/g, (whole, key: string) => (m[key] !== undefined ? safeImageUrl(m[key]) : whole));
}
