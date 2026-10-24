import type { WebsiteData } from '@/web/types';
import {
  buildPageSet, isMultiPage, memberHasOwnContent, pageList, SERVICE_PAGE_CAP, type ChildPage, type PageKey, type PagesModel,
} from '@/web/lib/render/pages';
import { imageUrlMap } from '@/lib/render';
import type { PreviewPage } from '@/lib/editable';

/**
 * The Pages feature of the editor (spec 2026-10-23, P3b). Which pages a site has is decided by the
 * vendored renderer from the barber's own data; the app only stores the nav order and the pages the
 * barber turned off in `WebsiteData.pages`. Absent = a single-page site (nothing changes until the
 * Pages sheet is first saved).
 */

export const PAGE_TITLES: Record<PageKey, string> = {
  home: 'Home', about: 'About', services: 'Services', team: 'Team', gallery: 'Gallery', reviews: 'Reviews',
  hours: 'Hours', location: 'Location', contact: 'Contact', book: 'Book', shop: 'Shop',
  faq: 'FAQ', 'first-visit': 'First visit', 'hair-care': 'Hair care', 'beard-care': 'Beard care',
};

/** Every eligible page on, default order: what a newly generated site starts with. */
export const defaultPages = (): PagesModel => ({ order: [], hidden: [] });

/** A newly generated site opts in; one that already chose (even with every page off) keeps its choice. */
export function withPagesByDefault(d: WebsiteData): WebsiteData {
  return d.pages ? d : { ...d, pages: defaultPages() };
}

/** An existing single-page site must be confirmed once before it becomes multi-page. */
export const needsMultiPageConfirm = (d: WebsiteData): boolean => !isMultiPage(d);

const ctxOf = (d: WebsiteData) => ({ imageUrls: imageUrlMap(d) });

export interface PageRow { key: PageKey; title: string; on: boolean; locked: boolean; children: number }

/** The Pages sheet's rows: every eligible page in the barber's order, Home first and locked on. */
export function pageRows(d: WebsiteData): PageRow[] {
  return pageList(d, ctxOf(d)).map((r) => ({ key: r.key, title: PAGE_TITLES[r.key], on: r.on || r.locked, locked: r.locked, children: r.children }));
}

/** Move a row; Home stays first. Out-of-range or no-op moves return the same array. */
export function moveRow<T extends { key: PageKey }>(rows: T[], from: number, to: number): T[] {
  const last = rows.length - 1;
  if (from < 1 || from > last) return rows;
  const target = Math.max(1, Math.min(last, to));
  if (target === from) return rows;
  const next = [...rows];
  const [r] = next.splice(from, 1);
  next.splice(target, 0, r);
  return next;
}

export function setRowOn<T extends { key: PageKey; on: boolean; locked: boolean }>(rows: T[], key: PageKey, on: boolean): T[] {
  return rows.map((r) => (r.key === key && !r.locked ? { ...r, on } : r));
}

/** What a Save writes: the sheet's order (without Home) and the keys switched off. */
export function pagesFromRows(rows: { key: PageKey; on: boolean; locked: boolean }[]): PagesModel {
  return {
    order: rows.filter((r) => r.key !== 'home').map((r) => r.key),
    hidden: rows.filter((r) => !r.locked && !r.on).map((r) => r.key),
  };
}

export const withPages = (d: WebsiteData, model: PagesModel): WebsiteData => ({ ...d, pages: model });

/** The preview's page switcher: the pages in the nav, and the per-item pages of Services and Team. */
export interface PageChips {
  top: { key: PageKey; title: string }[];
  children: Partial<Record<'services' | 'team', (ChildPage & { index: number })[]>>;
}

/** Empty for a single-page site (nothing to switch). */
export function pageChips(d: WebsiteData): PageChips {
  if (!isMultiPage(d)) return { top: [], children: {} };
  const set = buildPageSet(d, ctxOf(d));
  const top = set.nav.filter((k) => set.files.some((f) => f.key === k && !f.child)).map((key) => ({ key, title: PAGE_TITLES[key] }));
  return { top, children: { services: set.services, team: set.team } };
}

/** The page to show: the wanted one when it still exists, otherwise Home (a page turned off or an item removed). */
export function resolvePage(d: WebsiteData, want: PreviewPage | null | undefined): PreviewPage {
  if (!want || want.key === 'home' || !isMultiPage(d)) return { key: 'home' };
  const set = buildPageSet(d, ctxOf(d));
  if (!set.files.some((f) => f.key === want.key && !f.child)) return { key: 'home' };
  if (want.index === undefined) return { key: want.key };
  const kids = want.key === 'services' ? set.services : want.key === 'team' ? set.team : [];
  return kids.some((c) => c.index === want.index) ? { key: want.key, index: want.index } : { key: want.key };
}

/** Inline hints (never generated text). */
export const BARBER_PAGE_HINT = 'Add a description to get a page for this barber';
export const MULTI_PAGE_NOTE = 'Your site will become a multi-page site';

/** Titled services past the cap: listed on the Services page but without a page of their own. */
export const servicesOverCapOf = (d: WebsiteData): number => buildPageSet(d, ctxOf(d)).servicesOverCap;
export const servicesOverCapNote = (n: number): string | null => (n > 0 ? `Only the first ${SERVICE_PAGE_CAP} services get their own page.` : null);

export function barberNeedsDescription(d: WebsiteData, i: number): boolean {
  const m = d.staff?.[i];
  return !!m && typeof m.name === 'string' && m.name.trim() !== '' && !memberHasOwnContent(m, d.hours);
}
