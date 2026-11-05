// Guide pages and the floor of 21 pages (Step 8). Pure, no DOM; imports only other vendored modules.
//
// WHY. A web-created multi-page site should reach AT LEAST PAGE_FLOOR (21) real pages even with a sparse profile. What the data cannot supply
// is made up with a Guides hub (/guides/) and guide pages from a reviewed library of evergreen advice (guideLibrary.ts). They are FILLER FOR
// VISITORS, not SEO: every one is `noindex,follow`, left out of sitemap.xml and the JSON-LD, linked only from the footer and one line on the
// Services page (never the menu). They are not part of the PageSet (PAGE_KEYS / nav / files are untouched, so the iOS app and the Pages sheet
// see exactly what they saw before): site.ts appends their files after the real pages.
//
// THE ARITHMETIC (pinned in tests/render/guidePages.test.ts).
//   real  = countRealPages(set): the visible page files (Home, Services, each service page up to 12, About, Team, barber pages, Gallery, Reviews,
//           Hours, Location, Contact, FAQ, First visit, Hair care, Beard care ...) plus /book when it is in the nav plus /shop only when it is the
//           site's own proxied shop. A page the owner hid does not count; a thin (noindex) service page does.
//   need  = PAGE_FLOOR - real. need <= 0: no guides at all.
//   added = min(GUIDE_ADDED_CAP, need). The hub COUNTS INSIDE the cap: hub + guides <= 12, so a site gets at most 11 guides.
//   guides = max(1, added - 1): a hub with no guide is pointless, so need = 1 gives hub + 1 guide (22 pages, the one case that overshoots).
//   So the minimum real pages for 21 is 21 - 12 = 9. Below 9 real pages the site ends below 21 (hub + 11 guides): it is NEVER padded further.
// The plan is computed from `real` only (guides are not counted in it), so there is no feedback loop and the same data always gives the same plan.
//
// THE GATE (decided and documented): web-created (source 'web-app') AND pages v2 (an `extraPages` object) AND multi-page AND the barber niche.
// It is the same web-origin gate as the SEO rules (site.ts seoV2) but NOT the serviceGuides flag: that flag controls the "About this service"
// text on service pages, not this feature. Non-barber niches (the library says "your barber") get no guides and may stay under 21. The owner can
// switch the whole feature off (`extraPages.guidesOff`) or hide single guides (`extraPages.guidesHidden`).
//
// STORAGE (all additive, nothing is required):
//   extraPages.guidesSel     optional, the guide ids in the order they are offered (the "stored selection"). Absent = the library order. Ids it does not
//                            list follow it in library order (it is an order, not a whitelist; hiding is guidesHidden).
//   extraPages.guidesHidden  guide ids the owner removed. A hidden guide keeps its slot (it is not backfilled): the owner's choice wins over the floor.
//   extraPages.guidesOff     true = no guides.
//   extraPages.pick["guides.<id>.<block>"]  the wording (0..2) the owner chose; else variantIndex() from the stored seed, so a page reads the same on
//                            every load, publish and regenerate (the seed is never rewritten).
//   copy["guides.<id>.title|intro|points|tip"], copy["guides.hub.title|intro|line"]  the owner's own words, validated like the SEO texts
//                            (seoText.checkPlainLine), printed escaped, never linted and never token-processed; an invalid one is ignored (guideCopySanitize
//                            drops it at save). They live in their own key budget and never displace any other `copy` key.
import type { WebsiteData } from '../../types';
import { structuralGuide } from './familyKeywords.js';
import { GUIDE_PAGE_IDS, GUIDES_DIR, isGuidePageId, type GuidePageId } from './guideIds.js';
import { GUIDE_HUB, GUIDE_LIBRARY, GUIDE_UI, type GuideDef, type StyleId } from './guideLibrary.js';
import { guideSentenceProblems } from './guideLint.js';
import { variantIndex } from './guides.js';
import { nicheOf } from './honest.js';
import { buildPageSet, hasFilePages, isMultiPage, plainText, type PageContext, type PageSet } from './pages.js';
import { checkPlainLine, type SeoFieldProblem, type SeoReason } from './seoText.js';
import { spliceable } from './spliceable.js';
import { hasPagesV2, isWebCreated } from '../pagesV2.js';

