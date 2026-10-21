import type { WebsiteData } from '@/web/types';

/**
 * The gallery indices the current design renders. Design 1 (luxe, or unset)
 * shows 2..7 as "Our Work" (0 and 1 feed other parts of the page); Design 2
 * (prime) shows the first six.
 */
export function gallerySlots(d: WebsiteData): number[] {
  return d.template === 'prime' ? [0, 1, 2, 3, 4, 5] : [2, 3, 4, 5, 6, 7];
}

function withSlot(d: WebsiteData, index: number, url: string): WebsiteData {
  if (!gallerySlots(d).includes(index)) return d;
  const next = [...(d.gallery ?? [])];
  while (next.length <= index) next.push('');
  next[index] = url;
  return { ...d, gallery: next };
}

export function setGalleryPhoto(d: WebsiteData, index: number, url: string): WebsiteData {
  return url ? withSlot(d, index, url) : d;
}

/** Empties a slot, padding the array with '' so earlier indices keep their place. */
export function clearGalleryPhoto(d: WebsiteData, index: number): WebsiteData {
  return withSlot(d, index, '');
}
