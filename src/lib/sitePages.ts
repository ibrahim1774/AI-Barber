import type { WebsiteData } from '@/web/types';
import {
  buildPageSet, cleanExtraPages, defaultExtraPages, extraPageRows, isExtraKey, isMultiPage, memberHasOwnContent, pageList, SERVICE_PAGE_CAP,
  type ChildPage, type ExtraKey, type ExtraPagesModel, type PageKey, type PagesModel,
} from '@/web/lib/render/pages';
import { NAV_VISIBLE } from '@/web/lib/render/shell';
import { imageUrlMap } from '@/lib/render';
import { textValue, type PreviewPage } from '@/lib/editable';

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

/** A seed for the wording choice of the library text. Stored once in the site data, so the preview and the publish agree. */
export const newSeed = (): number => Math.floor(Math.random() * 2147483647);

/**
 * A newly generated site opts in: every page it has data for, plus the suggested guide pages (FAQ, First visit and
 * the service guides; Hair care and Beard care stay off). A site that already chose (even with every page off) keeps
 * its choice, and an existing site that has no extraPages gains none here: it adds them in the Pages sheet.
 */
export function withPagesByDefault(d: WebsiteData, seed: () => number = newSeed): WebsiteData {
  if (d.pages) return d;
  return { ...d, pages: defaultPages(), extraPages: d.extraPages ?? defaultExtraPages(seed()) };
}

/** An existing single-page site must be confirmed once before it becomes multi-page. */
export const needsMultiPageConfirm = (d: WebsiteData): boolean => !isMultiPage(d);

const ctxOf = (d: WebsiteData) => ({ imageUrls: imageUrlMap(d) });

export interface PageRow {
  key: PageKey;
  title: string;
  on: boolean;
  locked: boolean;
  children: number;
  /** menu: in the site's menu order; suggested: a guide page that is off or cannot exist yet. */
  group: 'menu' | 'suggested';
  /** A guide page (FAQ, First visit, Hair care, Beard care): its on/off state is `extraPages.on`, never `pages.hidden`. */
  extra: boolean;
  /** Suggested rows: false when the shop's data does not support the page yet. */
  eligible: boolean;
  /** Why a disabled row cannot be added ('' otherwise). */
  reason: string;
}

/**
 * The Pages sheet's rows: every eligible page in the barber's order (Home first and locked on), then the guide
 * pages that are off or cannot exist yet, each with the reason when it cannot.
 */