export const PAGE_FLOOR = 21;
/** The hub and the guides together never add more than this many pages. */
export const GUIDE_ADDED_CAP = 12;

const own = (o: unknown, k: string): boolean => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// ── Counting ────────────────────────────────────────────────────────────────────────────────────

/** Real pages of a page set: visible page files, /book when in the nav, /shop only when it is the site's own shop page. Guides are never in a set. */
export function countRealPages(set: PageSet): number {
  return set.files.length + (set.nav.includes('book') ? 1 : 0) + (set.nav.includes('shop') && set.shopInternal ? 1 : 0);
}

/** The real page count of a site as it would be published (1 for a site that is not multi-page). */
export function countPages(d: WebsiteData, ctx?: PageContext): number {
  if (!isMultiPage(d)) return 1;
  return countRealPages(buildPageSet(d, ctx));
}

// ── Stored settings ─────────────────────────────────────────────────────────────────────────────

export interface GuideSettings { sel: GuidePageId[] | null; hidden: Set<GuidePageId>; off: boolean }

const idList = (v: unknown): GuidePageId[] => {
  const out: GuidePageId[] = [];
  if (Array.isArray(v)) for (const x of v) if (isGuidePageId(x) && !out.includes(x)) out.push(x);
  return out;
};

/** The owner's guide settings from extraPages: known ids only, nothing else is read. */
export function guideSettings(d: Pick<WebsiteData, 'extraPages'>): GuideSettings {
  const ep = d.extraPages as unknown;
  const e = (ep && typeof ep === 'object' && !Array.isArray(ep) ? ep : {}) as Record<string, unknown>;
  const sel = own(e, 'guidesSel') ? idList(e.guidesSel) : [];
  return { sel: sel.length ? sel : null, hidden: new Set(own(e, 'guidesHidden') ? idList(e.guidesHidden) : []), off: e.guidesOff === true };
}

// ── The gate ────────────────────────────────────────────────────────────────────────────────────

/** Does this site get guide pages at all? Web-created, pages v2, multi-page, barber niche, and not switched off. */
export function guidesApply(d: WebsiteData, set: PageSet): boolean {
  return hasFilePages(set) && hasPagesV2(d) && isWebCreated(d) && nicheOf(d).key === 'barber' && !guideSettings(d).off;
}

// ── Eligibility and the plan ────────────────────────────────────────────────────────────────────

/** The structural guides (familyKeywords.structuralGuide, the closed vocabulary) of the titled services. */
function serviceGuideIds(d: Pick<WebsiteData, 'services'>): Set<string> {
  const out = new Set<string>();
  for (const s of Array.isArray(d.services) ? d.services : []) {
    const t = plainText(s?.title);
    const g = t ? structuralGuide(t) : null;
    if (g) out.add(g);
  }
  return out;
}

/** Is this guide offered to this site? A general guide always; a conditional one only when the closed vocabulary finds a matching service. */
export function guideEligible(d: Pick<WebsiteData, 'services'>, id: GuidePageId, seen: Set<string> = serviceGuideIds(d), set?: PageSet): boolean {
  // A real page on the same topic is never repeated by a guide: first visit -> prepare-your-visit, hair care -> hair-care-basics, beard care -> beard-care-basics.
  const covered = id === 'prepare-your-visit' ? 'first-visit' : id === 'hair-care-basics' ? 'hair-care' : id === 'beard-care-basics' ? 'beard-care' : null;
  if (covered && set?.files.some((f) => f.key === covered)) return false;
  const when = GUIDE_LIBRARY[id].when;
  if (!when) return true;
  if (when === 'fade-or-taper') return seen.has('fade') || seen.has('taper');
  if (when === 'kids-cut') return seen.has('kids-cut');
  return seen.has('shave');
}

