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
import { EXTRA_PAGES, GUIDES, GUIDE_IDS, type Block, type BlockKind, type ExtraId, type GuideId } from './copyLibrary.js';
import { copyProblems, TOKEN_RE, type VocabGroup } from './copyRules.js';
import { displayPhone, displayPrice, policyToShow } from './honest.js';
import { safeHref } from './safeHref.js';

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
  for (const id of GUIDE_IDS) if (GUIDES[id].match.some((re) => re.test(t0))) return id;
  return null;
}

// Haircut-type = a service that cuts hair; beard-type = one that works on a beard or the face (plan 1c).
const HAIRCUT_TYPE: ReadonlySet<GuideId> = new Set(['cut-beard', 'fade', 'taper', 'kids-cut', 'haircut']);
const BEARD_TYPE: ReadonlySet<GuideId> = new Set(['cut-beard', 'beard-trim', 'line-up', 'shave']);
const PRICE_TYPE: ReadonlySet<GuideId> = new Set(['fade', 'taper', 'haircut']);
export const isHaircutTitle = (title: unknown): boolean => { const g = guideIdForTitle(title); return !!g && HAIRCUT_TYPE.has(g); };
export const isBeardTitle = (title: unknown): boolean => { const g = guideIdForTitle(title); return !!g && BEARD_TYPE.has(g); };
export const isKidsTitle = (title: unknown): boolean => guideIdForTitle(title) === 'kids-cut';

/** A service of the site with a title (editor markers removed). */
export interface Svc { index: number; title: string; price: string; duration: string; guide: GuideId | null }

export function titledServices(d: Pick<WebsiteData, 'services'>): Svc[] {
  const out: Svc[] = [];
  (Array.isArray(d.services) ? d.services : []).forEach((s, index) => {
    const title = plain(s?.title);
    if (title) out.push({ index, title, price: plain(s?.price), duration: plain(s?.duration), guide: guideIdForTitle(title) });
  });
  return out;
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
    const g = guideIdForTitle(services[index]?.title);
    if (g && !used.has(g)) { used.add(g); out.set(index, g); }
  }
  return out;
}

// ── Keys, the closed set of editable blocks ─────────────────────────────────────────────────────
interface Entry { block: Block; allow: VocabGroup[]; scope: GuideId | ExtraId; kind: 'guide' | 'page' }
const REGISTRY = new Map<string, Entry>();
for (const g of GUIDE_IDS) for (const block of GUIDES[g].blocks) REGISTRY.set(`guide.${g}.${block.id}`, { block, allow: [...GUIDES[g].allow, ...(block.allow ?? [])], scope: g, kind: 'guide' });
for (const [page, def] of Object.entries(EXTRA_PAGES) as [ExtraId, (typeof EXTRA_PAGES)[ExtraId]][]) {
  for (const block of def.blocks) REGISTRY.set(`${page}.${block.id}`, { block, allow: [...def.allow, ...(block.allow ?? [])], scope: page, kind: 'page' });
}

/** Every key a `copy` override may use. */
export const COPY_KEYS: readonly string[] = Array.from(REGISTRY.keys());
export const isCopyKey = (k: unknown): k is string => typeof k === 'string' && REGISTRY.has(k);
export const copyKey = (scope: GuideId | ExtraId, blockId: string): string => (isGuideId(scope) ? `guide.${scope}.${blockId}` : `${scope}.${blockId}`);
/** What the editor needs to know about a block: its kind, its longest override and its heading label key. */
export function copyBlockInfo(key: string): { kind: BlockKind; max: number; h?: string; q?: string } | null {
  const e = REGISTRY.get(key);
  return e ? { kind: e.block.kind, max: e.block.max, h: e.block.h, q: e.block.q } : null;
}

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
function sentenceOk(sentence: string, allow: readonly VocabGroup[]): boolean {
  const k = `${allow.join(',')}|${sentence}`;
  let v = lintMemo.get(k);
  if (v === undefined) { v = copyProblems(sentence, { allow }).length === 0; lintMemo.set(k, v); }
  return v;
}

