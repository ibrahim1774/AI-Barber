// Guides: which library text a site shows, and how a sentence becomes words (plan 2026-10-24, section 3).
//
// copyLibrary.ts holds the wordings; this module decides
//   - which guide a service gets (guideIdForTitle, serviceGuideFor: once per site, first service wins);
//   - which of the three wordings a block shows (variantIndex: a seed stored in the site data, or the barber's
//     "try other wording" pick), so the app preview and the published site always agree;
//   - what each token means (resolveBlock): only the shop name, the place, the service's own title, price and
//     duration, the barber's phone / address / hours / policy and links to pages that really are files. A sentence
//     holding a token with no value is dropped, so no sentence can say something the barber did not tell us;
//   - the barber's own words (`copy` overrides, a closed key set): shown instead, escaped by the caller, never linted,
//     never token-processed.
// It never produces HTML: it returns segments (plain text or a link) and the page body escapes each piece once.
// Every library sentence is also re-checked against R1 to R9 (copyRules.ts) before it is used.
//
// Pure, no DOM. Imports only vendored modules (never pages.ts or labels.ts: pages.ts imports this one).
import type { WebsiteData } from '../../types';
import { EXTRA_PAGES, GUIDES, GUIDE_IDS, SERVICE_ALT, SERVICE_VISIT, type Block, type BlockKind, type ExtraId, type GuideId } from './copyLibrary.js';
import { copyProblems, outputProblems, serviceWordsIn, TOKEN_RE, type VocabGroup } from './copyRules.js';
import { checkEntryShape, lintLine, lintParagraph, MIN_SENTENCES, sentencesOf } from './svcCopy.js';
import { familyAllowed, plainHaircutTitle, structuralGuide } from './familyKeywords.js';
import { hasPagesV2, isWebCreated } from '../pagesV2.js';
import { displayPhone, displayPrice, policyToShow } from './honest.js';
import { safeHref } from './safeHref.js';
import { spliceable, TOKEN_KIND } from './spliceable.js';
export { isDuration, isMoney, isStreetAddress } from './spliceable.js';
import { pageSectionsOf, type SectionPage } from './sections.js';

// ── Text helpers (same marker rule as pages.ts plainText) ───────────────────────────────────────
const RAW_MARKER = /⁣(?:[a-zA-Z]+|\/)⁣/g;
const plain = (v: unknown): string => (typeof v === 'string' ? v.replace(RAW_MARKER, '').replace(/⁣/g, '').trim() : '');
const has = (v: unknown): boolean => plain(v) !== '';

// ── Matching a service title to a guide ─────────────────────────────────────────────────────────
export const isGuideId = (k: unknown): k is GuideId => typeof k === 'string' && (GUIDE_IDS as readonly string[]).includes(k);

/** The guide of a service title: the first guide, most specific first, with a matching pattern. Null = none. */
export function guideIdForTitle(title: unknown): GuideId | null {
  const t0 = plain(title);
  if (!t0) return null;
  for (const id of GUIDE_IDS) {
    const g = GUIDES[id];
    if (g.match.some((re) => re.test(t0)) && !(g.not ?? []).some((re) => re.test(t0))) return id;
  }
  return null;
}

// Haircut-type = a service that cuts hair; beard-type = one that works on a beard or the face (plan 1c).
const HAIRCUT_TYPE: ReadonlySet<GuideId> = new Set(['cut-beard', 'fade', 'taper', 'kids-cut', 'haircut']);
const PRICE_TYPE: ReadonlySet<GuideId> = new Set(['fade', 'taper', 'haircut']);
/**
 * The library guide of a title on THIS site. On a web-created site with service guides on (serviceTextOn) it is the closed-vocabulary guide
 * (familyKeywords.ts structuralGuide) when the library pattern also matched, else none; every other site: guideIdForTitle, exactly as on main.
 */
export function libraryGuideFor(d: Partial<Pick<WebsiteData, 'extraPages' | 'source'>> | undefined, title: unknown): GuideId | null {
  const g = guideIdForTitle(title);
  if (g === null || !d || !serviceTextOn(d as Pick<WebsiteData, 'extraPages' | 'source'>)) return g;
  return structuralGuide(plain(title));
}
export const isHaircutTitle = (title: unknown, d?: Partial<Pick<WebsiteData, 'extraPages' | 'source'>>): boolean => { const g = libraryGuideFor(d, title); return !!g && HAIRCUT_TYPE.has(g); };
/** A real beard service: a cut-and-beard, a beard trim or a shave that is not a head shave (never a line-up). */
export const isBeardTitle = (title: unknown, d?: Partial<Pick<WebsiteData, 'extraPages' | 'source'>>): boolean => {
  const g = libraryGuideFor(d, title);
  return g === 'cut-beard' || g === 'beard-trim' || (g === 'shave' && !/\bhead\b/i.test(plain(title)));
};
export const isKidsTitle = (title: unknown): boolean => guideIdForTitle(title) === 'kids-cut';

/** A service of the site with a title (editor markers removed). */
export interface Svc { index: number; title: string; price: string; duration: string; guide: GuideId | null }

export function titledServices(d: Pick<WebsiteData, 'services'> & Partial<Pick<WebsiteData, 'extraPages' | 'source'>>): Svc[] {
  const out: Svc[] = [];
  (Array.isArray(d.services) ? d.services : []).forEach((s, index) => {
    const title = plain(s?.title);
    if (title) out.push({ index, title, price: plain(s?.price), duration: plain(s?.duration), guide: guideForTitle(d, title) });
  });
  return out;
}