export interface GuidePlan {
  /** Real pages counted. */
  real: number;
  /** Pages added (hub + guides, hidden ones included): 1 .. GUIDE_ADDED_CAP. */
  added: number;
  /** The guide ids that fill the slots, in order, before the owner's hides. */
  slots: GuidePageId[];
  /** slots minus the owner's hides: the guides that are files. */
  shown: GuidePageId[];
}

/**
 * The guides of a site, or null (gate closed, floor already met, or nothing left to show). Deterministic: the same data always gives the same
 * plan, and it depends on `real` only, never on the guides themselves.
 */
export function planGuides(d: WebsiteData, set: PageSet): GuidePlan | null {
  if (!guidesApply(d, set)) return null;
  const real = countRealPages(set);
  const need = PAGE_FLOOR - real;
  if (need <= 0) return null;
  const added = Math.min(GUIDE_ADDED_CAP, need);
  const want = Math.max(1, added - 1);
  const st = guideSettings(d);
  const seen = serviceGuideIds(d);
  // A stored selection is an ORDER, not a whitelist: ids it does not list (a partial list, or guides added to the library later) follow it in library
  // order, so a site never ends under the floor because of a short list. Removing a guide is `guidesHidden`, which stays hidden either way.
  const order = st.sel ? [...st.sel, ...GUIDE_PAGE_IDS.filter((id) => !st.sel!.includes(id))] : GUIDE_PAGE_IDS;
  const slots = order.filter((id) => guideEligible(d, id, seen, set)).slice(0, want);
  const shown = slots.filter((id) => !st.hidden.has(id));
  if (!shown.length) return null;
  return { real, added, slots, shown };
}

export const guideHref = (id?: GuidePageId): string => (id ? `/${GUIDES_DIR}/${id}/` : `/${GUIDES_DIR}/`);
export const guidePath = (id?: GuidePageId): string => (id ? `${GUIDES_DIR}/${id}/index.html` : `${GUIDES_DIR}/index.html`);

// ── The owner's words (copy keys) ───────────────────────────────────────────────────────────────

export const GUIDE_TITLE_MAX = 60;
export const GUIDE_TEXT_MAX = 600;
export const GUIDE_LINE_MAX = 300;
/** The most `guides.*` keys a site may carry and the most characters they may hold in total. */
export const MAX_GUIDE_KEYS = 80;
export const GUIDE_COPY_TOTAL_MAX = 24000;
const GUIDE_KEY_MAX = 60;

type KeyKind = 'title' | 'block' | 'line';
export interface GuideKey { target: 'hub' | GuidePageId; part: 'title' | 'intro' | 'points' | 'tip' | 'line'; kind: KeyKind; max: number }

/** `guides.<id>.title|intro|points|tip` or `guides.hub.title|intro|line`; null for anything else. */
export function parseGuideKey(key: unknown): GuideKey | null {
  if (typeof key !== 'string' || key.length > GUIDE_KEY_MAX) return null;
  const m = /^guides\.([a-z-]+)\.(title|intro|points|tip|line)$/.exec(key);
  if (!m) return null;
  const part = m[2] as GuideKey['part'];
  if (m[1] === 'hub') {
    if (part === 'title') return { target: 'hub', part, kind: 'title', max: GUIDE_TITLE_MAX };
    if (part === 'intro') return { target: 'hub', part, kind: 'block', max: GUIDE_HUB.introMax };
    if (part === 'line') return { target: 'hub', part, kind: 'line', max: GUIDE_HUB.servicesLineMax };
    return null;
  }
  if (!isGuidePageId(m[1]) || part === 'line') return null;
  return { target: m[1], part, kind: part === 'title' ? 'title' : 'block', max: part === 'title' ? GUIDE_TITLE_MAX : GUIDE_TEXT_MAX };
}
export const isGuideKey = (key: unknown): boolean => parseGuideKey(key) !== null;
/** Every key the editor may write for guides. */
export const GUIDE_COPY_KEYS: readonly string[] = [
  'guides.hub.title', 'guides.hub.intro', 'guides.hub.line',
  ...GUIDE_PAGE_IDS.flatMap((id) => (['title', 'intro', 'points', 'tip'] as const).map((p) => `guides.${id}.${p}`)),
];

