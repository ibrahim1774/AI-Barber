import type { TemplateId, WebsiteData } from '@/web/types';
import { resolveAibTheme } from '@/web/lib/render/luxe';
import { resolvePrimeTheme } from '@/web/lib/render/prime';
import { resolveEuphoriaTheme } from '@/web/lib/render/euphoria';
import { nicheOf, serviceMeta, teamOf, withoutLegacyCopy } from '@/web/lib/render/honest';
import { LABELS, LABEL_KEYS, clampLabel, defaultLabel, isFigureFreeLabel, isLabelKey, visibleLabelKeys, visiblePageLabelKeys, type LabelDef, type LabelKey } from '@/web/lib/render/labels';
import { buildPageSet, isMultiPage, pageFileFor, type PageKey, type PageSet } from '@/web/lib/render/pages';
import { copyBlockInfo, copyDefault, copyHasWordings, isCopyKey, visibleCopyKeys } from '@/web/lib/render/guides';
import { dataPathMax, dataPattern, editableDataPaths, sheetOnlyDataPaths } from '@/web/lib/render/editPaths';
import { fileOfPage, heroOfPage, servicePageIndexes } from '@/lib/pageFile';
import { renderSiteBundle } from '@/web/lib/render/site';
import { SHOP_PREVIEW_SCRIPT, SITE_SHOP_PATH, isSiteSubpageLink } from '@/web/lib/render/subpages';
import { forRender, imageUrlMap, renderSite, withImages } from '@/lib/render';
export { EDITOR_JS } from '@/lib/editorScript';

// ---------------------------------------------------------------------------
// Labels (small visible text: nav items, buttons, section headings...)
// ---------------------------------------------------------------------------
//
// Every label of the registry (web/lib/render/labels.ts) is tap-to-edit as path `labels.<LabelKey>`.
// The allow-list below is STATIC (built from the registry, never read from the page or the data), and a
// site only offers the ones its design prints (visibleLabelKeys).

const LABEL_PREFIX = 'labels.';
const defs = LABELS as Record<LabelKey, LabelDef>;

/** Every label path the bridge can ever accept (ratingLine has its own control, not a tap target). */
export const LABEL_TEXT_PATHS: string[] = LABEL_KEYS.filter((k) => defs[k].tap !== false).map((k) => `${LABEL_PREFIX}${k}`);

/** `labels.galleryHeading` -> 'galleryHeading'; null for anything not in the static list. */
export function labelKeyOfPath(path: string): LabelKey | null {
  if (!path.startsWith(LABEL_PREFIX)) return null;
  const key = path.slice(LABEL_PREFIX.length);
  return isLabelKey(key) && defs[key].tap !== false ? key : null;
}

// ---------------------------------------------------------------------------
// Library copy (pages v2): the wording of the guide blocks and guide pages
// ---------------------------------------------------------------------------
//
// `copy` is a flat map whose keys hold dots (`guide.fade.what`, `faq.book`), so a copy text is the path
// `copy.<key>` and is read and written through these helpers, never through getPath / setPath. The key set is
// the vendored library's closed set (isCopyKey).

const COPY_PREFIX = 'copy.';

/** `copy.guide.fade.what` -> 'guide.fade.what'; null for anything not in the library's closed set. */
export function copyKeyOfPath(path: string): string | null {
  if (!path.startsWith(COPY_PREFIX)) return null;
  const key = path.slice(COPY_PREFIX.length);
  return isCopyKey(key) ? key : null;
}
export const copyPath = (key: string): string => `${COPY_PREFIX}${key}`;

/** The text a path shows now: the stored value, or for a label the design's wording when none is stored. */
export function textValue(d: WebsiteData, path: string): string {
  const ck = copyKeyOfPath(path);
  if (ck) {
    const stored = d.copy && Object.prototype.hasOwnProperty.call(d.copy, ck) ? d.copy[ck] : '';
    return typeof stored === 'string' && stored.trim() !== '' ? stored : copyDefault(d, ck);
  }
  const key = labelKeyOfPath(path);
  if (key) {
    const stored = getPath(d, path);
    let text = typeof stored === 'string' ? clampLabel(stored, defs[key].max) : '';
    if (defs[key].plain && !isFigureFreeLabel(text)) text = ''; // the page prints the default for it
    return text !== '' ? text : defaultLabel(key, nicheOf(d), d);
  }
  const v = getPath(d, path);
  return typeof v === 'string' ? v : '';
}

