import type { WebsiteData } from '@/web/types';
import { DEMO_GALLERY_STOCK } from '@/web/lib/stockImages';
import { gallerySlots } from '@/lib/sections/gallery';
import type { ServicePicks } from '@/lib/serviceChecklist';

/** Ticked on the Start-from-scratch form so a new site shows a Services section; the barber can untick any of them. */
export const SCRATCH_SERVICE_PICKS: readonly string[] = ['Haircut', 'Beard trim', 'Haircut & beard'];

export function scratchPicks(): ServicePicks {
  return Object.fromEntries(SCRATCH_SERVICE_PICKS.map((t) => [t, { on: true }]));
}

/**
 * Fills every empty gallery slot the design renders with a sample photo (the editor then offers "Add photos" /
 * Change image on them); a photo already in a slot is kept. Pure.
 */
export function seedGallery(site: WebsiteData): WebsiteData {
  const gallery = [...(site.gallery ?? [])];
  let k = 0;
  for (const i of gallerySlots(site)) {
    while (gallery.length <= i) gallery.push('');
    if (!gallery[i] && k < DEMO_GALLERY_STOCK.length) gallery[i] = DEMO_GALLERY_STOCK[k++];
  }
  return { ...site, gallery };
}