/** An owner text for a block: paragraphs / list items one per line, each line plain text under the SEO text rules. Never repaired. */
function checkBlock(raw: unknown, max: number): { ok: true; text: string } | { ok: false; reason: SeoReason } {
  if (typeof raw !== 'string') return { ok: false, reason: 'not_text' };
  if (raw.length > max * 2) return { ok: false, reason: 'too_long_raw' };
  const out: string[] = [];
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim())) {
    if (line === '') { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    const r = checkPlainLine(max, max * 2, line);
    if (!r.ok) return r;
    out.push(r.text);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (!out.length) return { ok: false, reason: 'too_few_letters' };
  const text = out.join('\n');
  if (Array.from(text).length > max) return { ok: false, reason: 'too_long' };
  return { ok: true, text };
}

/** The text to print for an owner value under `key`, or the reason it cannot be used. */
export function checkGuideCopy(key: string, raw: unknown): { ok: true; text: string } | { ok: false; reason: SeoReason } {
  const k = parseGuideKey(key);
  if (!k) return { ok: false, reason: 'bad_key' };
  if (k.kind === 'block') return checkBlock(raw, k.max);
  return checkPlainLine(k.max, k.max * 2, raw);
}

const OVERRIDES = new WeakMap<object, Map<string, string>>();
/** The owner's guide texts that count: known keys, valid values, capped in number and in total length. */
export function guideOverrides(d: Pick<WebsiteData, 'copy'>): Map<string, string> {
  const raw = d.copy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const hit = OVERRIDES.get(raw);
  if (hit) return hit;
  const out = new Map<string, string>();
  let total = 0;
  for (const key of GUIDE_COPY_KEYS) {
    if (out.size >= MAX_GUIDE_KEYS) break;
    if (!own(raw, key)) continue;
    const r = checkGuideCopy(key, (raw as Record<string, unknown>)[key]);
    if (!r.ok) continue;
    total += r.text.length;
    if (total > GUIDE_COPY_TOTAL_MAX) break;
    out.set(key, r.text);
  }
  OVERRIDES.set(raw, out);
  return out;
}

/**
 * Keeps an invalid `guides.*` copy value out of the stored draft (the same contract as seoSanitize): a value that is not text, too long, not plain text,
 * a key the renderer does not know, or past MAX_GUIDE_KEYS is dropped and listed; the rest of the data is untouched and a save is never blocked.
 * Empty text ("no override") is kept. Never mutates; returns the same object when nothing is dropped.
 */
export function guideCopySanitize<T>(sd: T): { siteData: T; problems: SeoFieldProblem[] } {
  const copy = (sd as { copy?: unknown } | null | undefined)?.copy;
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) return { siteData: sd, problems: [] };
  const drop = new Map<string, SeoFieldProblem>();
  let kept = 0;
  for (const key of Object.keys(copy)) {
    if (!key.startsWith('guides.')) continue;
    const v = (copy as Record<string, unknown>)[key];
    const k = parseGuideKey(key);
    const where = { page: k ? `guide:${k.target}` : key.slice(0, GUIDE_KEY_MAX), field: null, key: key.slice(0, GUIDE_KEY_MAX) };
    let reason: SeoReason | null = null;
    if (!k) reason = 'bad_key';
    else if (typeof v !== 'string') reason = 'not_text';
    else if (v.trim() !== '') { const r = checkGuideCopy(key, v); if ('reason' in r) reason = r.reason; }
    if (!reason && ++kept > MAX_GUIDE_KEYS) reason = 'too_many';
    if (reason) drop.set(key, { ...where, reason });
  }
  if (!drop.size) return { siteData: sd, problems: [] };
  // defineProperty, not assignment: an own `__proto__` key stays an own entry and never changes the prototype of the rebuilt object.
  const next: Record<string, unknown> = {};
  for (const key of Object.keys(copy)) if (!drop.has(key)) Object.defineProperty(next, key, { value: (copy as Record<string, unknown>)[key], enumerable: true, writable: true, configurable: true });
  return { siteData: { ...sd, copy: next }, problems: [...drop.values()] };
}

