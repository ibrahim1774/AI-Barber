import type { WebsiteData } from '@/web/types';
import { isStockImage } from '@/web/lib/stockImages';
import { setPath } from '@/lib/editable';
import { heroOfPage, type PageRef } from '@/lib/pageFile';

/** A photo link as it is stored: trimmed (a pasted link may carry spaces or a line break). */
export const cleanImageUrl = (url: unknown): string => (typeof url === 'string' ? url.trim() : '');

export const SAMPLE_HERO_NOTE = 'Sample photo — replace with yours';

/** Whether a data path is a page hero (a service page or a guide page photo). */
export const isHeroPath = (path: string): boolean => /^services\.\d+\.imageUrl$/.test(path) || /^extraPages\.images\.(first-visit|hair-care|beard-care)$/.test(path);

/**
 * Store a photo link at any image path. The link is trimmed first; an empty or non-http(s) link is not stored
 * (the data is returned unchanged).
 */
export function setPhoto(d: WebsiteData, path: string, url: string): WebsiteData {
  const clean = cleanImageUrl(url);
  return /^https?:\/\//i.test(clean) ? setPath(d, path, clean) : d;
}

/** "Use sample photo": clear the slot so the page shows its sample again. */
export function clearHero(d: WebsiteData, path: string): WebsiteData {
  return isHeroPath(path) ? setPath(d, path, '') : d;
}

/** The slot paths on screen whose photo is still a sample (the editor shows its prompt on them; the site never does). */
export function sampleHeroPaths(d: WebsiteData, page: PageRef | null | undefined): string[] {
  const h = heroOfPage(d, page);
  return h && h.sample ? [h.path] : [];
}

/** The barber's own gallery photos (not samples), in order: the picker shows them first for a page hero. */
export function galleryChoices(d: WebsiteData): string[] {
  const out: string[] = [];
  for (const u of d.gallery ?? []) {
    const c = cleanImageUrl(u);
    if (/^https?:\/\//i.test(c) && !isStockImage(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