/** The longest text a path accepts, or undefined for free-length fields. */
export function textMaxLength(path: string): number | undefined {
  const ck = copyKeyOfPath(path);
  if (ck) return copyBlockInfo(ck)?.max;
  const key = labelKeyOfPath(path);
  if (key) return defs[key].max;
  return dataPathMax(path);
}

/** Whether the copy sheet offers "Try other wording" for this copy path (not for FAQ questions: one fixed line each). */
export function copyPathHasWordings(path: string): boolean {
  const ck = copyKeyOfPath(path);
  return !!ck && copyHasWordings(ck);
}

/**
 * Stored hours are 24 hour `HH:MM` while the page shows `9:00 AM`, so the open / close of an hours row is edited with
 * the time picker, not as text. Which editor: the shop's `hours.<i>.open|close` -> the Hours sheet; a barber's
 * `staff.<i>.hours.<j>.open|close` -> the Team sheet (a barber's week is edited per barber there, and the Hours sheet
 * only knows the shop's). Day names are plain text and stay in the text sheet. Null for every other path.
 */
export function hoursEditorFor(path: string): 'hours' | 'team' | null {
  const p = dataPattern(path);
  if (p === 'hours.{i}.open' || p === 'hours.{i}.close') return 'hours';
  if (p === 'staff.{i}.hours.{j}.open' || p === 'staff.{i}.hours.{j}.close') return 'team';
  return null;
}

/**
 * Data paths NO page of this site prints as text, so the native "All fields" sheet is their only editor. Computed by the
 * vendored renderer module (sheetOnlyDataPaths) for this site's design and page model, never a static list. The booking
 * link is not text and is not in the list.
 */
export const sheetOnlyTextPaths = (d: WebsiteData): string[] => sheetOnlyDataPaths(d);

/** Collapse concrete indices back to the `{i}` / `{j}` pattern: services.3.title -> services.{i}.title */
export const pathPattern = dataPattern;

export function isSheetOnly(d: WebsiteData, path: string): boolean {
  return path === 'bookingUrl' || sheetOnlyDataPaths(d).includes(path);
}

/**
 * The page the preview shows (multi-page sites). `index` is the position of a per-item page in
 * `services[]` / `staff[]` (the page of the Services or Team group); absent = the group's own page.
 * The slug is resolved from the data on every render, never stored: it changes when an item is renamed.
 */
export type PreviewPage = { key: PageKey; index?: number };

/**
 * The labels a tap can name. Multi-page sites: those of the chosen page, or (no page given) of every
 * page they have. Single-page sites: today's list. Always static registry keys, never read from the page.
 */
function labelKeysFor(d: WebsiteData, page?: PreviewPage | null): LabelKey[] {
  if (!isMultiPage(d)) return visibleLabelKeys(d);
  const ctx = { imageUrls: imageUrlMap(d) };
  if (page) return visiblePageLabelKeys(d, page.key, ctx);
  const out: LabelKey[] = [];
  for (const key of buildPageSet(d, ctx).eligible) for (const k of visiblePageLabelKeys(d, key, ctx)) if (!out.includes(k)) out.push(k);
  return out;
}

const ALWAYS_OFFERED = ['shopName', 'hero.heading', 'hero.tagline', 'about.heading', 'phone', 'area', 'contact.address', 'contact.email', 'bio', 'policy.title', 'policy.body', 'pullQuote.text'];
const PRIME_ONLY_FIELDS = new Set(['policy.title', 'policy.body', 'pullQuote.text']);

/** Every path a tap can name for this site: its data fields (editableDataPaths), then labels, then library copy. */
export function editableTextPaths(d: WebsiteData, page?: PreviewPage | null): string[] {
  const out = editableDataPaths(d, page);
  // editableDataPaths lists the fields a site HAS; these stay offered while empty so a barber can write them in "All fields"
  // (a field without a value has no marker, so nothing is tappable for it).
  for (const p of ALWAYS_OFFERED) {
    if (PRIME_ONLY_FIELDS.has(p) && d.template !== 'prime') continue;
    if (p === 'bio' && (d.template ?? 'luxe') !== 'luxe') continue;
    if (!out.includes(p)) out.push(p);
  }
  for (const key of labelKeysFor(d, page)) out.push(`${LABEL_PREFIX}${key}`);
  for (const key of copyKeysFor(d, page)) out.push(copyPath(key));
  return out;
}