// ── Resolving the text of a guide ───────────────────────────────────────────────────────────────

const lintMemo = new Map<string, boolean>();
const sentenceOk = (s: string, def: GuideDef): boolean => {
  const k = `${def.allow.join(',')}|${s}`;
  let v = lintMemo.get(k);
  if (v === undefined) { v = guideSentenceProblems(s, def.allow).length === 0; lintMemo.set(k, v); }
  return v;
};

/** The picked wording of a library block with every sentence re-linted (a failing sentence is dropped, never repaired); the next wording when none is left. */
function libraryBlock(d: Pick<WebsiteData, 'extraPages'>, id: GuidePageId, blockId: 'intro' | 'points' | 'tip'): { sentences: string[]; styles: StyleId[] | null } {
  const def = GUIDE_LIBRARY[id];
  const block = def.blocks.find((b) => b.id === blockId)!;
  const first = variantIndex(d, `guides.${id}.${blockId}`);
  for (const v of [first, ...[0, 1, 2].filter((i) => i !== first)]) {
    const sentences: string[] = [];
    const styles: StyleId[] = [];
    block.variants[v].forEach((s, j) => { if (sentenceOk(s, def)) { sentences.push(s); if (block.styleOf) styles.push(block.styleOf[v][j]); } });
    if (sentences.length) return { sentences, styles: block.styleOf ? styles : null };
  }
  return { sentences: [], styles: null };
}

/**
 * Hairstyle ideas for a shop that really offers cuts of this list: when 2 or more styles match the titles of the shop's service pages (styleMatchesTitle),
 * only those styles are described, using the matching sentence of every wording (deduped, library order). Fewer than 2 matches: null, and the picked general wording shows.
 * Never claims the shop offers a style: the words only describe the style.
 */
function shopStyles(d: Pick<WebsiteData, 'extraPages'>, id: GuidePageId, titles: readonly string[]): { sentences: string[]; styles: StyleId[] | null } | null {
  const def = GUIDE_LIBRARY[id];
  const block = def.blocks.find((b) => b.id === 'points')!;
  if (!block.styleOf) return null;
  const hit = new Map<StyleId, boolean>();
  const matches = (st: StyleId): boolean => { let v = hit.get(st); if (v === undefined) { v = titles.some((t) => styleMatchesTitle(st, t)); hit.set(st, v); } return v; };
  const sentences: string[] = [];
  const styles: StyleId[] = [];
  for (let v = 0; v < 3; v++) block.variants[v].forEach((s, j) => {
    const st = block.styleOf![v][j];
    if (matches(st) && !sentences.includes(s) && sentenceOk(s, def)) { sentences.push(s); styles.push(st); }
  });
  return new Set(styles).size >= 2 ? { sentences, styles } : null;
}

const paragraphs = (text: string): string[] => text.split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean);

export interface GuideView {
  id: GuidePageId;
  title: string;
  intro: string[];
  pointsHeading: string;
  points: string[];
  /** The style each point defines (hairstyle ideas, library wording only); null when the owner's own list is shown. */
  styles: StyleId[] | null;
  tipHeading: string;
  tip: string[];
}

