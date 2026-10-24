import type { WebsiteData } from '@/web/types';
import { isStockImage } from '@/web/lib/stockImages';
import { photoSlots } from '@/lib/editor';
import { getPath } from '@/lib/editable';

/** What the import actually put in the draft, for "Here's what we found". Nothing here is estimated: a count is what the site holds. */
export interface ImportCounts {
  services: number;
  photos: number;
  reviews: number;
  /** Days with opening hours (closed days do not count). */
  hours: number;
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

export function importCounts(d: WebsiteData): ImportCounts {
  const services = (d.services ?? []).filter((s) => filled(s?.title)).length;
  // Photos: distinct non-sample pictures in the slots the site shows. Sample (stock) photos are the generator's, not the import's.
  const urls = new Set<string>();
  for (const p of photoSlots(d)) {
    const v = getPath(d, p);
    if (filled(v) && !isStockImage(v as string)) urls.add((v as string).trim());
  }
  const reviews = (d.reviews ?? []).filter((r) => filled(r?.comment)).length;
  const hours = (d.hours ?? []).filter((h) => h && !h.closed && filled(h.open) && filled(h.close)).length;
  return { services, photos: urls.size, reviews, hours };
}
