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
import { stripMarkersText } from './markers.js';

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

// Characters a title or description may never hold. Each class is its own constant so a test can pin it on its own.
// Controls (newline and tab included), every invisible or bidi format character (zero-width U+200B-U+200F, U+2060, BOM, soft
// hyphen, U+180E, tag characters, the editor's U+2063 marker), private use, unassigned code points and lone surrogates.
const FORBIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\u2028\u2029]/u;
// Letters and blanks that print as nothing: Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), braille blank (U+2800),
// combining grapheme joiner (U+034F), Khmer inherent vowels (U+17B4, U+17B5), Mongolian free variation selectors (U+180B-U+180D).
// Also the object replacement character (U+FFFC, prints a box), the Khitan small script filler (U+16FE4) and the musical null notehead (U+1D159).
const INVISIBLE = /[\u115F\u1160\u3164\uFFA0\u2800\u034F\u17B4\u17B5\u180B-\u180D\uFFFC\u{16FE4}\u{1D159}]/u;
// Variation selectors (U+FE00-U+FE0F, U+E0100-U+E01EF) turn a plain character into an emoji ("Fade\uFE0F") or glyph variant.
const VARIATION = /[\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u;
// Enclosing marks, mainly the combining keycap U+20E3 ("1\uFE0F\u20E3"); an emoji modifier (skin tone) is refused as well.
const ENCLOSING = /[\p{Me}\p{Emoji_Modifier}]/u;
// A stack of four or more combining marks on one letter ("zalgo").
const MARK_STACK = /\p{M}{4,}/u;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const ENTITY = /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]{1,31});/i;
// A real letter or digit. The Arabic tatweel (U+0640, a letter that only stretches a join) is not one: "ـــ" prints a bare line.
const ALNUM = /[^\P{L}\u0640]|\p{N}/gu;
const UPPER = /\p{Lu}/gu;
const LOWER = /\p{Ll}/gu;
const SYMBOL_RUN = /([^\p{L}\p{N}\s])\1{3,}/u;

export type SeoReason = 'not_text' | 'too_long_raw' | 'invisible' | 'whitespace' | 'markup' | 'too_long' | 'too_few_letters' | 'emoji' | 'symbols' | 'shouting' | 'bad_key' | 'too_many';

/** The text to print and the reason it cannot be used, for the editor (reason names the first failed rule). */
export function checkSeoText(kind: SeoKind, raw: unknown): { ok: true; text: string } | { ok: false; reason: SeoReason } {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_text' };
  if (raw.length > SEO_RAW_MAX) return { ok: false, reason: 'too_long_raw' };
  if (FORBIDDEN.test(raw) || INVISIBLE.test(raw) || VARIATION.test(raw) || MARK_STACK.test(raw)) return { ok: false, reason: 'invisible' };
  const text = raw.replace(/ {2,}/g, ' ').trim();
  if (/\s/u.test(text.replace(/ /g, ''))) return { ok: false, reason: 'whitespace' }; // NBSP, ideographic space ... is not plain text
  if (text.includes('<') || text.includes('>') || ENTITY.test(text)) return { ok: false, reason: 'markup' };
  if (Array.from(text).length > seoMax(kind)) return { ok: false, reason: 'too_long' };
  if ((text.match(ALNUM) ?? []).length < SEO_MIN_ALNUM) return { ok: false, reason: 'too_few_letters' };
  if (EMOJI.test(text) || ENCLOSING.test(text)) return { ok: false, reason: 'emoji' };
  if (SYMBOL_RUN.test(text)) return { ok: false, reason: 'symbols' };
  const upper = (text.match(UPPER) ?? []).length;
  const cased = upper + (text.match(LOWER) ?? []).length;
  if (cased >= 6 && upper * 2 > cased) return { ok: false, reason: 'shouting' };
  return { ok: true, text };
}

/**
 * The text to print for an owner-written title or description, or null when it must not be used (use the default).
 * Accepted: plain text only, spaces collapsed and trimmed (the only normalisation), at most 60 / 160 characters (code points),
 * at least two real letters or digits. Refused (never cut, stripped or re-cased): not a string; markup (`<`, `>`, an `&entity;`);
 * control characters and newlines; invisible, filler and bidi characters; variation selectors; emoji incl. keycaps; stacks of
 * combining marks; a run of four of the same symbol ("!!!!"); SHOUTING (six or more cased letters, more than half capitals);
 * nothing but punctuation.
 */
export function validSeoText(kind: SeoKind, raw: unknown): string | null {
  const r = checkSeoText(kind, raw);
  return r.ok ? r.text : null;
}

