import type { TemplateId, WebsiteData } from '@/web/types';
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
    const id = letterId(n++);
    ids[id] = path;
    marked = setPath(marked, path, `${M}${id}${M}${value}${M}/${M}`);
  }
  return { marked, ids };
}

const RAW_MARKER = /\u2063(?:[a-z]+|\/)\u2063/g;
const ENC_MARKER = /%E2%81%A3(?:[a-z]+|%2F)%E2%81%A3/gi;

export function stripMarkers(s: string): string {
  return s.replace(RAW_MARKER, '').replace(/\u2063/g, '');
}

function stripAllMarkers(s: string): string {
  return stripMarkers(s.replace(ENC_MARKER, '').replace(new RegExp(ENC, 'gi'), ''));
}

// Non-text regions: comments, raw-text elements, and tags (attributes).
const NON_TEXT = /<!--[\s\S]*?-->|<(script|style|title|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]*>/gi;
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

/** The exact document SitePreview loads. */
export function buildPreviewHtml(data: WebsiteData, editable: boolean): string {
  if (!editable) return withImages(renderSite(forRender(data)), data);
  const { marked, ids } = markData(data);
  return withImages(tagImageSlots(prepareEditableHtml(renderSite(forRender(marked)), ids)), data);
}