/**
 * The family a custom service was assigned (Mode A: a model only CLASSIFIED the title into one of the closed set of library
 * guides, nothing it wrote is ever printed). Stored at extraPages.svcFamily[titleKey]. Honoured only on web-created pages-v2 sites with
 * service guides on, only for a title the library does not match, only with a real guide id, and never when the service has text of
 * its own (svcCopy) - the barber's own wording or approved text wins - and only when the title itself holds a keyword of that family
 * (familyAllowed; a vetoed title never gets one). Anything else is ignored.
 */
export function familyFor(d: Partial<Pick<WebsiteData, 'extraPages' | 'source'>>, title: unknown): GuideId | null {
  const ep = d.extraPages as { svcFamily?: unknown; svcCopy?: unknown } | undefined;
  if (!ep || !serviceTextOn(d as Pick<WebsiteData, 'extraPages' | 'source'>)) return null;
  const fam = ep.svcFamily;
  if (!fam || typeof fam !== 'object' || Array.isArray(fam)) return null;
  const key = svcTitleKey(title);
  if (!key || !Object.prototype.hasOwnProperty.call(fam, key)) return null;
  const copy = ep.svcCopy;
  if (copy && typeof copy === 'object' && !Array.isArray(copy) && Object.prototype.hasOwnProperty.call(copy, key)) return null;
  const g = (fam as Record<string, unknown>)[key];
  // Review 6c B1: a family prints specific wording, so it needs a keyword of that family in the title itself (familyKeywords.ts), whoever chose it.
  return isGuideId(g) && familyAllowed(title, g) ? g : null;
}

/**
 * The guide a service title gets on this site. On a web-created site with service guides on (serviceTextOn) ONLY the closed vocabulary decides
 * (structuralGuide): for a title the library pattern matches, that guide; for one it does not, the family the barber (or the classifier,
 * approved by the barber) assigned, when the vocabulary allows it. Any other site: the library pattern, exactly as on main.
 */
export function guideForTitle(d: Partial<Pick<WebsiteData, 'extraPages' | 'source'>>, title: unknown): GuideId | null {
  const lib = guideIdForTitle(title);
  if (!serviceTextOn(d as Pick<WebsiteData, 'extraPages' | 'source'>)) return lib;
  const s = structuralGuide(plain(title));
  if (s === null) return null;
  return lib !== null ? s : familyFor(d, title);
}

/**
 * Which service page shows which guide. A guide is used once per site: the first service (in the barber's order,
 * among `pagedIndexes`, the services that have a page) with that guide gets it. Empty unless the barber has service
 * guides switched on (extraPages.serviceGuides).
 */
export function serviceGuideFor(d: Pick<WebsiteData, 'services' | 'extraPages'>, pagedIndexes: readonly number[]): Map<number, GuideId> {
  const out = new Map<number, GuideId>();
  if (d.extraPages?.serviceGuides !== true) return out;
  const used = new Set<GuideId>();
  const services = Array.isArray(d.services) ? d.services : [];
  for (const index of pagedIndexes) {
    const g = guideForTitle(d, services[index]?.title);
    if (g && !used.has(g)) { used.add(g); out.set(index, g); }
  }
  return out;
}

/** An owner description at least this long (plain characters) is real text of the service's own (step 2 thin-page rule). */
export const THIN_DESCRIPTION_MIN = 80;

/**
 * Service pages that are still thin: no text of their own beyond the price, the time and the template "visit" block, which
 * is the same on every service page and so does not count. A page is NOT thin when it prints at least one of
 *   - the owner's description of THIN_DESCRIPTION_MIN characters or more,
 *   - the library guide for its kind (guide section shown).
 * The `alt` block of a later service of a kind does NOT count: it is one of three wordings per kind, so two or more
 * pages of one kind would carry the same text, and a page that only differs by its title is a near-duplicate. A section
 * the barber hid does not count, since it is not printed. (Reviewed AI text joins this list in step 6.)
 * Thin pages stay on the site and in the menu; they are `noindex,follow` and left out of the sitemap.
 * Returns the indexes into services[] of the thin pages among `pagedIndexes`.
 */
export function thinServiceIndexes(d: WebsiteData, pagedIndexes: readonly number[]): Set<number> {
  const out = new Set<number>();
  const services = Array.isArray(d.services) ? d.services : [];
  const sections = pageSectionsOf(d, 'service');
  const shown = (id: string): boolean => !sections.find((x) => x.id === id)?.hidden;
  const guides = serviceGuideFor(d, pagedIndexes);
  const env = lenientEnv(d);
  for (const index of pagedIndexes) {
    const subject = titledServices(d).find((x) => x.index === index) ?? null;
    let unique = shown('description') && plain(services[index]?.description).length >= THIN_DESCRIPTION_MIN;
    if (!unique && shown('guide') && subject) {
      const g = guides.get(index);
      if (g && guideBlocks(env, g, subject).length > 0) unique = true;
      // Dedicated text of its own (written for the service, step 6) is real text. The lenient env has no place, so this is
      // the least the page prints (a sentence with {place} only adds to it): a page counted here as having text always does.
      if (!unique && aiPageFor(env, subject)) unique = true;
    }
    if (!unique) out.add(index);
  }
  return out;
}

/** Do the sites' service pages carry the Phase 1 library text? Web-created (isWebCreated), pages v2 (an `extraPages` object), service guides on. */
export const serviceTextOn = (d: Pick<WebsiteData, 'extraPages' | 'source'>): boolean => hasPagesV2(d) && d.extraPages?.serviceGuides === true && isWebCreated(d);

/**
 * Which service page shows the `service.alt.<guide>` block: a service with a page whose guide an earlier service with a
 * page already took (serviceGuideFor gives each guide to the first one only). A service with no guide gets none.
 */