/** The text of one guide as the page prints it: the owner's words where they wrote some, else the picked library wording. */
export function resolveGuide(d: Pick<WebsiteData, 'extraPages' | 'copy'>, id: GuidePageId, shopTitles?: readonly string[]): GuideView {
  const def = GUIDE_LIBRARY[id];
  const ov = guideOverrides(d);
  const lib = (b: 'intro' | 'points' | 'tip') => libraryBlock(d, id, b);
  const intro = ov.get(`guides.${id}.intro`);
  const pts = ov.get(`guides.${id}.points`);
  const tip = ov.get(`guides.${id}.tip`);
  const pl = pts === undefined ? (id === 'hairstyle-ideas' && shopTitles ? shopStyles(d, id, shopTitles) ?? lib('points') : lib('points')) : null;
  return {
    id,
    title: ov.get(`guides.${id}.title`) ?? def.title,
    intro: intro !== undefined ? paragraphs(intro) : [lib('intro').sentences.join(' ')].filter(Boolean),
    pointsHeading: def.blocks.find((b) => b.id === 'points')!.h ?? '',
    points: pts !== undefined ? lines(pts) : pl!.sentences,
    styles: pl ? pl.styles : null,
    tipHeading: def.blocks.find((b) => b.id === 'tip')!.h ?? '',
    tip: tip !== undefined ? paragraphs(tip) : [lib('tip').sentences.join(' ')].filter(Boolean),
  };
}

export interface HubView { title: string; intro: string[]; line: string }
export function resolveHub(d: Pick<WebsiteData, 'extraPages' | 'copy'>): HubView {
  const ov = guideOverrides(d);
  const pick = (key: string, variants: readonly (readonly string[])[]): string => {
    const first = variantIndex(d, key);
    for (const v of [first, ...[0, 1, 2].filter((i) => i !== first)]) {
      const ok = variants[v].filter((s) => guideSentenceProblems(s, []).length === 0);
      if (ok.length) return ok.join(' ');
    }
    return '';
  };
  const intro = ov.get('guides.hub.intro');
  return {
    title: ov.get('guides.hub.title') ?? GUIDE_HUB.title,
    intro: intro !== undefined ? paragraphs(intro) : [pick('guides.hub.intro', GUIDE_HUB.intro)].filter(Boolean),
    line: ov.get('guides.hub.line') ?? pick('guides.hub.line', GUIDE_HUB.servicesLine),
  };
}

// ── Links to the shop's own service pages (closed vocabulary only) ──────────────────────────────

const GENERIC_TITLE_WORDS = new Set([
  "men's", 'mens', 'men', 'gentlemen', 'gentlemens', "gentlemen's", 'gents', "gent's", 'gent', "women's", 'womens', 'women', 'ladies', 'adult', 'adults', 'senior', 'seniors',
  'regular', 'standard', 'basic', 'classic', 'for', 'hair', 'short', 'long',
]);
/** The whole-token forms of a title (after the audience / level words are dropped) that ARE the style, for the named cuts the closed vocabulary knows. */
const STYLE_FORMS: Partial<Record<StyleId, readonly string[]>> = {
  'buzz-cut': ['buzz cut', 'buzz cuts', 'buzzcut', 'buzzcuts'],
  'crew-cut': ['crew cut', 'crew cuts', 'crewcut', 'crewcuts'],
  mohawk: ['mohawk', 'mohawks', 'mohawk cut', 'mohawk cuts', 'mohawk haircut', 'mohawk haircuts'],
  mullet: ['mullet', 'mullets', 'mullet cut', 'mullet cuts', 'mullet haircut', 'mullet haircuts'],
  undercut: ['undercut', 'undercuts', 'under cut', 'under cuts', 'undercut haircut', 'undercut haircuts'],
  caesar: ['caesar', 'caesars', 'caesar cut', 'caesar cuts', 'caesar haircut', 'caesar haircuts'],
};

