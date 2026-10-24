import type { WebsiteData } from '@/web/types';
import { buildPageSet, type PageKey } from '@/web/lib/render/pages';
import { imageUrlMap } from '@/lib/render';
import { heroSlot, type HeroSlot } from '@/web/lib/render/heroes';

/** A page of the preview: a page key, plus the position of a service or barber for their own pages. */
export interface PageRef { key: PageKey; index?: number }

/** The shape the vendored renderer's page helpers (heroes, sections, copy keys) take. */
export interface PageFileRef { key: string; child?: { index: number } }

export const fileOfPage = (p: PageRef): PageFileRef => (p.index === undefined ? { key: p.key } : { key: p.key, child: { index: p.index } });

/** The hero photo slot of the page on screen, or null (no slot on this page, or the site has no extra pages data). */
export function heroOfPage(d: WebsiteData, p: PageRef | null | undefined): HeroSlot | null {
  if (!p) return null;
  return heroSlot(d, fileOfPage(p), imageUrlMap(d));
}

/** The indexes of the services that have a page of their own (the guide of each is shown there). */
export const servicePageIndexes = (d: WebsiteData): number[] => buildPageSet(d, { imageUrls: imageUrlMap(d) }).services.map((c) => c.index);
