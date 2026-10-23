import type { TemplateId, WebsiteData } from '@/web/types';
import { resolveAibTheme } from '@/web/lib/render/luxe';
import { resolvePrimeTheme } from '@/web/lib/render/prime';
import { resolveEuphoriaTheme } from '@/web/lib/render/euphoria';
import { serviceMeta, withoutLegacyCopy } from '@/web/lib/render/honest';
import { SHOP_PREVIEW_SCRIPT, SITE_SHOP_PATH, isSiteSubpageLink } from '@/web/lib/render/subpages';
import { forRender, renderSite, withImages } from '@/lib/render';
export { EDITOR_JS } from '@/lib/editorScript';

/**
 * Text fields the web editor makes editable in place (GeneratedWebsite.tsx /
 * PrimeWebsite.tsx). `{i}` stands for an array index; see editableTextPaths().
 * The last three are rendered by the prime template only.
 */
export const EDITABLE_TEXT_PATHS: string[] = [
  'shopName',
  'hero.heading',
  'hero.tagline',
  'about.heading',
  'about.description.{i}',
  'services.{i}.title',
  'services.{i}.subtitle',
  'services.{i}.description',
  'phone',
  'area',
  'contact.address',
  'bookingUrl',
  'policy.title',
  'policy.body',
  'pullQuote.text',
];

const PRIME_ONLY = new Set(['policy.title', 'policy.body', 'pullQuote.text']);

/**
 * Paths that are NOT reliably tappable in a template's preview, so the native
 * "All fields" sheet is the way to edit them. Patterns use `{i}` like
 * EDITABLE_TEXT_PATHS. Reasons (verified by __tests__/editable.test.ts):
 *  - bookingUrl: every template only puts it in href attributes, never in text.
 *  - area: rendered as text only through cityStateOnly(), which drops the
 *    leading parts of a 3+ part address ("1 Main St, Brooklyn, NY"); otherwise
 *    it is only in <title>/<meta>.
 *  - services.{i}.subtitle (luxe, prime): the template shows
 *    `duration || subtitle`, so a scraped service with a duration hides it.
 * Notable transforms that are still tappable: luxe splits shopName on spaces
 * for the header/footer logo (orphaned markers, stripped) but prints it whole in
 * the copyright line; luxe capitalises contact.address via charAt(0), which only
 * touches the marker. Prime/euphoria HTML-escape values (the span wraps the
 * escaped text).
 */
export const SHEET_ONLY_PATHS: Record<TemplateId, string[]> = {
  luxe: ['bookingUrl', 'area', 'services.{i}.subtitle'],
  prime: ['bookingUrl', 'area', 'services.{i}.subtitle'],
  euphoria: ['bookingUrl', 'area'],
};

/** Collapse concrete indices back to the `{i}` pattern: services.3.title -> services.{i}.title */
export function pathPattern(path: string): string {
  return path.replace(/\.\d+(?=\.|$)/g, '.{i}');
}

export function isSheetOnly(template: TemplateId, path: string): boolean {
  return (SHEET_ONLY_PATHS[template] || []).includes(pathPattern(path));
}

/** EDITABLE_TEXT_PATHS with `{i}` expanded against this site's arrays. */
export function editableTextPaths(d: WebsiteData): string[] {
  const out: string[] = [];
  for (const pattern of EDITABLE_TEXT_PATHS) {
    if (PRIME_ONLY.has(pattern) && d.template !== 'prime') continue;
    const i = pattern.indexOf('.{i}');
    if (i < 0) {
      out.push(pattern);
      continue;
    }
    const arr = getPath(d, pattern.slice(0, i));
    if (!Array.isArray(arr)) continue;
    arr.forEach((_, n) => out.push(pattern.replace('{i}', String(n))));
  }
  return out;
}

/** Every image slot, keyed like setPath paths. */
export const IMAGE_PATHS = (d: WebsiteData): string[] => [
  'hero.imageUrl',
  'about.imageUrl',
  ...(d.gallery || []).map((_, i) => `gallery.${i}`),
  ...(d.craftImages || []).map((_, i) => `craftImages.${i}`),
  ...(d.staff || []).map((_, i) => `staff.${i}.photo`),
];

const filled = (u: unknown): boolean => typeof u === 'string' && u !== '';

/**
 * Whether the template for `d` renders image slot `path` as a tap target
 * (an <img src="{{slot}}"> that tagImageSlots tags). Mirrors the templates:
 *  - luxe: hero <img> always; about only when filled; gallery only slots 2..7
 *    when filled (0/1 seed hero/about); staff only with a photo (otherwise a
 *    placeholder <div>); craftImages never (the Craft section was removed).
 *  - prime: hero/about only when filled; gallery slots 0..5 when filled
 *    (.slice(0, 6)); no staff, no craft.
 *  - euphoria: hero/about only when filled; every filled gallery slot; no
 *    staff, no craft.
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
      return template === 'luxe' && filled(d.staff?.[i]?.photo);
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

export function markData(d: WebsiteData): { marked: WebsiteData; ids: Record<string, string> } {
  const ids: Record<string, string> = {};
  let marked = d;
  let n = 0;
  for (const path of editableTextPaths(d)) {
    const value = getPath(d, path);
    // Never mark empty values: templates branch on truthiness (bookingUrl ?, s.description ?).
    if (typeof value !== 'string' || value === '') continue;
    // The site's own /book page link must reach the renderer as is: it decides the "Book online" strip.
    if (path === 'bookingUrl' && isSiteSubpageLink(value)) continue;
    const id = letterId(n++);
    ids[id] = path;
    marked = setPath(marked, path, `${M}${id}${M}${value}${M}/${M}`);
  }
  return { marked, ids };
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
  return html.replace(/src="\{\{(hero|about|gallery|craft|staff)(\d*)\}\}"/g, (whole, slot: string, i: string) => {
    if ((slot === 'hero' || slot === 'about') !== (i === '')) return whole;
    return `${whole} data-edit-image="${SLOT_PATH[slot](i)}"`;
  });
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

export function buildPreviewHtml(raw: WebsiteData, editable: boolean, shopProducts?: PreviewProduct[] | null): string {
  // Markers go in only after the data is what the published page would render.
  const data = asPublished(raw);
  const bg = previewBackground(data);
  if (!editable) return withPreviewBackground(withShopPreview(withImages(stripTracking(renderSite(forRender(data))), data), shopProducts), bg);
  const { marked, ids } = markData(data);
  return withPreviewBackground(
    withShopPreview(withImages(tagImageSlots(prepareEditableHtml(stripTracking(renderSite(forRender(marked))), ids)), data), shopProducts),
    bg,
  );
}
