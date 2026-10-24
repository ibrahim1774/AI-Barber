// The hero photo slot of a page (plan 2026-10-24, section 4): service pages and the First visit, Hair care and Beard
// care pages show one picture under the heading.
//
//   service page  -> the service's own `services[i].imageUrl`          placeholder key `service<i>`
//   guide page    -> `extraPages.images[<page>]`                      placeholder key `page-<page>`
//
// No photo: a SAMPLE from the existing sample set (DEMO_GALLERY_STOCK, picked by a fixed guide -> index table), printed
// as its own URL. A sample is never stored in the data, never reaches the Gallery (which filters isStockImage), is
// never captioned as the shop's work (the alt text is the service or page name) and is flagged `sample: true` here so
// the app can ask the barber to replace it. A stock URL stored in the slot (the barber picked "sample") is the same.
//
// Only sites that opted into pages v2 (they carry `extraPages`) have a hero; every older site renders as before.
// Pure, no DOM. Imports only vendored modules.
import type { WebsiteData } from '../../types';
import { DEMO_GALLERY_STOCK, isStockImage } from '../stockImages.js';
import { guideIdForTitle } from './guides.js';
import type { GuideId } from './copyRules.js';

export const HERO_EXTRA_PAGES = ['first-visit', 'hair-care', 'beard-care'] as const;
export type HeroExtraPage = (typeof HERO_EXTRA_PAGES)[number];

/** Fixed table: which sample (index in DEMO_GALLERY_STOCK) a service guide / guide page shows when there is no photo. */
export const SAMPLE_FOR_GUIDE: Record<GuideId, number> = {
  'cut-beard': 3, fade: 1, taper: 2, 'line-up': 4, 'beard-trim': 5, shave: 6, 'kids-cut': 7, design: 0, color: 6, haircut: 2,
};
export const SAMPLE_FOR_PAGE: Record<HeroExtraPage, number> = { 'first-visit': 5, 'hair-care': 1, 'beard-care': 3 };

type FileLike = { key: string; child?: { index: number } | null };

const isHttp = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);
const isHeroExtra = (k: unknown): k is HeroExtraPage => typeof k === 'string' && (HERO_EXTRA_PAGES as readonly string[]).includes(k);

/** Placeholder key of a page's hero, or null when the page has none. */
export function heroKeyOf(file: FileLike): string | null {
  if (file.key === 'services' && file.child) return `service${file.child.index}`;
  if (isHeroExtra(file.key)) return `page-${file.key}`;
  return null;
}

/** The data path the app edits for a page's hero ("Change image"). */
export function heroPathOf(file: FileLike): string | null {
  if (file.key === 'services' && file.child) return `services.${file.child.index}.imageUrl`;
  if (isHeroExtra(file.key)) return `extraPages.images.${file.key}`;
  return null;
}

/** The sample shown on a page that has no photo. */
export function sampleHeroUrl(d: Pick<WebsiteData, 'services'>, file: FileLike): string {
  const n = DEMO_GALLERY_STOCK.length;
  if (file.key === 'services' && file.child) {
    const g = guideIdForTitle((Array.isArray(d.services) ? d.services : [])[file.child.index]?.title) ?? 'haircut';
    return DEMO_GALLERY_STOCK[SAMPLE_FOR_GUIDE[g] % n];
  }
  if (isHeroExtra(file.key)) return DEMO_GALLERY_STOCK[SAMPLE_FOR_PAGE[file.key] % n];
  return '';
}

export interface HeroSlot {
  /** Placeholder key (`service2`, `page-hair-care`). */
  key: string;
  /** Data path (`services.2.imageUrl`, `extraPages.images.hair-care`). */
  path: string;
  /** The barber put a photo in this slot (their own, or a stock URL they picked). */
  own: boolean;
  /** What the page shows is a sample photo: the app should offer to replace it. */
  sample: boolean;
  /** The URL shown: the slot's photo, else the sample. */
  url: string;
}

/** The raw value stored in the slot (any string), '' when none. */
function rawOf(d: WebsiteData, file: FileLike): unknown {
  if (file.key === 'services' && file.child) return (Array.isArray(d.services) ? d.services : [])[file.child.index]?.imageUrl;
  const images = d.extraPages && typeof d.extraPages === 'object' ? (d.extraPages as { images?: unknown }).images : null;
  if (isHeroExtra(file.key) && images && typeof images === 'object' && Object.prototype.hasOwnProperty.call(images, file.key)) return (images as Record<string, unknown>)[file.key];
  return '';
}

/**
 * The hero of one page, or null (no slot on this page, or the site never opted into pages v2). `imageUrls` is the
 * placeholder map; when absent the slot's own value is read. A value that is not an http(s) URL is no photo.
 */
export function heroSlot(d: WebsiteData, file: FileLike, imageUrls?: Record<string, string> | null): HeroSlot | null {
  const key = heroKeyOf(file);
  const path = heroPathOf(file);
  if (!key || !path) return null;
  if (!d.extraPages || typeof d.extraPages !== 'object' || Array.isArray(d.extraPages)) return null;
  const fromMap = imageUrls && Object.prototype.hasOwnProperty.call(imageUrls, key) ? imageUrls[key] : undefined;
  const own = isHttp(fromMap) ? fromMap : imageUrls ? '' : isHttp(rawOf(d, file)) ? (rawOf(d, file) as string) : '';
  if (own) return { key, path, own: true, sample: isStockImage(own), url: own };
  return { key, path, own: false, sample: true, url: sampleHeroUrl(d, file) };
}

/** Every hero slot of a site, in page order (the services in the barber's order, then the guide pages), for the app's pickers. */
export function heroSlotsOf(d: WebsiteData): HeroSlot[] {
  if (!d.extraPages || typeof d.extraPages !== 'object') return [];
  const out: HeroSlot[] = [];
  (Array.isArray(d.services) ? d.services : []).forEach((s, index) => {
    if (typeof s?.title === 'string' && s.title.trim()) { const h = heroSlot(d, { key: 'services', child: { index } }); if (h) out.push(h); }
  });
  for (const k of HERO_EXTRA_PAGES) { const h = heroSlot(d, { key: k }); if (h) out.push(h); }
  return out;
}
