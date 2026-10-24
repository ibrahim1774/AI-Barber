import type { WebsiteData } from '@/web/types';
import { pageSectionsOf, sectionPageOf, type SectionPage } from '@/web/lib/render/sections';
import { visibleCopyKeys } from '@/web/lib/render/guides';
import { extraPageRows, isExtraKey } from '@/web/lib/render/pages';
import { imageUrlMap } from '@/lib/render';
import { copyLabel } from '@/lib/editor';
import { fileOfPage, servicePageIndexes, type PageRef } from '@/lib/pageFile';
import type { SectionKey } from '@/lib/sections/list';

/**
 * "Edit this page": the sections of one page (hide, reorder) and its text. The layout is stored per page TYPE
 * (`pageSections.service` is shared by every service page), as the vendored renderer reads it.
 */

export type SectionRowKind = 'photo' | 'text' | 'guide' | 'data' | 'fixed';

export interface SectionRow {
  id: string;
  label: string;
  hidden: boolean;
  kind: SectionRowKind;
  /** text: the library block this row edits. */
  copyKey?: string;
  /** data: the editor where the facts come from. */
  source?: SectionKey;
}

const FIXED_LABEL: Record<string, string> = {
  hero: 'Photo', description: 'Your description', guide: 'About this service', cta: 'Book button', team: 'Who offers it',
  others: 'Other services', prices: 'Prices', often: 'How often', services: 'Services', map: 'Map', hours: 'Hours', rating: 'Rating',
};
const PAGE_LABEL: Partial<Record<SectionPage, Record<string, string>>> = {
  location: { team: 'Team', services: 'Services here' },
  'beard-care': { services: 'Beard services' },
};

const SOURCE: Record<SectionPage, Record<string, SectionKey>> = {
  service: { description: 'services', team: 'team', others: 'services' },
  'first-visit': { prices: 'services' },
  'hair-care': { often: 'services' },
  'beard-care': { services: 'services' },
  faq: {},
  location: { map: 'contact', hours: 'hours', services: 'services', team: 'team', rating: 'reviews' },
};

/** The section page type of a preview page, or null (Home, About, Team ... have no section settings). */
export const sectionPageFor = (p: PageRef | null | undefined): SectionPage | null => (p ? sectionPageOf(fileOfPage(p)) : null);

/** The library text keys shown on a page (the same ones the preview can tap). */
export const copyKeysOfPage = (d: WebsiteData, p: PageRef): string[] => visibleCopyKeys(d, fileOfPage(p), servicePageIndexes(d));

/** Every section of the page in the order it prints. Text blocks that have nothing to say for this shop are left out. */
export function sectionRows(d: WebsiteData, p: PageRef): SectionRow[] {
  const page = sectionPageFor(p);
  if (!page) return [];
  const keys = copyKeysOfPage(d, p);
  const rows: SectionRow[] = [];
  for (const s of pageSectionsOf(d, page)) {
    const base = { id: s.id, hidden: s.hidden };
    if (s.id === 'hero') { rows.push({ ...base, label: FIXED_LABEL.hero, kind: 'photo' }); continue; }
    if (page === 'service' && s.id === 'guide') {
      if (keys.length) rows.push({ ...base, label: FIXED_LABEL.guide, kind: 'guide' });
      continue;
    }
    const ck = page === 'service' ? null : `${page}.${s.id}`;
    if (ck && keys.includes(ck)) { rows.push({ ...base, label: copyLabel(ck), kind: 'text', copyKey: ck }); continue; }
    if (s.id === 'cta') { rows.push({ ...base, label: FIXED_LABEL.cta, kind: 'fixed' }); continue; }
    if (ck && !FIXED_LABEL[s.id]) continue; // a library block with nothing to print here
    rows.push({ ...base, label: PAGE_LABEL[page]?.[s.id] ?? FIXED_LABEL[s.id] ?? s.id, kind: 'data', source: SOURCE[page][s.id] });
  }
  return rows;
}

/** The pageSections entry as it is stored: the full order and the hidden ids (fresh objects, nothing shared). */
function stored(d: WebsiteData, page: SectionPage): { order: string[]; hidden: string[] } {
  const all = pageSectionsOf(d, page);
  return { order: all.map((s) => s.id), hidden: all.filter((s) => s.hidden).map((s) => s.id) };
}

const put = (d: WebsiteData, page: SectionPage, entry: { order: string[]; hidden: string[] }): WebsiteData => ({
  ...d,
  pageSections: { ...(d.pageSections ?? {}), [page]: entry },
});

export function setSectionHidden(d: WebsiteData, page: SectionPage, id: string, hidden: boolean): WebsiteData {
  const cur = stored(d, page);
  if (!cur.order.includes(id)) return d;
  const set = new Set(cur.hidden);
  if (hidden) set.add(id); else set.delete(id);
  return put(d, page, { order: cur.order, hidden: cur.order.filter((x) => set.has(x)) });
}

/**
 * Moving a visible row one step up or down must skip sections that are not listed (a text block with nothing to
 * say): the row list is the visible subset of the stored order. Returns the id to swap with, or null.
 */
export function neighbour(rows: SectionRow[], id: string, delta: -1 | 1): string | null {
  const i = rows.findIndex((r) => r.id === id);
  const j = i + delta;
  return i < 0 || j < 0 || j >= rows.length ? null : rows[j].id;
}

/** Move a row past its visible neighbour (the hidden-from-list sections in between keep their relative place). */
export function moveRowBy(d: WebsiteData, p: PageRef, id: string, delta: -1 | 1): WebsiteData {
  const page = sectionPageFor(p);
  if (!page) return d;
  const other = neighbour(sectionRows(d, p), id, delta);
  if (!other) return d;
  const cur = stored(d, page);
  const order = cur.order.filter((x) => x !== id);
  const at = order.indexOf(other);
  order.splice(delta === 1 ? at + 1 : at, 0, id);
  return put(d, page, { order, hidden: cur.hidden });
}

/** Why hiding sections could make the page disappear: the renderer's reason for a guide page that is off, else null. */
export function pageGoneReason(d: WebsiteData, p: PageRef): string | null {
  if (!isExtraKey(p.key)) return null;
  const row = extraPageRows(d, { imageUrls: imageUrlMap(d) }).find((r) => r.key === p.key);
  return row && !row.eligible ? row.reason : null;
}