export function serviceAltFor(d: Pick<WebsiteData, 'services' | 'extraPages' | 'source'>, pagedIndexes: readonly number[]): Map<number, GuideId> {
  const out = new Map<number, GuideId>();
  if (!serviceTextOn(d)) return out;
  const first = serviceGuideFor(d, pagedIndexes);
  const services = Array.isArray(d.services) ? d.services : [];
  for (const index of pagedIndexes) {
    if (first.has(index)) continue;
    const g = guideForTitle(d, services[index]?.title);
    if (g) out.set(index, g);
  }
  return out;
}

// ── Keys, the closed set of editable blocks ─────────────────────────────────────────────────────
/** `special`: a key that is not a block but one line of a block's page (a FAQ question, a Hair care "how often" sentence). */
interface Entry { block: Block; allow: VocabGroup[]; scope: GuideId | ExtraId | 'service'; kind: 'guide' | 'page' | 'service'; special?: 'q' | 'interval'; strict?: boolean }
const REGISTRY = new Map<string, Entry>();
for (const g of GUIDE_IDS) for (const block of GUIDES[g].blocks) REGISTRY.set(`guide.${g}.${block.id}`, { block, allow: [...GUIDES[g].allow, ...(block.allow ?? [])], scope: g, kind: 'guide' });
for (const [page, def] of Object.entries(EXTRA_PAGES) as [ExtraId, (typeof EXTRA_PAGES)[ExtraId]][]) {
  for (const block of def.blocks) REGISTRY.set(`${page}.${block.id}`, { block, allow: [...def.allow, ...(block.allow ?? [])], scope: page, kind: 'page' });
}

// The FAQ questions and the Hair care "how often" sentences are library text too, so each is a key of its own
// (`faq.book.q`, `guide.fade.interval`): a one-line text of at most this many characters. Barber-written, never linted.
const QUESTION_MAX = 160;
const INTERVAL_MAX = 200;
const lineBlock = (id: string, max: number): Block => ({ id, kind: 'p', max, variants: [[], [], []] });
for (const [page, def] of Object.entries(EXTRA_PAGES) as [ExtraId, (typeof EXTRA_PAGES)[ExtraId]][]) {
  for (const block of def.blocks) if (block.kind === 'qa' && block.q) REGISTRY.set(`${page}.${block.id}.q`, { block: lineBlock(`${block.id}.q`, QUESTION_MAX), allow: [], scope: page, kind: 'page', special: 'q' });
}
for (const g of GUIDE_IDS) if (GUIDES[g].interval) REGISTRY.set(`guide.${g}.interval`, { block: lineBlock('interval', INTERVAL_MAX), allow: GUIDES[g].allow, scope: g, kind: 'guide', special: 'interval' });

// Service page blocks (Phase 1) are written per service, so their keys carry the service: `svc.<titleKey>.visit` (where the
// shop is, how to book) and `svc.<titleKey>.alt` (the text of a second service of a kind). The title key is the title in
// lower case with single spaces, so a reorder never detaches an override. They are strict blocks: R12 to R14 apply as well.
const SVC_KEY_MAX = 80;
const MAX_SVC_OVERRIDES = 60;
export const svcTitleKey = (title: unknown): string => plain(title).toLowerCase().replace(/\s+/g, ' ').slice(0, SVC_KEY_MAX).trim();
export const svcCopyKey = (title: unknown, part: 'visit' | 'alt'): string => `svc.${svcTitleKey(title)}.${part}`;

/** The entry of a copy key: a block of the fixed set, or a service page block (`svc.<titleKey>.visit|alt`). */
function entryFor(key: string): Entry | undefined {
  const hit = REGISTRY.get(key);
  if (hit) return hit;
  if (!key.startsWith('svc.') || key.length > SVC_KEY_MAX + 12) return undefined;
  const m = /^svc\.(.+)\.(visit|alt)$/.exec(key);
  if (!m || m[1] !== svcTitleKey(m[1])) return undefined;
  if (m[2] === 'visit') return { block: SERVICE_VISIT, allow: [], scope: 'service', kind: 'service', strict: true };
  const g = guideIdForTitle(m[1]);
  return g ? { block: SERVICE_ALT[g], allow: [...GUIDES[g].allow], scope: g, kind: 'service', strict: true } : undefined;
}

/** Every key of the fixed set a `copy` override may use (service page keys are `svc.<titleKey>.visit|alt`, see isCopyKey). */
export const COPY_KEYS: readonly string[] = Array.from(REGISTRY.keys());
export const isCopyKey = (k: unknown): k is string => typeof k === 'string' && entryFor(k) !== undefined;
export const copyKey = (scope: GuideId | ExtraId, blockId: string): string => (isGuideId(scope) ? `guide.${scope}.${blockId}` : `${scope}.${blockId}`);
/** What the editor needs to know about a block: its kind, its longest override and its heading label key. */
export function copyBlockInfo(key: string): { kind: BlockKind; max: number; h?: string; q?: string } | null {
  const e = entryFor(key);
  return e ? { kind: e.block.kind, max: e.block.max, h: e.block.h, q: e.block.q } : null;
}

/** Whether a key has three wordings to choose from ("Try other wording"): not a FAQ question, which has one. */
export const copyHasWordings = (k: string): boolean => { const e = entryFor(k); return !!e && e.special !== 'q'; };

/** The renderer ignores `copy` beyond this many characters in total. */
export const COPY_TOTAL_MAX = 40000;