function subjectFor(env: CopyEnv, kind: NonNullable<Block['subject']>): Svc | null {
  const all = titledServices(env.d);
  if (kind === 'haircut') return all.find((s) => s.guide && PRICE_TYPE.has(s.guide) && s.price) ?? null;
  if (kind === 'kids') return all.find((s) => s.guide === 'kids-cut') ?? null;
  return all.find((s) => s.guide && PRICE_TYPE.has(s.guide) && s.duration) ?? all.find((s) => s.duration) ?? null;
}

function openDays(d: WebsiteData): number {
  return (Array.isArray(d.hours) ? d.hours : []).filter((h) => h && !h.closed && (has(h.open) || has(h.close))).length;
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
    case 'openDays': { const n = openDays(d); return n > 0 ? text(String(n)) : null; }
    case 'policy': { const p0 = policyToShow(d); return p0 ? text(plain(p0.body).slice(0, 500)) : null; }
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

/**
 * One library sentence as segments: split into literal text and tokens, each token resolved on its own and never
 * expanded again (so a service called "{shop}" prints literally). Null = the sentence is dropped: it fails the
 * rules, or a token has no value.
 */
export function resolveSentence(env: CopyEnv, sentence: string, allow: readonly VocabGroup[], subject: Svc | null): Seg[] | null {
  if (!sentenceOk(sentence, allow)) return null;
  const out: Seg[] = [];
  let last = 0;
  const push = (seg: Seg): void => {
    const prev = out[out.length - 1];
    if (seg.t === 'text' && prev && prev.t === 'text') prev.s += seg.s; else out.push({ ...seg });
  };
  for (const m of sentence.matchAll(TOKEN_RE)) {
    if (m.index! > last) push({ t: 'text', s: sentence.slice(last, m.index) });
    const seg = tokenSeg(env, m[1], m[2], subject);
    if (!seg) return null;
    push(seg);
    last = m.index! + m[0].length;
  }
  if (last < sentence.length) push({ t: 'text', s: sentence.slice(last) });
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
  const e = REGISTRY.get(key);
  if (!e) return null;
  const { block } = e;
  const base = { key, id: block.id, kind: block.kind, h: block.h, q: block.q };
  const own = env.ignoreCopy ? undefined : copyOverrides(env.d).get(key);
  if (own !== undefined) return { ...base, items: customItems(block.kind, own), custom: true };

  const subj = subject ?? (block.subject ? subjectFor(env, block.subject) : null);
  const first = variantIndex(env.d, key);
  // The chosen wording; if every sentence of it is dropped, the next ones (the data decides, never the seed).
  for (const v of [first, ...[0, 1, 2].filter((i) => i !== first)]) {
    const sentences: Seg[][] = [];
    for (const s of block.variants[v]) {
      const segs = resolveSentence(env, s, e.allow, subj);
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
    const segs = resolveSentence(env, line, def.allow, s);
    if (segs) rows.push({ index: s.index, title: s.title, guide: s.guide, segs });
    if (rows.length >= 8) break;
  }
  return rows;
}

/** The listed services of the beard-type, with prices, for Beard care. */
export const beardServices = (d: Pick<WebsiteData, 'services'>): Svc[] => titledServices(d).filter((s) => s.guide && BEARD_TYPE.has(s.guide)).slice(0, 12);

// ── For the editor ──────────────────────────────────────────────────────────────────────────────

/** The suggested text of a block for this site, as plain words (links as their labels): what "Reset to suggested" restores. */
export function copyDefault(d: WebsiteData, key: string): string {
  const e = REGISTRY.get(key);
  if (!e) return '';
  const env = lenientEnv(d, { ignoreCopy: true });
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
    return g && subject ? guideBlocks(env, g, subject).map((b) => b.key) : [];
  }
  if (file.key === 'faq' || file.key === 'first-visit' || file.key === 'hair-care' || file.key === 'beard-care') {
    return extraBlocks(env, file.key).map((b) => b.key);
  }
  return [];
}
