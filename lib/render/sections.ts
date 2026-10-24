// Per-page section settings (plan 2026-10-24, sections 4 and 6a): `pageSections[<page type>] = { hidden, order }`.
//
// The page types and their section ids are a CLOSED set, keyed by page TYPE (not by slug), so renaming or reordering a
// service never loses a setting. Unknown page types, unknown ids, repeats and non-strings are ignored; a section left out
// of `order` keeps its default place after the listed ones. Hiding a section only stops it printing: the data stays.
// What is not a section (the heading, price, meta and the "also see" links) is fixed and always prints.
//
// Pure, no DOM. Imports only vendored modules.
import type { WebsiteData } from '../../types';
import { EXTRA_PAGES } from './copyLibrary.js';

export const SECTION_PAGES = ['service', 'first-visit', 'hair-care', 'beard-care', 'faq', 'location'] as const;
export type SectionPage = (typeof SECTION_PAGES)[number];
export const isSectionPage = (k: unknown): k is SectionPage => typeof k === 'string' && (SECTION_PAGES as readonly string[]).includes(k);

const blockIds = (page: 'faq' | 'first-visit' | 'hair-care' | 'beard-care'): string[] => EXTRA_PAGES[page].blocks.map((b) => b.id);

/** Every section of each page type, in the default order. `cta` is the Book button; `hero` the photo under the heading. */
export const SECTION_IDS: Record<SectionPage, readonly string[]> = {
  service: ['hero', 'description', 'guide', 'cta', 'team', 'others'],
  'first-visit': ['hero', ...blockIds('first-visit'), 'prices', 'cta'],
  'hair-care': ['hero', ...blockIds('hair-care'), 'often', 'cta'],
  'beard-care': ['hero', ...blockIds('beard-care'), 'services', 'cta'],
  faq: [...blockIds('faq'), 'cta'],
  location: ['map', 'hours', 'services', 'team', 'rating'],
};

/** The section page type a page file belongs to, or null (About, Team, Gallery ... have no section settings). */
export function sectionPageOf(file: { key: string; child?: unknown }): SectionPage | null {
  if (file.key === 'services') return file.child ? 'service' : null;
  return file.key === 'first-visit' || file.key === 'hair-care' || file.key === 'beard-care' || file.key === 'faq' || file.key === 'location' ? file.key : null;
}

export interface SectionState { id: string; hidden: boolean }

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The sections of one page type in the order they print, each with its hidden flag. Always every section of the page. */
export function pageSectionsOf(d: Pick<WebsiteData, 'pageSections'>, page: SectionPage): SectionState[] {
  const all = SECTION_IDS[page];
  const raw = d.pageSections && typeof d.pageSections === 'object' && !Array.isArray(d.pageSections) && own(d.pageSections, page) ? (d.pageSections as Record<string, unknown>)[page] : null;
  const cfg = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { hidden?: unknown; order?: unknown }) : {};
  const listed = (v: unknown): string[] => {
    const out: string[] = [];
    if (Array.isArray(v)) for (const id of v.slice(0, 64)) if (typeof id === 'string' && all.includes(id) && !out.includes(id)) out.push(id);
    return out;
  };
  const order = listed(cfg.order);
  const hidden = new Set(listed(cfg.hidden));
  return [...order, ...all.filter((id) => !order.includes(id))].map((id) => ({ id, hidden: hidden.has(id) }));
}

/** The visible sections of a page in order: `parts[id]` printed for each one that has markup. */
export function composeSections(d: Pick<WebsiteData, 'pageSections'>, page: SectionPage, parts: Record<string, string>): string {
  return pageSectionsOf(d, page).filter((s) => !s.hidden).map((s) => (own(parts, s.id) ? parts[s.id] : '')).join('');
}