const codePoints = (s: string): string[] => Array.from(s);
function capText(raw: string, max: number): string {
  const t0 = raw.trim();
  const p0 = plain(t0);
  if (codePoints(p0).length <= max) return t0;
  return codePoints(p0).slice(0, max).join('').trim();
}

const OVERRIDES = new WeakMap<object, Map<string, string>>();
/** The barber's overrides that count: known keys only, text values, capped per block and in total. */
export function copyOverrides(d: Pick<WebsiteData, 'copy'>): Map<string, string> {
  const raw = d.copy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const hit = OVERRIDES.get(raw);
  if (hit) return hit;
  const out = new Map<string, string>();
  let total = 0;
  for (const key of COPY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v !== 'string' || !has(v)) continue;
    const text = capText(v, REGISTRY.get(key)!.block.max);
    total += plain(text).length;
    if (total > COPY_TOTAL_MAX) break;
    out.set(key, text);
  }
  // Service page keys have a budget of their own (N7), so a full set of older overrides never makes the renderer drop a service page edit.
  let svcKeys = 0;
  let svcTotal = 0;
  for (const key of Object.keys(raw)) {
    if (!key.startsWith('svc.') || svcKeys >= MAX_SVC_OVERRIDES) continue;
    const e = entryFor(key);
    const v = (raw as Record<string, unknown>)[key];
    if (!e || typeof v !== 'string' || !has(v)) continue;
    const text = capText(v, e.block.max);
    svcTotal += plain(text).length;
    if (svcTotal > COPY_TOTAL_MAX) break;
    out.set(key, text);
    svcKeys++;
  }
  OVERRIDES.set(raw, out);
  return out;
}

// ── Choosing a wording ──────────────────────────────────────────────────────────────────────────
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** The wording (0, 1 or 2) of a block: the barber's pick, else a hash of the seed and the key, else 0 (no seed yet). */
export function variantIndex(d: Pick<WebsiteData, 'extraPages'>, key: string): 0 | 1 | 2 {
  const pick = d.extraPages?.pick;
  const p0 = pick && typeof pick === 'object' && Object.prototype.hasOwnProperty.call(pick, key) ? (pick as Record<string, unknown>)[key] : undefined;
  if (typeof p0 === 'number' && Number.isInteger(p0) && p0 >= 0 && p0 <= 2) return p0 as 0 | 1 | 2;
  const seed = d.extraPages?.seed;
  if (typeof seed === 'number' && Number.isInteger(seed)) return (fnv1a(`${seed}:${key}`) % 3) as 0 | 1 | 2;
  return 0;
}

// ── Resolving a sentence ────────────────────────────────────────────────────────────────────────
export type LinkKey = 'location' | 'hours' | 'contact' | 'book' | 'services';
export interface LinkInfo { href: string; label: string; newTab?: boolean }
export type Seg = { t: 'text'; s: string } | { t: 'link'; href: string; label: string; newTab?: boolean };

/** Everything a sentence may be made from. `d` is the cleaned site (withoutLegacyCopy). */
export interface CopyEnv {
  d: WebsiteData;
  /** pgPlace, as printed in titles ('' = the shop has no place). */
  place: string;
  /** The niche's name for the shop ("Barbershop"). */
  industry: string;
  /** Pages that are files (and the booking link) with the label to print. A link to a page that is not here drops the sentence. */
  links: Partial<Record<LinkKey, LinkInfo>>;
  /** The href of the page of the service at this index in services[], when it is a file in the set. */
  serviceHref?: (index: number) => string | null;
  /** Links always resolve (to their plain label): for deciding what the data can answer, and for the editor's default text. */
  lenient?: boolean;
  /** Ignore the barber's overrides (for the "suggested" text and for gating). */
  ignoreCopy?: boolean;
}

const FALLBACK_LABEL: Record<LinkKey, string> = { location: 'Location', hours: 'Hours', contact: 'Contact', book: 'Book now', services: 'Services' };

/** Env for gating and for the editor's default text: no links to real files, links shown as their plain label. */
export function lenientEnv(d: WebsiteData, extra: Partial<CopyEnv> = {}): CopyEnv {
  return { d, place: '', industry: 'Barbershop', links: {}, lenient: true, ...extra };
}

const lintMemo = new Map<string, boolean>();
function sentenceOk(sentence: string, allow: readonly VocabGroup[], strict = false): boolean {
  const k = `${strict ? 's' : 'n'}|${allow.join(',')}|${sentence}`;
  let v = lintMemo.get(k);
  if (v === undefined) { v = copyProblems(sentence, { allow, strict }).length === 0; lintMemo.set(k, v); }
  return v;
}

/** The service a `svc.<titleKey>.<part>` key belongs to (the first one with that title). */
function serviceOfKey(d: WebsiteData, key: string): Svc | null {
  const m = /^svc\.(.+)\.(?:visit|alt)$/.exec(key);
  return m ? titledServices(d).find((s) => svcTitleKey(s.title) === m[1]) ?? null : null;
}

function subjectFor(env: CopyEnv, kind: NonNullable<Block['subject']>): Svc | null {
  const all = titledServices(env.d);
  if (serviceTextOn(env.d)) {
    // Review 6g: on a web-created site with service guides on a price, a time or "kids" is attributed ONLY to a service that is exactly
    // what the question says: one plain haircut (generic word + who it is for), one kids' cut. Two candidates, a combo, a membership, a
    // named cut, a fade or anything else answers nothing. A time is never borrowed from another service.
    if (kind === 'kids') { const k = all.filter((s) => s.guide === 'kids-cut'); return k.length === 1 ? k[0] : null; }
    const plainOnes = all.filter((s) => s.guide === 'haircut' && plainHaircutTitle(s.title));
    const one = plainOnes.length === 1 ? plainOnes[0] : null;
    return one && (kind === 'haircut' ? one.price : one.duration) ? one : null;
  }
  if (kind === 'haircut') return all.find((s) => !!s.guide && PRICE_TYPE.has(s.guide) && s.price) ?? null;
  if (kind === 'kids') return all.find((s) => s.guide === 'kids-cut') ?? null;
  return all.find((s) => !!s.guide && PRICE_TYPE.has(s.guide) && s.duration) ?? all.find((s) => s.duration) ?? null;
}