export function pageRows(d: WebsiteData): PageRow[] {
  const ctx = ctxOf(d);
  const menu: PageRow[] = pageList(d, ctx).map((r) => ({
    key: r.key, title: PAGE_TITLES[r.key], on: r.on || r.locked, locked: r.locked, children: r.children,
    group: 'menu', extra: isExtraKey(r.key), eligible: true, reason: '',
  }));
  const inMenu = new Set(menu.map((r) => r.key));
  const suggested: PageRow[] = extraPageRows(d, ctx)
    .filter((r) => !inMenu.has(r.key))
    .map((r) => ({
      key: r.key, title: PAGE_TITLES[r.key], on: false, locked: false, children: 0,
      group: 'suggested', extra: true, eligible: r.eligible, reason: r.reason,
    }));
  return [...menu, ...suggested];
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

/** Menu rows only (the order the barber sees and drags). */
export const menuRows = (rows: PageRow[]): PageRow[] => rows.filter((r) => r.group === 'menu');
export const suggestedRows = (rows: PageRow[]): PageRow[] => rows.filter((r) => r.group === 'suggested');

/** Add a suggested guide page: it joins the end of the menu, on. A page the data cannot support yet is not added. */
export function addSuggested(rows: PageRow[], key: PageKey): PageRow[] {
  const row = rows.find((r) => r.key === key && r.group === 'suggested');
  if (!row || !row.eligible) return rows;
  return [...menuRows(rows), { ...row, group: 'menu' as const, on: true }, ...suggestedRows(rows).filter((r) => r.key !== key)];
}

/**
 * What a Save writes to `pages`: the menu order (without Home) and the pages switched off. A guide page is never
 * written to `hidden`: older builds drop keys they do not know from `hidden` and the page would come back on.
 */
export function pagesFromRows(rows: { key: PageKey; on: boolean; locked: boolean; group?: 'menu' | 'suggested' }[]): PagesModel {
  const menu = rows.filter((r) => r.group !== 'suggested');
  return {
    order: menu.filter((r) => r.key !== 'home').map((r) => r.key),
    hidden: menu.filter((r) => !r.locked && !r.on && !isExtraKey(r.key)).map((r) => r.key),
  };
}

/** The guide pages the rows leave on, in the menu order; a suggested page that cannot exist yet keeps its earlier choice. */
export function extraOnFromRows(rows: PageRow[], previous: readonly ExtraKey[]): ExtraKey[] {
  const out: ExtraKey[] = [];
  for (const r of rows) if (isExtraKey(r.key) && r.group === 'menu' && r.on && !out.includes(r.key)) out.push(r.key);
  for (const r of rows) if (isExtraKey(r.key) && r.group === 'suggested' && !r.eligible && previous.includes(r.key) && !out.includes(r.key)) out.push(r.key);
  return out;
}

export interface PagesChange { pages: PagesModel; extraPages: ExtraPagesModel | undefined }

/**
 * Everything one Save of the Pages sheet writes. Guide pages go on and off ONLY through `extraPages.on`. A site
 * with no extraPages that turns none on and keeps guides off stays without (nothing new for it); the seed is made
 * the first time extraPages is written and never changes after.
 */
export function changeFromRows(d: WebsiteData, rows: PageRow[], serviceGuides: boolean, seed: () => number = newSeed): PagesChange {
  const pages = pagesFromRows(rows);
  const prev = d.extraPages ? cleanExtraPages(d.extraPages) : null;
  const on = extraOnFromRows(rows, prev?.on ?? []);
  if (!d.extraPages && on.length === 0 && !serviceGuides) return { pages, extraPages: undefined };
  const base: ExtraPagesModel = d.extraPages ? { ...(d.extraPages as ExtraPagesModel) } : { on: [] };
  const next: ExtraPagesModel = { ...base, on, serviceGuides };
  if (typeof next.seed !== 'number') next.seed = seed();
  return { pages, extraPages: next };
}

export const withPageChange = (d: WebsiteData, c: PagesChange): WebsiteData => {
  const { extraPages: _old, ...rest } = d;
  void _old;
  return { ...rest, pages: c.pages, ...(c.extraPages ? { extraPages: c.extraPages } : {}) };
};

/** True when a Save would change nothing. */
export const sameChange = (a: PagesChange, b: PagesChange): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The "service guides" switch: whether service pages carry the About-this-service text. */
export const serviceGuidesOn = (d: WebsiteData): boolean => d.extraPages?.serviceGuides === true;

/** Search over the sheet: a row matches when its title holds the typed words (case and spacing ignored). */
export const SEARCH_THRESHOLD = 12;
export const showSearch = (total: number): boolean => total > SEARCH_THRESHOLD;
export function matchesQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  return q === '' || title.toLowerCase().replace(/\s+/g, ' ').includes(q);
}

/** The service pages (n): every listed service with a page, for the sheet's second group. */
export interface ServiceRow { index: number; title: string }
export function serviceRows(d: WebsiteData): ServiceRow[] {
  return buildPageSet(d, ctxOf(d)).services.map((c) => ({ index: c.index, title: c.title }));
}

/** Index in `rows` after which the menu's "More" starts: the row after the NAV_VISIBLE-th one that is on. -1 for none. */
export function moreStartsAt(rows: { on: boolean }[]): number {
  let seen = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].on) continue;
    if (seen === NAV_VISIBLE) return i;
    seen++;
  }
  return -1;
}

/** The place row of the sheet: the label `pgPlace`, showing the default city from the address when never edited. */
export const PLACE_PATH = 'labels.pgPlace';
export const placeText = (d: WebsiteData): string => textValue(d, PLACE_PATH).trim();
export const PLACE_NOTE = "Location pages cover your shop's own area only.";

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