/** The library text blocks a tap can name: those of the chosen page, or (no page given) of every page of the site. */
function copyKeysFor(d: WebsiteData, page?: PreviewPage | null): string[] {
  if (!isMultiPage(d)) return [];
  const servicePages = servicePageIndexes(d);
  if (page) return visibleCopyKeys(d, fileOfPage(page), servicePages);
  const out: string[] = [];
  for (const f of buildPageSet(d, { imageUrls: imageUrlMap(d) }).files) {
    for (const k of visibleCopyKeys(d, f, servicePages)) if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** Every image slot, keyed like setPath paths. */
export const IMAGE_PATHS = (d: WebsiteData, page?: PreviewPage | null): string[] => [
  'hero.imageUrl',
  'about.imageUrl',
  ...(d.gallery || []).map((_, i) => `gallery.${i}`),
  ...(d.craftImages || []).map((_, i) => `craftImages.${i}`),
  ...(d.staff || []).map((_, i) => `staff.${i}.photo`),
  // The hero photo of the service or guide page on screen (services.<i>.imageUrl, extraPages.images.<key>). Only the
  // page on screen: the Photos sheet and the sample-photo nudge never list these (heroes.ts).
  ...((): string[] => { const h = page && isMultiPage(d) ? heroOfPage(d, page) : null; return h ? [h.path] : []; })(),
];

const filled = (u: unknown): boolean => typeof u === 'string' && u !== '';

/**
 * Whether the template for `d` renders image slot `path` as a tap target
 * (an <img src="{{slot}}"> that tagImageSlots tags). Mirrors the templates:
 *  - luxe: hero <img> always; about only when filled; gallery only slots 2..7
 *    when filled (0/1 seed hero/about); staff only with a photo (otherwise a
 *    placeholder <div>); craftImages never (the Craft section was removed).
 *  - prime: hero/about only when filled; gallery slots 0..5 when filled
 *    (.slice(0, 6)); staff like luxe (P2 team section); no craft.
 *  - euphoria: hero/about only when filled; every filled gallery slot; staff
 *    like luxe (P2 team section); no craft.
 */
function imageSlotTappable(d: WebsiteData, path: string): boolean {
  const template = d.template || 'luxe';
  const [slot, idx] = path.split('.');
  const i = Number(idx);
  switch (slot) {
    case 'hero':
      return template === 'luxe' || filled(d.hero?.imageUrl);
    case 'about':
      return filled(d.about?.imageUrl);
    case 'gallery':
      if (!filled(d.gallery?.[i])) return false;
      if (template === 'luxe') return i >= 2 && i <= 7;
      if (template === 'prime') return i < 6;
      return true;
    case 'staff':
      // All three designs render a Team card per named entry (first five), with an <img> when it has a photo.
      return filled(d.staff?.[i]?.photo) && teamOf(d).some((c) => c.index === i);
    default:
      return false; // craftImages: no template renders {{craftN}}
  }
}

/**
 * Image slots in IMAGE_PATHS(d) that the preview of `d` has no tap target for
 * (template- and data-dependent, like SHEET_ONLY_PATHS for text). Task 7's
 * "All fields" sheet uses this list so every slot stays editable. Verified
 * against the real render by __tests__/editable.test.ts.
 */
export function sheetOnlyImagePaths(d: WebsiteData): string[] {
  return IMAGE_PATHS(d).filter((p) => !imageSlotTappable(d, p));
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function getPath(d: WebsiteData, path: string): unknown {
  let cur: unknown = d;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || UNSAFE_KEYS.has(key)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function setIn(node: unknown, keys: string[], value: unknown): unknown {
  const [key, ...rest] = keys;
  if (UNSAFE_KEYS.has(key)) throw new Error(`Refusing to set unsafe key: ${key}`);
  const copy: Record<string, unknown> = Array.isArray(node)
    ? ([...node] as unknown as Record<string, unknown>)
    : node !== null && typeof node === 'object'
      ? { ...(node as Record<string, unknown>) }
      : /^\d+$/.test(key)
        ? ([] as unknown as Record<string, unknown>)
        : {};
  if (!rest.length && Array.isArray(copy) && /^\d+$/.test(key)) {
    // A slot past the end (the Photos sheet offers every gallery slot): pad with '' so no holes become null.
    while ((copy as unknown as unknown[]).length < Number(key)) (copy as unknown as unknown[]).push('');
  }
  copy[key] = rest.length ? setIn(copy[key], rest, value) : value;
  return copy;
}

/** Immutable set: clones every object/array along the path, shares the rest. */
export function setPath(d: WebsiteData, path: string, value: unknown): WebsiteData {
  return setIn(d, path.split('.'), value) as WebsiteData;
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------
//
// Each editable text value is wrapped as  \u2063{id}\u2063{value}\u2063/\u2063  (U+2063 INVISIBLE
// SEPARATOR) before rendering, so we can find where the template put it.
// Ids are lowercase letters, never digits: prime builds its tel: link with
// phone.replace(/\D/g, ''), which would otherwise keep a digit id.

const M = '\u2063';
const ENC = '%E2%81%A3'; // encodeURIComponent(M) — the map iframe's ?q=

function letterId(n: number): string {
  let s = '';
  do {
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  } while (n > 0);
  return s;
}

export function markData(d: WebsiteData, page?: PreviewPage | null): { marked: WebsiteData; ids: Record<string, string> } {
  const ids: Record<string, string> = {};
  let marked = d;
  let n = 0;
  for (const path of editableTextPaths(d, page)) {
    const copyKey = copyKeyOfPath(path);
    if (copyKey) {
      // The block's wording as the page prints it, as the block's text (an edited block is the barber's own words).
      // `copy` is replaced, never changed in place: the renderer caches the overrides per object.
      const text = textValue(d, path);
      if (text === '') continue;
      const id = letterId(n++);
      ids[id] = path;
      marked = { ...marked, copy: { ...(marked.copy ?? {}), [copyKey]: markCopyText(text, copyBlockInfo(copyKey)?.kind ?? 'p', copyBlockInfo(copyKey)?.max ?? 600, id) } };
      continue;
    }
    const labelKey = labelKeyOfPath(path);
    // A label is marked with the wording the page shows (its default when none is stored), capped to its
    // maximum BEFORE the markers go on so a marker is never cut in half.
    const value = labelKey ? clampLabel(textValue(d, path), defs[labelKey].max) : getPath(d, path);
    // Never mark empty values: templates branch on truthiness (bookingUrl ?, s.description ?).
    if (typeof value !== 'string' || value === '') continue;
    // A booking link is never marked: it only lands in href attributes (sheet-only), and the renderers test it
    // with safeHref(), which refuses a URL wrapped in markers, so a marked link would drop every Book button
    // from the preview. (The site's own /book page link also decides the "Book online" strip.)
    if (path === 'bookingUrl') continue;
    const id = letterId(n++);
    ids[id] = path;
    marked = setPath(marked, path, `${M}${id}${M}${value}${M}/${M}`);
  }
  return { marked, ids };
}

/**
 * A copy text with the editor markers. The renderer splits an override into items (lines of a list, paragraphs of a
 * text) before it prints, so each item gets its own marker pair, all with the one id; a pair around the whole text
 * would be cut in half. The text is capped to the block's maximum first, so a marker is never cut either.
 */
export function markCopyText(text: string, kind: 'p' | 'list' | 'qa' | 'step', max: number, id: string): string {
  const capped = Array.from(text.trim()).slice(0, max).join('');
  const sep = kind === 'list' || kind === 'step' ? /(\r?\n+)/ : /(\r?\n\s*\r?\n)/;
  return capped
    .split(sep)
    .map((part, i) => (i % 2 === 1 || part.trim() === '' ? part : `${M}${id}${M}${part.trim()}${M}/${M}`))
    .join('');
}

const RAW_MARKER = /\u2063(?:[a-zA-Z]+|\/)\u2063/g; // case-insensitive: a template may upper-case a value
const ENC_MARKER = /%E2%81%A3(?:[a-zA-Z]+|%2F)%E2%81%A3/gi;

export function stripMarkers(s: string): string {
  return s.replace(RAW_MARKER, '').replace(/\u2063/g, '');
}

function stripAllMarkers(s: string): string {
  return stripMarkers(s.replace(ENC_MARKER, '').replace(new RegExp(ENC, 'gi'), ''));
}

// Non-text regions: comments, raw-text elements, and tags (attributes). A tag
// may contain '>' inside a quoted attribute (luxe doesn't escape shopName in
// <meta content>); the plain <[^>]*> form is the fallback for unbalanced quotes.
const NON_TEXT =
  /<!--[\s\S]*?-->|<(script|style|title|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:[^>"']|"[^"]*"|'[^']*')*>|<[^>]*>/gi;
const TEXT_RUN = /\u2063([a-z]+)\u2063([^\u2063<]*)\u2063\/\u2063/g;

/**
 * Turn the rendered marked HTML into the editable preview document:
 *  - in text, every complete marked run becomes <span data-edit="path">value</span>;
 *  - everywhere else (attributes such as href="tel:…", <title>, <script>, the
 *    URL-encoded map query) markers are removed, so links and titles are clean
 *    before the WebView ever parses the page;
 *  - orphaned marker halves (luxe splits shopName on spaces) are removed.
 */
export function prepareEditableHtml(html: string, ids: Record<string, string>): string {
  let out = '';
  let last = 0;
  const text = (s: string) =>
    stripAllMarkers(
      s.replace(TEXT_RUN, (whole, id: string, value: string) =>
        Object.prototype.hasOwnProperty.call(ids, id) ? `<span data-edit="${ids[id]}">${value}</span>` : value,
      ),
    );
  for (const m of html.matchAll(NON_TEXT)) {
    out += text(html.slice(last, m.index)) + stripAllMarkers(m[0]);
    last = m.index + m[0].length;
  }
  return out + text(html.slice(last));
}

const SLOT_PATH: Record<string, (i: string) => string> = {
  hero: () => 'hero.imageUrl',
  about: () => 'about.imageUrl',
  gallery: (i) => `gallery.${i}`,
  craft: (i) => `craftImages.${i}`,
  staff: (i) => `staff.${i}.photo`,
};

/**
 * Tag each image placeholder with its slot path (before withImages fills the
 * URL). Done by slot rather than by URL because slots can share a URL (a
 * Booksy scrape seeds gallery[1] with the about photo).
 */
export function tagImageSlots(html: string): string {
  return html
    .replace(/src="\{\{(hero|about|gallery|craft|staff)(\d*)\}\}"/g, (whole, slot: string, i: string) => {
      if ((slot === 'hero' || slot === 'about') !== (i === '')) return whole;
      return `${whole} data-edit-image="${SLOT_PATH[slot](i)}"`;
    })
    // The page hero of a service page or guide page (pages v2): the barber's own photo is a placeholder.
    .replace(/src="\{\{(?:service(\d+)|page-(first-visit|hair-care|beard-care))\}\}"/g, (whole, i: string | undefined, key: string | undefined) =>
      `${whole} data-edit-image="${i !== undefined ? `services.${i}.imageUrl` : `extraPages.images.${key}`}"`);
}

/**
 * PREVIEW ONLY: a page hero with no photo of the barber's shows a sample photo printed as its own URL (not a
 * placeholder), so it gets its tap target here. The published page is not touched.
 */
export function tagSampleHero(html: string, d: WebsiteData, page: PreviewPage): string {
  const slot = heroOfPage(d, page);
  if (!slot || slot.own) return html;
  return html.replace('<img class="ab-photo ab-hero" ', `<img data-edit-image="${slot.path}" class="ab-photo ab-hero" `);
}

const TRACKING = /clarity\.ms|googletagmanager|google-analytics|gtag\(|connect\.facebook\.net|fbq\(|analytics\.tiktok\.com|ttq\./;

/**
 * PREVIEW ONLY: drop third-party analytics <script> blocks (inline or src) so
 * in-app previews don't record sessions on the live site's analytics project
 * or send unpublished draft text to a third party. Every other script (e.g.
 * cdn.tailwindcss.com, the luxe header scroll handler) is kept. Never applied
 * to published output: renderSite/withImages are unchanged.
 */
export function stripTracking(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (block) => (TRACKING.test(block) ? '' : block));
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/**
 * The site's own page background (#rrggbb), from the same theme tables the
 * templates use: luxe's --aib-bg, prime's --p-bg, euphoria's --eu-bg. The
 * preview paints it behind and around the page (the WebView, the overscroll
 * bounce, a reload) so no other colour ever shows there.
 */
export function previewBackground(d: WebsiteData): string {
  const t = d.template || 'luxe';
  if (t === 'prime') {
    const bg = resolvePrimeTheme(d.colorTheme)?.bg ?? '#0a0a0a';
    return HEX6.test(bg) ? bg.toLowerCase() : '#0a0a0a';
  }
  if (t === 'euphoria') {
    const bg = resolveEuphoriaTheme(d.colorTheme)?.bg ?? '#000000';
    if (bg === '#000') return '#000000';
    return HEX6.test(bg) ? bg.toLowerCase() : '#000000';
  }
  const rgb = resolveAibTheme(d).bgRgb.trim().split(/\s+/).map(Number);
  if (rgb.length !== 3 || rgb.some((n) => !Number.isFinite(n))) return '#0d0d0d';
  return `#${rgb.map(toHex).join('')}`;
}

// A pin and "Map" in grey, shown on the map's dark box until Google's embed paints over it.
const MAP_PLACEHOLDER_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='64' viewBox='0 0 120 64'>" +
  "<path d='M60 6c-7.2 0-13 5.6-13 12.6C47 28 60 40 60 40s13-12 13-21.4C73 11.6 67.2 6 60 6zm0 17.4a4.8 4.8 0 1 1 0-9.6 4.8 4.8 0 0 1 0 9.6z' fill='%23555'/>" +
  "<text x='60' y='58' text-anchor='middle' font-family='-apple-system,Helvetica,Arial,sans-serif' font-size='12' letter-spacing='3' fill='%23777'>MAP</text>" +
  '</svg>';

/**
 * PREVIEW ONLY: the Google Maps embed (and its wrapper) is a dark box with a
 * placeholder until the map loads. Each edit reloads the preview document and
 * with it the iframe, which otherwise shows white until its tiles arrive
 * (long on cellular), near the bottom of the page.
 */
export const PREVIEW_MAP_CSS =
  'iframe[src*="google.com/maps"],iframe[src*="maps.google"]{background:#1a1a1a url("data:image/svg+xml,' +
  MAP_PLACEHOLDER_SVG.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'").replace(/ /g, '%20') +
  '") center/120px 64px no-repeat !important;color-scheme:dark;}' +
  ':has(> iframe[src*="google.com/maps"]),:has(> iframe[src*="maps.google"]){background-color:#1a1a1a !important;}';

/**
 * PREVIEW ONLY: the document canvas (<html>) gets the site's background, so
 * the area below the footer, the rubber-band overscroll and the moment
 * before the template's own CSS (Tailwind CDN, theme vars) applies are the
 * site's dark colour, never the WebView's default. <body> is left alone.
 */
export function withPreviewBackground(html: string, bg: string): string {
  if (!HEX6.test(bg)) return html;
  const style = `<style id="aib-preview-bg">html{background-color:${bg};min-height:100%;}${PREVIEW_MAP_CSS}</style>`;
  // Before the first stylesheet/script in <head>, so it applies on the first paint.
  const at = html.search(/<head\b[^>]*>/i);
  if (at < 0) return style + html;
  const end = html.indexOf('>', at) + 1;
  return html.slice(0, end) + style + html.slice(end);
}

/** The exact document SitePreview loads. */
/**
 * The data as the published page shows it, made explicit so editor markers can't change it: old invented
 * copy removed (withoutLegacyCopy), and a service subtitle that only repeats the price ("30 min · $25",
 * "$25") cut back the way serviceMeta prints it. Inside a marked string serviceMeta can no longer see the
 * repeat, so without this the preview would show a line the published page drops. Same object when clean.
 */
export function asPublished(d: WebsiteData): WebsiteData {
  const clean = withoutLegacyCopy(d);
  const services = Array.isArray(clean.services) ? clean.services : [];
  let changed = false;
  const next = services.map((s) => {
    const sub = s?.subtitle ?? '';
    const shown = serviceMeta({ subtitle: sub, price: s?.price });
    if (!sub || shown === sub.trim()) return s;
    changed = true;
    return { ...s, subtitle: shown };
  });
  return changed ? { ...clean, services: next } : clean;
}

/** A product for the editor's Shop preview (the barber's own list; the preview can't fetch the live one). */
export type PreviewProduct = { name: string; priceCents: number; photo?: string | null };

const escHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (c: number) => {
  const d = c / 100;
  return `$${d % 1 === 0 ? String(d) : d.toFixed(2)}`;
};
export const SHOP_PREVIEW_PLACEHOLDER = 'Your products show here';
export const SHOP_PREVIEW_EDITOR_NOTE = 'Preview only — the live site shows your current products.';

/**
 * The homepage Shop section as the published page shows it once its script has loaded products: the
 * published page fills it in the browser from the live store, which the editor's WebView can't reach.
 * Here it is filled from the app's own product list (up to 4, not sold out, same cards), or with one
 * placeholder card, and a small editor-only note. The fetch script is dropped. Unchanged when the page
 * has no Shop section.
 */
export function withShopPreview(html: string, products: PreviewProduct[] | null | undefined): string {
  if (!html.includes('id="shop-preview"')) return html;
  const shown = (products ?? []).filter((p) => p && p.name && Number.isFinite(p.priceCents)).slice(0, 4);
  const card = (p: PreviewProduct) => {
    const photo = p.photo && /^https:\/\//i.test(p.photo) ? `<img class="ab-sp-img" src="${escHtml(p.photo)}" alt="" loading="lazy">` : '';
    return `<a class="ab-sp-card" href="${SITE_SHOP_PATH}">${photo}<span class="ab-sp-name">${escHtml(p.name)}</span><span class="ab-sp-price">${money(p.priceCents)}</span></a>`;
  };
  const cards = shown.length
    ? shown.map(card).join('')
    : `<a class="ab-sp-card" href="${SITE_SHOP_PATH}"><span class="ab-sp-name">${SHOP_PREVIEW_PLACEHOLDER}</span></a>`;
  const note = `<p data-ab-editor-only style="margin:12px 0 0;font:12px/1.4 -apple-system,Helvetica,Arial,sans-serif;opacity:.6">${SHOP_PREVIEW_EDITOR_NOTE}</p>`;
  return html
    .split(`<script>${SHOP_PREVIEW_SCRIPT}</script>`).join('')
    .replace(/(<section id="shop-preview"[^>]*?) hidden>/, '$1>')
    // A function, not a string: prices like "$12" must not be read as $1 / $12 group references.
    .replace(/(<div id="shop-preview-grid"[^>]*>)(<\/div>)/, (_m, open: string, close: string) => `${open}${cards}${close}${note}`);
}

export function buildPreviewHtml(raw: WebsiteData, editable: boolean, shopProducts?: PreviewProduct[] | null, page?: PreviewPage | null): string {
  // Markers go in only after the data is what the published page would render.
  const data = asPublished(raw);
  const bg = previewBackground(data);
  // Multi-page is opt-in (WebsiteData.pages): a site without it previews its one page exactly as before.
  if (isMultiPage(data)) return buildPageHtml(data, editable, shopProducts, page ?? { key: 'home' }, bg);
  if (!editable) return withPreviewBackground(withShopPreview(withImages(stripTracking(renderSite(forRender(data))), data), shopProducts), bg);
  const { marked, ids } = markData(data);
  return withPreviewBackground(
    withShopPreview(withImages(tagImageSlots(prepareEditableHtml(stripTracking(renderSite(forRender(marked))), ids)), data), shopProducts),
    bg,
  );
}

/** The deploy path of a preview page in a page set; Home when that page is off, has no data, or the item is gone. */
export function previewFileOf(set: PageSet, page: PreviewPage): { path: string } {
  const home = { path: 'index.html' };
  if (page.index === undefined) return pageFileFor(set, page.key) ?? home;
  const kids = page.key === 'services' ? set.services : page.key === 'team' ? set.team : [];
  const child = kids.find((c) => c.index === page.index);
  return (child && pageFileFor(set, page.key, child.slug)) || home;
}

/** One page of a multi-page site, through the same pipeline as the single page (markers, image slots, backgrounds). */
function buildPageHtml(data: WebsiteData, editable: boolean, shopProducts: PreviewProduct[] | null | undefined, page: PreviewPage, bg: string): string {
  const { marked, ids } = editable ? markData(data, page) : { marked: data, ids: {} as Record<string, string> };
  const bundle = renderSiteBundle(marked, { imageUrls: imageUrlMap(data) });
  const file = previewFileOf(bundle.set, page);
  const html = (bundle.pages.find((f) => f.path === file.path) ?? bundle.pages[0]).html;
  const clean = stripTracking(html);
  const inner = editable ? tagSampleHero(tagImageSlots(prepareEditableHtml(clean, ids)), data, page) : clean;
  return withPreviewBackground(withShopPreview(withImages(inner, data), shopProducts), bg);
}