const DAY_RE = /^(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday|s)?\.?$/i;
const DAY_KEYS = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const dayKey = (v: unknown): string | null => {
  const m = DAY_RE.exec(plain(v));
  return m ? m[1].toLowerCase() : null;
};

/** Is at least one day open in these hours? (A row that is not closed and has a time.) */
export function hasOpenDay(hours: unknown): boolean {
  return (Array.isArray(hours) ? hours : []).some((h) => h && !h.closed && (has(h.open) || has(h.close)));
}

/**
 * How many of the seven days the shop is open: distinct recognised days, a day with several rows (split shifts) counted
 * once. Null (nothing can be said) unless all seven days are present, every row names a day, no open row is empty and
 * at least one day is open.
 */
export function openDays(d: Pick<WebsiteData, 'hours'>): number | null {
  const rows = Array.isArray(d.hours) ? d.hours : [];
  const seen = new Set<string>();
  const open = new Set<string>();
  for (const h of rows) {
    if (!h || typeof h !== 'object') return null;
    const k = dayKey(h.day);
    if (!k) return null;
    seen.add(k);
    if (h.closed) continue;
    if (!has(h.open) && !has(h.close)) return null;
    open.add(k);
  }
  if (DAY_KEYS.size !== seen.size) return null;
  return open.size > 0 ? open.size : null;
}

/** At most `max` characters, ending on a full sentence when one fits (else on a word). */
export function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const ends = [...head.matchAll(/[.!?](?=\s|$)/g)];
  const last = ends.length ? ends[ends.length - 1].index! + 1 : 0;
  if (last > 0) return head.slice(0, last).trim();
  const sp = head.lastIndexOf(' ');
  return (sp > 0 ? head.slice(0, sp) : head).trim();
}

function linkSeg(env: CopyEnv, key: LinkKey): Seg | null {
  const l = env.links[key];
  if (l) return { t: 'link', href: l.href, label: l.label, newTab: l.newTab };
  // Lenient: a page link always resolves (its page may be switched on later); the booking link only if the shop has one.
  if (env.lenient && (key !== 'book' || safeHref(env.d.bookingUrl))) return { t: 'link', href: '', label: FALLBACK_LABEL[key] };
  return null;
}

function tokenSeg(env: CopyEnv, name: string, arg: string | undefined, subject: Svc | null): Seg | null {
  const text = (s: string): Seg | null => (s ? { t: 'text', s } : null);
  const d = env.d;
  switch (name) {
    case 'shop': return text(plain(d.shopName));
    case 'place': return text(env.place);
    case 'industry': return text(env.industry);
    case 'service': return text(subject?.title ?? '');
    case 'price': return text(subject ? displayPrice(subject.price) : '');
    case 'duration': return text(subject?.duration ?? '');
    case 'phone': { const ph = plain(d.phone); return /\d/.test(ph) ? text(plain(displayPhone(ph))) : null; }
    case 'address': return text(plain(d.contact?.address));
    case 'openDays': { const n = openDays(d); return n ? text(String(n)) : null; }
    case 'policy': { const p0 = policyToShow(d); return p0 ? text(cutAtSentence(plain(p0.body), 500)) : null; }
    case 'link': return isLinkKey(arg) ? linkSeg(env, arg) : null;
    case 'svc': {
      if (!isGuideId(arg)) return null;
      const hit = titledServices(d).find((s) => s.guide === arg);
      if (!hit) return null;
      const href = env.serviceHref?.(hit.index);
      return href ? { t: 'link', href, label: hit.title } : { t: 'text', s: hit.title };
    }
    default: return null;
  }
}
const isLinkKey = (k: unknown): k is LinkKey => k === 'location' || k === 'hours' || k === 'contact' || k === 'book' || k === 'services';