const titleTokens = (title: string): string[] =>
  title.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`´]/g, "'").toLowerCase().replace(/[-/.,]/g, ' ').match(/[a-z]+(?:'[a-z]+)?|&|\+/g) ?? [];

/**
 * Does this service title ARE this style? Only through the closed vocabulary: the title must get its guide from structuralGuide (every token vetted), and
 * - fade / taper: that guide is 'fade' / 'taper' (any fade type is a fade);
 * - a named cut (buzz cut, crew cut, mohawk, mullet, undercut, caesar): the guide is 'haircut' AND the core phrase is the whole title as tokens once the
 *   audience and level words are dropped ("Men's Buzz Cut" yes, "Haircut" no, "Buzz Cut & Beard Trim" no, "Mohawk Fade" no);
 * - every other style (side part, pompadour, quiff, slick back, comb over, textured crop) has no vocabulary core: never linked.
 */
export function styleMatchesTitle(style: StyleId, title: unknown): boolean {
  const t = plainText(title);
  if (!t) return false;
  const g = structuralGuide(t);
  if (style === 'fade') return g === 'fade';
  if (style === 'taper') return g === 'taper';
  const forms = STYLE_FORMS[style];
  if (!forms || g !== 'haircut') return false;
  const core = titleTokens(t).filter((w) => !GENERIC_TITLE_WORDS.has(w)).join(' ');
  return forms.includes(core);
}

export interface RelatedLink { href: string; label: string }

/**
 * The shop's own service pages that belong to this guide, for the "On this site" list: only services that have a page in the set, matched through the
 * closed vocabulary, labelled with the title exactly as typed when it passes the name whitelist (spliceable; otherwise the link is omitted, never repaired).
 * At most 6; each service once; barber order.
 */
export function relatedLinks(d: Pick<WebsiteData, 'services'>, set: PageSet, view: GuideView): RelatedLink[] {
  const withPage = new Map(set.services.map((c) => [c.index, c.slug]));
  const services = (Array.isArray(d.services) ? d.services : []).map((s, index) => ({ index, title: plainText(s?.title) })).filter((s) => s.title && withPage.has(s.index));
  const guideSets: Partial<Record<GuidePageId, readonly string[]>> = {
    'fade-and-taper': ['fade', 'taper'], 'child-first-haircut': ['kids-cut'], 'shave-guide': ['shave'], 'beard-care-basics': ['beard-trim', 'cut-beard'],
  };
  const hit = new Set<number>();
  if (view.id === 'hairstyle-ideas') {
    for (const style of view.styles ?? []) {
      const s = services.find((x) => styleMatchesTitle(style, x.title));
      if (s) hit.add(s.index);
    }
  } else {
    const want = guideSets[view.id];
    if (want) for (const s of services) { const g = structuralGuide(s.title); if (g && want.includes(g)) hit.add(s.index); }
  }
  const out: RelatedLink[] = [];
  for (const s of services) {
    if (!hit.has(s.index) || out.length >= 6) continue;
    const label = spliceable('name', s.title);
    if (label !== null) out.push({ href: `/services/${withPage.get(s.index)}/`, label });
  }
  return out;
}

// ── Markup ──────────────────────────────────────────────────────────────────────────────────────

const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (s: string, n: number): string => { const t = s.replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`; };

export interface GuideRenderCtx {
  d: WebsiteData;
  set: PageSet;
  plan: GuidePlan;
  /** The Book button markup (already escaped), or ''. Built by the caller from the booking link, like every other page. */
  bookBtn: string;
}
export interface GuideBody { heading: string; description: string; body: string }

const shellWrap = (inner: string): string => `<section class="ab-sec"><div class="ab-wrap">${inner}</div></section>`;
const moreChips = (plan: GuidePlan, d: WebsiteData, except?: GuidePageId): string => {
  const ids = plan.shown.filter((x) => x !== except);
  if (!ids.length) return '';
  return `<h2 class="ab-h2" style="margin-top:32px">${esc(GUIDE_UI.more)}</h2><div class="ab-chips">${ids.map((x) => `<a class="ab-chip" href="${esc(guideHref(x))}">${esc(guideTitleOf(d, x))}</a>`).join('')}</div>`;
};
const guideTitleOf = (d: Pick<WebsiteData, 'copy'>, id: GuidePageId): string => guideOverrides(d).get(`guides.${id}.title`) ?? GUIDE_LIBRARY[id].title;

