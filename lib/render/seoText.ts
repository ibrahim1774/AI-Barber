// Editable SEO title and meta description per page (Phase 1, step 4).
//
// The barber's own wording is stored as `copy` keys, so there is no new field and an old app that re-saves a draft keeps them
// (copy is spread as is, like every other override):
//   seo.<page>.title        / seo.<page>.description        <page> = a page key (home, services, faq, ...)
//   seo.svc.<titleKey>.title / seo.svc.<titleKey>.description  <titleKey> = svcTitleKey(service title), like svc.<titleKey>.visit
// An override is used only when it passes validSeoText; otherwise the generated default is used. Invalid text is never
// "repaired" (cut, stripped, re-cased): it is ignored. An empty value means "no override".
//
// The overrides sit outside the library `copy` budget (guides.ts COPY_TOTAL_MAX): they have their own, MAX_SEO_KEYS keys of
// at most SEO_RAW_MAX characters each, so a full set of block edits never costs an SEO edit and the other way round.
//
// Pure, no DOM, no Node. Imports only other vendored modules.
import type { WebsiteData } from '../../types';
import { svcTitleKey } from './guides.js';
import { isPageKey } from './pages.js';

export type SeoKind = 'title' | 'description';
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;
/** A stored value longer than this (raw, before whitespace is collapsed) is refused outright by the server. */
export const SEO_RAW_MAX = 400;
/** The most `seo.*` keys a site may carry (2 per page: 30 pages and 12 services fit with room to spare). */
export const MAX_SEO_KEYS = 100;
/** The shortest title or description worth printing: at least this many letters or digits. */
export const SEO_MIN_ALNUM = 2;
export const seoMax = (kind: SeoKind): number => (kind === 'title' ? SEO_TITLE_MAX : SEO_DESCRIPTION_MAX);

/** `seo.home.title`, `seo.faq.description`. Only page keys; a service page uses seoSvcKey. */
export const seoKey = (page: string, kind: SeoKind): string => `seo.${page}.${kind}`;
export const seoSvcKey = (title: unknown, kind: SeoKind): string => `seo.svc.${svcTitleKey(title)}.${kind}`;

const SVC_KEY_MAX = 80;
/** What a seo key names, or null when it is not a seo key the renderer knows. */
export function parseSeoKey(key: unknown): { target: 'page' | 'svc'; id: string; kind: SeoKind } | null {
  if (typeof key !== 'string' || key.length > SVC_KEY_MAX + 24) return null;
  const svc = /^seo\.svc\.([\s\S]+)\.(title|description)$/.exec(key);
  if (svc) return svc[1] === svcTitleKey(svc[1]) && svc[1] !== '' ? { target: 'svc', id: svc[1], kind: svc[2] as SeoKind } : null;
  const page = /^seo\.([a-z][a-z-]*)\.(title|description)$/.exec(key);
  return page && isPageKey(page[1]) ? { target: 'page', id: page[1], kind: page[2] as SeoKind } : null;
}
export const isSeoKey = (key: unknown): boolean => parseSeoKey(key) !== null;

// Characters a title or description may never hold: controls (newline and tab included), line and paragraph separators,
// every invisible or bidi format character (zero-width, direction overrides, the editor's U+2063 marker), private use,
// unassigned code points and lone surrogates.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u2028\u2029]/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i;
const ALNUM = /[\p{L}\p{N}]/gu;
const UPPER = /\p{Lu}/gu;
const LOWER = /\p{Ll}/gu;
const SYMBOL_RUN = /([^\p{L}\p{N}\s])\1{3,}/u;

/**
 * The text to print for an owner-written title or description, or null when it must not be used (use the default).
 * Accepted: plain text only, spaces collapsed and trimmed (the only normalisation), at most 60 / 160 characters (code points),
 * at least two letters or digits. Refused (never cut, stripped or re-cased): not a string; markup (`<`, `>`, an `&entity;`);
 * control characters and newlines; invisible and bidi characters; emoji; a run of four of the same symbol ("!!!!");
 * SHOUTING (six or more cased letters, more than half of them capitals); nothing but punctuation.
 */
export function validSeoText(kind: SeoKind, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > SEO_RAW_MAX) return null;
  if (FORBIDDEN.test(raw)) return null;
  const text = raw.replace(/ {2,}/g, ' ').trim();
  if (/\s/u.test(text.replace(/ /g, ''))) return null; // any other whitespace (NBSP, ideographic space ...) is not plain text
  if (text.includes('<') || text.includes('>') || ENTITY.test(text)) return null;
  if (Array.from(text).length > seoMax(kind)) return null;
  if ((text.match(ALNUM) ?? []).length < SEO_MIN_ALNUM) return null;
  if (EMOJI.test(text) || SYMBOL_RUN.test(text)) return null;
  const upper = (text.match(UPPER) ?? []).length;
  const cased = upper + (text.match(LOWER) ?? []).length;
  if (cased >= 6 && upper * 2 > cased) return null;
  return text;
}

const own = (o: unknown, k: string): boolean => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** The valid override stored under `key`, or null (no override, or one that fails validSeoText). */
export function seoOverride(d: Pick<WebsiteData, 'copy'>, key: string): string | null {
  const parsed = parseSeoKey(key);
  const copy = d.copy;
  if (!parsed || !copy || typeof copy !== 'object' || Array.isArray(copy) || !own(copy, key)) return null;
  return validSeoText(parsed.kind, (copy as Record<string, unknown>)[key]);
}

/**
 * Why a site's `seo.*` copy keys cannot be stored (null when they can). The server runs this on a web draft save and on a web
 * publish, so an over-long or hostile value never reaches the database or a page. A key with an empty value is allowed (it
 * means "no override"); a key the renderer does not know is allowed when its value is a short string (it is ignored).
 */
export function seoProblem(sd: unknown): string | null {
  const copy = (sd as { copy?: unknown } | null | undefined)?.copy;
  if (copy === undefined || copy === null) return null;
  if (typeof copy !== 'object' || Array.isArray(copy)) return 'copy must be an object of text';
  let n = 0;
  for (const key of Object.keys(copy)) {
    if (!key.startsWith('seo.')) continue;
    if (++n > MAX_SEO_KEYS) return `at most ${MAX_SEO_KEYS} seo texts`;
    const v = (copy as Record<string, unknown>)[key];
    if (typeof v !== 'string') return `${key} must be text`;
    if (v.length > SEO_RAW_MAX) return `${key} is too long`;
    const parsed = parseSeoKey(key);
    if (!parsed) continue;
    if (v.trim() !== '' && validSeoText(parsed.kind, v) === null) return `${key} is not a valid ${parsed.kind}`;
  }
  return null;
}

// ── The duplicate guard ──
export interface SeoEntry { id: string; title: string; description: string }
export interface SeoDuplicates { titles: string[][]; descriptions: string[][] }

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Which pages end up with the same title or the same description (compared ignoring case and spacing). Each group lists the
 * page ids that share one text, in the order given; a text used once is not reported. The editor (step 7) shows this as a warning.
 */
export function seoDuplicates(entries: readonly SeoEntry[]): SeoDuplicates {
  const group = (pick: (e: SeoEntry) => string): string[][] => {
    const by = new Map<string, string[]>();
    for (const e of entries) {
      const k = norm(pick(e));
      if (!k) continue;
      by.set(k, [...(by.get(k) ?? []), e.id]);
    }
    return [...by.values()].filter((ids) => ids.length > 1);
  };
  return { titles: group((e) => e.title), descriptions: group((e) => e.description) };
}