const wordKey = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** Does the first word of `value` equal the library word just before it, or its last word the library word just after it? */
function repeatsNeighbour(before: string, value: string, after: string): boolean {
  const prev = /([\p{L}\p{N}']+)\s+$/u.exec(before)?.[1];
  const next = /^\s+([\p{L}\p{N}']+)/u.exec(after)?.[1];
  const words = value.split(' ');
  return (!!prev && wordKey(prev) !== '' && wordKey(prev) === wordKey(words[0])) || (!!next && wordKey(next) !== '' && wordKey(next) === wordKey(words[words.length - 1]));
}

/**
 * One library sentence as segments: split into literal text and tokens, each token resolved on its own and never
 * expanded again (so a service called "{shop}" prints literally). Null = the sentence is dropped: it fails the
 * rules, or a token has no value.
 */
export function resolveSentence(env: CopyEnv, sentence: string, allow: readonly VocabGroup[], subject: Svc | null, strict = false): Seg[] | null {
  if (!sentenceOk(sentence, allow, strict)) return null;
  const out: Seg[] = [];
  const values: Record<string, string> = {};
  let last = 0;
  const push = (seg: Seg): void => {
    const prev = out[out.length - 1];
    if (seg.t === 'text' && prev && prev.t === 'text') prev.s += seg.s; else out.push({ ...seg });
  };
  for (const m of sentence.matchAll(TOKEN_RE)) {
    if (m.index! > last) push({ t: 'text', s: sentence.slice(last, m.index) });
    let seg = tokenSeg(env, m[1], m[2], subject);
    if (!seg) return null;
    if (strict) {
      // The ONE gate (spliceable.ts): a barber-controlled string is spliced only when it passes the whitelist of its kind,
      // exactly as typed. Otherwise the whole sentence is omitted. Nothing is repaired or re-cased.
      const kind = TOKEN_KIND[m[1]];
      if (!kind) return null;
      const v = spliceable(kind, seg.t === 'link' ? seg.label : seg.s);
      if (v === null) return null;
      // The value must not repeat the library word right before or after it ("book Book", "the Location page page").
      if (repeatsNeighbour(sentence.slice(0, m.index!), v, sentence.slice(m.index! + m[0].length))) return null;
      if (seg.t === 'link') seg = { ...seg, label: v };
      else {
        // A value that opens a sentence must already start with a capital: lower-case owner text is never re-cased.
        if (/(?:^|[.!?]\s+)$/.test(sentence.slice(0, m.index!)) && /^\p{Ll}/u.test(v)) return null;
        values[m[1]] = v.toLowerCase();
        // A service named like the shop would read as a mistake (compared case-insensitively; nothing printed is changed).
        seg = { t: 'text', s: v };
      }
    }
    push(seg);
    last = m.index! + m[0].length;
  }
  if (last < sentence.length) push({ t: 'text', s: sentence.slice(last) });
  // A service called like the shop ("Fresh Cuts lists Fresh Cuts ...") reads as a mistake: drop the sentence.
  if (strict && values.shop && values.shop === values.service) return null;
  // Repeated words are only checked in the library's own words (linted statically); a value is the barber's wording
  // ("Ready to book Book Club Cut?" is fine), so a repeat across or inside a value does not drop the sentence.
  if (strict && out.length && outputProblems(segsText(out), { repeats: false }).length) return null;
  return out.length ? out : null;
}

export interface ResolvedBlock {
  /** The copy key (`guide.fade.what`, `faq.book`). */
  key: string;
  id: string;
  kind: BlockKind;
  /** Heading label key. */
  h?: string;
  /** qa: the question. */
  q?: string;
  /** p and qa: paragraphs; list and step: one item each. */
  items: Seg[][];
  /** The barber's own text is shown (no tokens, not linted). */
  custom: boolean;
}

function customItems(kind: BlockKind, text: string): Seg[][] {
  const parts = (kind === 'list' || kind === 'step' ? text.split(/\r?\n+/) : text.split(/\r?\n\s*\r?\n/)).map((s) => s.trim()).filter(Boolean);
  return parts.map((s) => [{ t: 'text' as const, s }]);
}

/** One block as the page prints it, or null when nothing of it can be said (or it is empty). */
export function resolveBlock(env: CopyEnv, key: string, subject: Svc | null = null): ResolvedBlock | null {
  const altKey = /^svc\..+\.alt$/.test(key);
  // On a gated site the alt text follows the service's own (closed-vocabulary) guide, never the library pattern's.
  let e = altKey && serviceTextOn(env.d) ? undefined : entryFor(key);
  if (!e) {
    // `svc.<titleKey>.alt` of a service that got its guide from the closed vocabulary or a family (the title itself matches none).
    const m = /^svc\.(.+)\.alt$/.exec(key);
    const fam = m && m[1] === svcTitleKey(m[1]) ? (subject && svcTitleKey(subject.title) === m[1] ? subject : serviceOfKey(env.d, key))?.guide ?? null : null;
    if (fam && key.length <= SVC_KEY_MAX + 12) e = { block: SERVICE_ALT[fam], allow: [...GUIDES[fam].allow], scope: fam, kind: 'service', strict: true };
  }
  if (!e) return null;
  if (e.special) return null; // a line of a block, not a block (copyDefault / howOftenRows serve it)
  const { block } = e;
  // The barber's own question (`<page>.<id>.q`), when they wrote one.
  const ownQ = block.kind === 'qa' && !env.ignoreCopy ? copyOverrides(env.d).get(`${key}.q`) : undefined;
  const base = { key, id: block.id, kind: block.kind, h: block.h, q: ownQ ?? block.q };
  const own = env.ignoreCopy ? undefined : copyOverrides(env.d).get(key);
  if (own !== undefined) return { ...base, items: customItems(block.kind, own), custom: true };

  const subj = subject ?? (block.subject ? subjectFor(env, block.subject) : e.kind === 'service' ? serviceOfKey(env.d, key) : null);
  const first = variantIndex(env.d, key);
  // The chosen wording; if every sentence of it is dropped, the next ones (the data decides, never the seed).
  for (const v of [first, ...[0, 1, 2].filter((i) => i !== first)]) {
    const sentences: Seg[][] = [];
    for (const s of block.variants[v]) {
      const segs = resolveSentence(env, s, e.allow, subj, e.strict);
      if (segs) sentences.push(segs);
    }
    if (!sentences.length) continue;
    // An answer that is only a link to another page answers nothing: a question needs at least one sentence of its own.
    if (block.kind === 'qa' && !sentences.some((segs) => segs.every((g) => g.t === 'text'))) continue;
    const items = block.kind === 'list' || block.kind === 'step'
      ? sentences
      : [sentences.reduce<Seg[]>((acc, segs, i) => (i === 0 ? [...segs] : [...acc, { t: 'text' as const, s: ' ' }, ...segs]), [])];
    return { ...base, items, custom: false };
  }
  return null;
}

/** The segments as plain words (links as their label): what the editor shows as "suggested". */
export const segsText = (segs: readonly Seg[]): string => segs.map((s) => (s.t === 'text' ? s.s : s.label)).join('');
export function blockText(b: ResolvedBlock): string {
  return b.items.map((it) => segsText(it)).join(b.kind === 'list' || b.kind === 'step' ? '\n' : '\n\n');
}

// ── What a page prints ──────────────────────────────────────────────────────────────────────────

/** The four blocks of a service guide for the service `subject`. */
export function guideBlocks(env: CopyEnv, guide: GuideId, subject: Svc): ResolvedBlock[] {
  const out: ResolvedBlock[] = [];
  for (const block of GUIDES[guide].blocks) {
    const b = resolveBlock(env, copyKey(guide, block.id), subject);
    if (b) out.push(b);
  }
  return out;
}

/** The library blocks of one guide page that have something to say for this site, in order. */
export function extraBlocks(env: CopyEnv, page: ExtraId): ResolvedBlock[] {
  const out: ResolvedBlock[] = [];
  for (const block of EXTRA_PAGES[page].blocks) {
    const b = resolveBlock(env, copyKey(page, block.id));
    if (b) out.push(b);
  }
  return out;
}

const FAQ_DATA_IDS: readonly string[] = ['book', 'hours', 'where', 'price', 'length', 'kids', 'policy'];
/** How many FAQ questions the site's own data can answer (the FAQ page needs at least 3). */
export function faqDataQuestions(d: WebsiteData): number {
  const env = lenientEnv(d, { ignoreCopy: true });
  return FAQ_DATA_IDS.filter((id) => resolveBlock(env, `faq.${id}`)).length;
}

/** Hair care "how often" lines: one per listed haircut-type service, its own guide's advice. */
export interface OftenRow { index: number; title: string; guide: GuideId; segs: Seg[] }
export function howOftenRows(env: CopyEnv): OftenRow[] {
  const rows: OftenRow[] = [];
  for (const s of titledServices(env.d)) {
    if (!s.guide || !HAIRCUT_TYPE.has(s.guide)) continue;
    const def = GUIDES[s.guide];
    if (!def.interval) continue;
    const line = def.interval[variantIndex(env.d, `guide.${s.guide}.interval`)];
    // The barber's own sentence for this kind of service (`guide.<id>.interval`) is shown as written.
    const own = env.ignoreCopy ? undefined : copyOverrides(env.d).get(`guide.${s.guide}.interval`);
    const segs = own !== undefined ? [{ t: 'text' as const, s: own }] : resolveSentence(env, line, def.allow, s);
    if (segs) rows.push({ index: s.index, title: s.title, guide: s.guide, segs });
    if (rows.length >= 8) break;
  }
  return rows;
}

/** The listed services of the beard-type, with prices, for Beard care. */
export const beardServices = (d: Pick<WebsiteData, 'services'> & Partial<Pick<WebsiteData, 'extraPages' | 'source'>>): Svc[] => titledServices(d).filter((s) => isBeardTitle(s.title, d)).slice(0, 12);

// ── For the editor ──────────────────────────────────────────────────────────────────────────────

/** The suggested text of a block for this site, as plain words (links as their labels): what "Reset to suggested" restores. */
export function copyDefault(d: WebsiteData, key: string): string {
  const e = entryFor(key);
  if (!e) return '';
  const env = lenientEnv(d, { ignoreCopy: true });
  if (e.special === 'q') return REGISTRY.get(key.slice(0, -2))?.block.q ?? '';
  if (e.special === 'interval') {
    const g = e.scope as GuideId;
    const svc = titledServices(d).find((x) => x.guide === g);
    const line = GUIDES[g].interval?.[variantIndex(d, key)];
    const segs = svc && line ? resolveSentence(env, line, GUIDES[g].allow, svc) : null;
    return segs ? segsText(segs) : '';
  }
  const subject = e.kind === 'guide' ? titledServices(d).find((s) => s.guide === e.scope) ?? null : null;
  const b = resolveBlock(env, key, subject);
  return b ? blockText(b) : '';
}

/**
 * The copy keys the preview of one page can tap. `servicePages` = the indexes of the services that have a page
 * (pages.ts PageSet.services), needed to know which service shows a guide.
 */
export function visibleCopyKeys(d: WebsiteData, file: { key: string; child?: { index: number } }, servicePages: readonly number[] = []): string[] {
  const env = lenientEnv(d);
  if (file.key === 'services' && file.child) {
    const g = serviceGuideFor(d, servicePages).get(file.child.index);
    const subject = titledServices(d).find((s) => s.index === file.child!.index) ?? null;
    if (pageSectionsOf(d, 'service').find((x) => x.id === 'guide')?.hidden) return [];
    const keys = g && subject ? guideBlocks(env, g, subject).map((b) => b.key) : [];
    if (subject && serviceTextOn(d)) {
      const a = serviceAltFor(d, servicePages).get(file.child.index);
      const altKey = svcCopyKey(subject.title, 'alt');
      const visitKey = svcCopyKey(subject.title, 'visit');
      if (a && resolveBlock(env, altKey, subject)) keys.push(altKey);
      if (resolveBlock(env, visitKey, subject)) keys.push(visitKey);
    }
    return keys;
  }
  if (file.key === 'faq' || file.key === 'first-visit' || file.key === 'hair-care' || file.key === 'beard-care') {
    const page = file.key as SectionPage;
    const hidden = new Set(pageSectionsOf(d, page).filter((x) => x.hidden).map((x) => x.id));
    const out: string[] = [];
    for (const b of extraBlocks(env, file.key)) {
      if (hidden.has(b.id)) continue;
      // The question of a FAQ block is a text of its own, tapped apart from the answer.
      if (b.kind === 'qa' && REGISTRY.has(`${b.key}.q`)) out.push(`${b.key}.q`);
      out.push(b.key);
    }
    if (file.key === 'hair-care' && !hidden.has('often')) for (const r of howOftenRows(env)) if (!out.includes(`guide.${r.guide}.interval`)) out.push(`guide.${r.guide}.interval`);
    return out;
  }
  return [];
}


// ── Dedicated text for a service the library has no guide for (svcCopy.ts, step 6) ──────────────
/** What a service page prints from extraPages.svcCopy: plain strings, escaped by the caller. Every field is already resolved. */
export interface AiPage {
  /** The barber's own words (an edit) rather than model text. */
  own: boolean;
  heading: string | null;
  intro: string[];
  sections: { h: string; p: string[] }[];
  faq: { q: string; a: string[] }[];
  /** One resolved, linted sentence; the caller still applies the seo description validator. */
  metaDescription: string | null;
  metaTitle: string | null;
}

const PRONOUN_OPEN_RENDER = /^(?:it|its|this|that|these|those|they|them|their|he|she|his|her|there|such|doing so|also|and|but|so|then|however)\b/i;

/** Resolves the tokens of already-linted sentences. A sentence whose token has no usable value is dropped, and so is a following one that opens with a pronoun. */
function resolveAiSentences(env: CopyEnv, text: string, allow: readonly VocabGroup[], subject: Svc): string[] {
  const out: string[] = [];
  let droppedBefore = false;
  for (const s of sentencesOf(text)) {
    const segs = resolveSentence(env, s, allow, subject, true);
    if (!segs) { droppedBefore = true; continue; }
    if (droppedBefore && PRONOUN_OPEN_RENDER.test(s)) continue;
    droppedBefore = false;
    out.push(segsText(segs));
  }
  return out;
}

/**
 * The dedicated text of this service page, or null (nothing stored, a library guide exists, not the first service with this
 * title, or the entry is unusable). Web-created pages-v2 sites with service guides on only (serviceTextOn).
 * The stored entry is never trusted: shape and caps are checked, model text is linted again and its tokens resolved through the
 * strict whitelist; the barber's own edit (aiGenerated false) is printed as written. Nothing is repaired: an entry that fails
 * its shape, or keeps fewer than MIN_SENTENCES sentences, is omitted whole.
 */
export function aiPageFor(env: CopyEnv, subject: Svc): AiPage | null {
  const d = env.d;
  if (!serviceTextOn(d) || subject.guide) return null;
  const store = d.extraPages?.svcCopy as unknown;
  const key = svcTitleKey(subject.title);
  if (!key || !store || typeof store !== 'object' || Array.isArray(store) || !Object.prototype.hasOwnProperty.call(store, key)) return null;
  if (titledServices(d).find((x) => svcTitleKey(x.title) === key)?.index !== subject.index) return null;
  const shape = checkEntryShape((store as Record<string, unknown>)[key]);
  if (!shape.ok) return null;
  const e = shape.entry;
  if (!e.aiGenerated) {
    const paras = (t: string): string[] => t.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
    return {
      own: true, heading: e.heading ?? null, intro: paras(e.intro),
      sections: e.sections.map((x) => ({ h: x.h, p: paras(x.p) })),
      faq: e.faq.map((x) => ({ q: x.q, a: paras(x.a) })),
      metaDescription: e.metaDescription ?? null, metaTitle: e.metaTitle ?? null,
    };
  }
  // Model text prints only with an approval. The renderer is pure (it also runs in the browser preview) so it cannot verify the server's
  // signature: the server steps (svcCopySanitize at draft save and publish, and again inside renderPendingBundle for every deploy) drop
  // unsigned or forged text and turn a valid 'auto' (flag on) into 'owner' for the render. 'auto' itself NEVER prints from here, so
  // with the flag off a stored 'auto' cannot print on any path. A proposal never prints.
  if (e.approval !== 'owner') return null;
  const allow = serviceWordsIn(subject.title);
  let count = 0;
  const para = (t: string): string[] => { const l = lintParagraph(t, allow); const r = l.text ? resolveAiSentences(env, l.text, allow, subject) : []; count += r.length; return r.length ? [r.join(' ')] : []; };
  const line = (t: string, kind: 'heading' | 'question' = 'heading'): string | null => {
    if (lintLine(t, allow, kind).length) return null;
    const segs = resolveSentence(env, t, allow, subject, true);
    return segs ? segsText(segs) : null;
  };
  const intro = para(e.intro);
  const sections: AiPage['sections'] = [];
  for (const x of e.sections) { const h = line(x.h); const p = para(x.p); if (h !== null && p.length) sections.push({ h, p }); }
  const faq: AiPage['faq'] = [];
  for (const x of e.faq) { const q = line(x.q, 'question'); const a = para(x.a); if (q !== null && a.length) faq.push({ q, a }); }
  if (!intro.length || count < MIN_SENTENCES) return null;
  const md = e.metaDescription ? lintParagraph(e.metaDescription, allow) : null;
  const metaSents = md && md.written === 1 && md.kept === 1 ? resolveAiSentences(env, md.text, allow, subject) : [];
  return {
    own: false, heading: e.heading ? line(e.heading) : null, intro, sections, faq,
    metaDescription: metaSents.length === 1 ? metaSents[0] : null,
    metaTitle: e.metaTitle && !lintLine(e.metaTitle, allow).length ? (() => { const g = resolveSentence(env, e.metaTitle!, allow, subject, true); return g ? segsText(g) : null; })() : null,
  };
}