const own = (o: unknown, k: string): boolean => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** The valid override stored under `key`, or null (no override, or one that fails validSeoText). */
export function seoOverride(d: Pick<WebsiteData, 'copy'>, key: string): string | null {
  const parsed = parseSeoKey(key);
  const copy = d.copy;
  if (!parsed || !copy || typeof copy !== 'object' || Array.isArray(copy) || !own(copy, key)) return null;
  return validSeoText(parsed.kind, (copy as Record<string, unknown>)[key]);
}

/** Longest `seo.*` key name kept (the longest real key is `seo.svc.<80>.description`). */
export const SEO_KEY_MAX = SVC_KEY_MAX + 24;

/**
 * Whether the site's `copy` can be handled at all (null when it can). Only a structural problem is reported here: the editor
 * never produces it. Bad `seo.*` VALUES are not a problem for saving, see seoSanitize.
 */
export function seoProblem(sd: unknown): string | null {
  const copy = (sd as { copy?: unknown } | null | undefined)?.copy;
  if (copy === undefined || copy === null) return null;
  if (typeof copy !== 'object' || Array.isArray(copy)) return 'copy must be an object of text';
  return null;
}

export interface SeoFieldProblem {
  /** The page key (`home`, `faq`, ...), `svc:<titleKey>` for a service page, or the key itself when it is not a known seo key. */
  page: string;
  field: SeoKind | null;
  reason: SeoReason;
  key: string;
}

/**
 * Keeps an invalid `seo.*` value out of the stored copy. The rest of the site data is untouched, so one bad title never blocks a
 * draft save. Dropped: a value that is not text, longer than SEO_RAW_MAX, a known key whose text fails validSeoText, a key name
 * longer than SEO_KEY_MAX, and every key past MAX_SEO_KEYS. An empty value ("no override") and a short-text key the renderer
 * does not know are kept. Never mutates; returns the same object when nothing is dropped. The list says what was dropped.
 */
export function seoSanitize<T>(sd: T): { siteData: T; problems: SeoFieldProblem[] } {
  const copy = (sd as { copy?: unknown } | null | undefined)?.copy;
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return { siteData: sd, problems: [] };
  const problems: SeoFieldProblem[] = [];
  const drop = new Set<string>();
  const why = new Map<string, SeoFieldProblem>();
  const prioritised: string[] = []; // known keys with a value: they take the key budget first
  const others: string[] = []; // empty values and keys the renderer does not know
  for (const key of Object.keys(copy)) {
    if (!key.startsWith('seo.')) continue;
    const parsed = parseSeoKey(key);
    const where = { page: parsed ? (parsed.target === 'svc' ? `svc:${parsed.id}` : parsed.id) : key.slice(0, SEO_KEY_MAX), field: parsed?.kind ?? null, key: key.slice(0, SEO_KEY_MAX) };
    const v = (copy as Record<string, unknown>)[key];
    let reason: SeoReason | null = null;
    if (key.length > SEO_KEY_MAX) reason = 'bad_key';
    else if (typeof v !== 'string') reason = 'not_text';
    else if (v.length > SEO_RAW_MAX) reason = 'too_long_raw';
    else if (parsed && v.trim() !== '') { const r = checkSeoText(parsed.kind, v); if ('reason' in r) reason = r.reason; }
    if (reason) { drop.add(key); why.set(key, { ...where, reason }); continue; }
    (parsed && (v as string).trim() !== '' ? prioritised : others).push(key);
    why.set(key, { ...where, reason: 'too_many' });
  }
  // Past MAX_SEO_KEYS the surplus is dropped, but a real override is never pushed out by empty or unknown keys that came first.
  for (const key of [...prioritised.slice(MAX_SEO_KEYS), ...others.slice(Math.max(0, MAX_SEO_KEYS - prioritised.length))]) drop.add(key);
  for (const key of Object.keys(copy)) if (drop.has(key)) problems.push(why.get(key)!);
  if (!drop.size) return { siteData: sd, problems };
  // defineProperty, not assignment: an own `__proto__` key stays an own entry and never changes the prototype of the rebuilt object.
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(copy)) if (!drop.has(key)) Object.defineProperty(next, key, { value: (copy as Record<string, unknown>)[key], enumerable: true, writable: true, configurable: true });
  return { siteData: { ...sd, copy: next }, problems };
}

// ── The duplicate guard ──
export interface SeoEntry { id: string; title: string; description: string }
export interface SeoDuplicates { titles: string[][]; descriptions: string[][] }

const norm = (s: string): string => stripMarkersText(s).replace(/\s+/g, ' ').trim().toLowerCase();

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
