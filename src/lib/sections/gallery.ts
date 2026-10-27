import type { WebsiteData } from '@/web/types';
import { DEMO_GALLERY_STOCK, isStockImage } from '@/web/lib/stockImages';

/** Photos a site shows in its gallery, in every design. */
export const GALLERY_TARGET = 6;

/**
 * The gallery indices the current design renders. Design 1 (luxe, or unset)
 * shows 2..7 as "Our Work" (0 and 1 feed other parts of the page); Design 2
 * (prime) shows the first six. Euphoria renders every filled slot, so it gets
 * 0..7, or up to one past the last filled slot when a site has more.
 */
export function gallerySlots(d: WebsiteData): number[] {
  if (d.template === 'prime') return [0, 1, 2, 3, 4, 5];
  if (d.template === 'euphoria') {
    let last = -1;
    (d.gallery ?? []).forEach((u, i) => { if (u) last = i; });
    return Array.from({ length: Math.max(8, last + 2) }, (_, i) => i);
  }
  return [2, 3, 4, 5, 6, 7];
}

/** Slots the barber removed by hand (kept in the site data so a removal survives sign out/in and design switches). */
export function galleryRemoved(d: WebsiteData): number[] {
  const r = (d as { galleryRemoved?: unknown }).galleryRemoved;
  return Array.isArray(r) ? r.filter((n): n is number => Number.isInteger(n)) : [];
}

function withRemoved(d: WebsiteData, list: number[]): WebsiteData {
  const next = { ...d } as WebsiteData & { galleryRemoved?: number[] };
  if (list.length) next.galleryRemoved = list.slice(0, GALLERY_TARGET);
  else delete next.galleryRemoved;
  return next;
}

/** The slots the current design actually prints a photo for (filled ones only). */
export function renderedGallerySlots(d: WebsiteData): number[] {
  const g = d.gallery ?? [];
  const slots = d.template === 'euphoria' ? g.map((_, i) => i) : gallerySlots(d);
  return slots.filter((i) => !!g[i]);
}

function withSlot(d: WebsiteData, index: number, url: string): WebsiteData {
  if (!gallerySlots(d).includes(index)) return d;
  const next = [...(d.gallery ?? [])];
  while (next.length <= index) next.push('');
  next[index] = url;
  return { ...d, gallery: next };
}

/** Puts a photo in a slot. Adding into a slot (or, failing that, any gap) cancels one earlier manual removal. */
export function setGalleryPhoto(d: WebsiteData, index: number, url: string): WebsiteData {
  if (!url) return d;
  const wasEmpty = !d.gallery?.[index];
  const out = withSlot(d, index, url);
  if (out === d) return d;
  const removed = galleryRemoved(d);
  if (!removed.length) return out;
  const drop = removed.includes(index) ? index : wasEmpty ? removed[0] : undefined;
  return drop === undefined ? out : withRemoved(out, removed.filter((n) => n !== drop));
}

/** Empties a slot, padding the array with '' so earlier indices keep their place. A filled slot is recorded as removed on purpose. */
export function clearGalleryPhoto(d: WebsiteData, index: number): WebsiteData {
  const wasFilled = !!d.gallery?.[index];
  const out = withSlot(d, index, '');
  if (out === d || !wasFilled) return out;
  const removed = galleryRemoved(d);
  return withRemoved(out, removed.includes(index) ? removed : [...removed, index]);
}

/**
 * Keeps the visible gallery at 6 photos (6 minus the ones the barber removed by hand), whatever the design:
 * Design 1 prints slots 2..7, Design 2 slots 0..5, Euphoria every filled slot. Empty slots the design prints are
 * filled with sample photos, never over a photo already there and never fewer-photo sites (under 6 photos in all,
 * counting removals, are left alone). A design that would show more than the target because a removal was made in another design drops spare
 * sample photos (never the barber's own; Euphoria slots 0/1 first). Same object when nothing changes. Pure.
 */
export function balanceGallery(d: WebsiteData): WebsiteData {
  const gallery = [...(d.gallery ?? [])];
  const removed = galleryRemoved(d);
  const target = Math.max(0, GALLERY_TARGET - removed.length);
  if (gallery.filter(Boolean).length + removed.length < GALLERY_TARGET) return d;
  // Only a site that still holds a sample photo is padded: one made entirely of the barber's own photos (a Google
  // import, or a removal made before the marker existed or on the web editor) never gets samples added.
  if (!gallery.some((u) => u && isStockImage(u))) return d;
  let rendered = renderedGallerySlots(d).length;
  let changed = false;
  if (rendered < target) {
    const fillable = d.template === 'euphoria' ? [2, 3, 4, 5, 6, 7] : gallerySlots(d);
    const empty = fillable.filter((i) => !gallery[i]);
    const order = [...empty.filter((i) => !removed.includes(i)), ...empty.filter((i) => removed.includes(i))];
    const used = new Set(gallery.filter(Boolean).map((u) => u.split('?')[0]));
    const spare = DEMO_GALLERY_STOCK.filter((u) => !used.has(u.split('?')[0]));
    for (const i of order) {
      if (rendered >= target || !spare.length) break;
      while (gallery.length <= i) gallery.push('');
      gallery[i] = spare.shift()!;
      rendered++; changed = true;
    }
  } else if (rendered > target) {
    const shownSlots = renderedGallerySlots(d);
    const order = d.template === 'euphoria' ? [0, 1, ...shownSlots.filter((i) => i > 1).reverse()] : [...shownSlots].reverse();
    // A photo the barber picked from the sample set counts as a sample here and may be dropped; accepted.
    for (const i of order) {
      if (rendered <= target) break;
      if (gallery[i] && isStockImage(gallery[i])) { gallery[i] = ''; rendered--; changed = true; }
    }
  }
  return changed ? { ...d, gallery } : d;
}

/**
 * A copy of the site that replaces local data wholesale (admin sync, a 409 at publish, the account row) with the
 * local manual removals kept for slots that are still empty in it, so balanceGallery never refills them.
 */
export function keepRemoved(local: WebsiteData | undefined | null, adopted: WebsiteData): WebsiteData {
  if (!local) return adopted;
  const keep = galleryRemoved(local).filter((i) => !adopted.gallery?.[i]);
  const merged = [...new Set([...galleryRemoved(adopted).filter((i) => !adopted.gallery?.[i]), ...keep])];
  const same = merged.length === galleryRemoved(adopted).length && merged.every((i) => galleryRemoved(adopted).includes(i));
  return same ? adopted : withRemoved(adopted, merged);
}