/** The hub page body (/guides/). */
export function renderHubBody(ctx: GuideRenderCtx): GuideBody {
  const hub = resolveHub(ctx.d);
  const cards = ctx.plan.shown.map((id) => `<div class="ab-card"><div class="ab-card-top"><h3><a href="${esc(guideHref(id))}">${esc(guideTitleOf(ctx.d, id))}</a></h3></div><p>${esc(GUIDE_LIBRARY[id].blurb)}</p></div>`);
  return {
    heading: hub.title,
    description: clip(hub.intro[0] ?? hub.title, 155),
    body: shellWrap(`<h1 class="ab-h1">${esc(hub.title)}</h1><div class="ab-copy ab-prose">${hub.intro.map((p) => `<p>${esc(p)}</p>`).join('')}</div><div class="ab-grid" style="margin-top:24px">${cards.join('')}</div>`),
  };
}

/** One guide page body. */
export function renderGuideBody(ctx: GuideRenderCtx, id: GuidePageId): GuideBody {
  const withPage = new Set(ctx.set.services.map((c) => c.index));
  const titles = (Array.isArray(ctx.d.services) ? ctx.d.services : []).flatMap((x, i) => (withPage.has(i) ? [plainText(x?.title)] : [])).filter(Boolean);
  const v = resolveGuide(ctx.d, id, titles);
  const related = relatedLinks(ctx.d, ctx.set, v);
  const relatedHtml = related.length
    ? `<h3 class="ab-copy-h">${esc(GUIDE_UI.onThisSite)}</h3><ul class="ab-copy">${related.map((r) => `<li><a href="${esc(r.href)}">${esc(r.label)}</a></li>`).join('')}</ul>`
    : '';
  const pointsHtml = v.points.length ? `${v.pointsHeading ? `<h3 class="ab-copy-h">${esc(v.pointsHeading)}</h3>` : ''}<ul class="ab-copy">${v.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
  const tipHtml = v.tip.length ? `<div class="ab-copy ab-prose">${v.tipHeading ? `<h3 class="ab-copy-h">${esc(v.tipHeading)}</h3>` : ''}${v.tip.map((p) => `<p>${esc(p)}</p>`).join('')}</div>` : '';
  return {
    heading: v.title,
    description: clip(v.intro[0] ?? v.title, 155),
    body: shellWrap(
      `<a class="ab-back" href="${esc(guideHref())}">${esc(GUIDE_UI.back)}</a><h1 class="ab-h1">${esc(v.title)}</h1>`
      + `<div class="ab-copy ab-prose">${v.intro.map((p) => `<p>${esc(p)}</p>`).join('')}</div>${pointsHtml}${relatedHtml}${tipHtml}`
      + `${ctx.bookBtn ? `<div class="ab-actions">${ctx.bookBtn}</div>` : ''}${moreChips(ctx.plan, ctx.d, id)}`,
    ),
  };
}

/** The one line on the Services page: a library sentence and the link to the hub. */
export function servicesLineHtml(d: WebsiteData, plan: GuidePlan | null): string {
  if (!plan) return '';
  const hub = resolveHub(d);
  return `<p class="ab-muted" data-guides-line>${hub.line ? `${esc(hub.line)} ` : ''}<a href="${esc(guideHref())}">${esc(hub.title)}</a></p>`;
}

/** The files of the guides, in order: the hub first. `render` gives each page its shell. */
export function guideFiles(plan: GuidePlan): { path: string; href: string; id: GuidePageId | null }[] {
  return [{ path: guidePath(), href: guideHref(), id: null }, ...plan.shown.map((id) => ({ path: guidePath(id), href: guideHref(id), id }))];
}
