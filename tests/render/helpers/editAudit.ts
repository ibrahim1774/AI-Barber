// The editable-everywhere audit harness. It repeats, on the server, what the iOS app does to make a preview
// tappable (src/lib/editable.ts markData + prepareEditableHtml): every editable value is wrapped in invisible U+2063
// markers BEFORE rendering, and each marker pair that survives in a text node becomes <span data-edit="path">.
// A visible text node NOT inside such a span is not editable. Markers exist only in the app's preview render; the
// published render never sees them (renderPending / renderSite are called with the plain data).
import type { TemplateId, WebsiteData } from '../../../types';
import { renderSiteBundle, imageUrlMapOf } from '../../../lib/render/site';
import { LABELS, LABEL_KEYS, clampLabel, defaultLabel, isFigureFreeLabel, visibleLabelKeys, visiblePageLabelKeys, type LabelDef, type LabelKey } from '../../../lib/render/labels';
import { buildPageSet, isMultiPage } from '../../../lib/render/pages';
import { copyBlockInfo, copyDefault, visibleCopyKeys } from '../../../lib/render/guides';
import { nicheOf } from '../../../lib/render/honest';
import { editableDataPaths } from '../../../lib/render/editPaths';

const M = '⁣';
const defs = LABELS as Record<LabelKey, LabelDef>;

function letterId(n: number): string {
  let s = '';
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } while (n > 0);
  return s;
}
function getPath(d: any, path: string): unknown {
  let cur = d;
  for (const k of path.split('.')) { if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return undefined; cur = cur[k]; }
  return cur;
}
function setPath(d: any, path: string, value: unknown): any {
  const keys = path.split('.');
  const go = (node: any, i: number): any => {
    const c = Array.isArray(node) ? [...node] : { ...(node ?? {}) };
    c[keys[i]] = i === keys.length - 1 ? value : go(c[keys[i]], i + 1);
    return c;
  };
  return go(d, 0);
}
function markCopyText(text: string, kind: string, max: number, id: string): string {
  const capped = Array.from(text.trim()).slice(0, max).join('');
  const sep = kind === 'list' || kind === 'step' ? /(\r?\n+)/ : /(\r?\n\s*\r?\n)/;
  return capped.split(sep).map((part, i) => (i % 2 === 1 || part.trim() === '' ? part : `${M}${id}${M}${part.trim()}${M}/${M}`)).join('');
}

export type Mode = 'app-today' | 'proposed';
export interface PageRef { key: string; index?: number }

/** What the app marks for one page. `app-today` = the app's static EDITABLE_TEXT_PATHS; `proposed` = the new vendored list. */
export function markFor(d: WebsiteData, page: PageRef, mode: Mode): { marked: WebsiteData; ids: Record<string, string> } {
  const ids: Record<string, string> = {};
  let marked: any = d;
  let n = 0;
  const multi = isMultiPage(d);
  const ctx = { imageUrls: imageUrlMapOf(d) };
  const set = buildPageSet(d, ctx);
  const labelKeys: LabelKey[] = multi ? visiblePageLabelKeys(d, page.key as any, ctx) : visibleLabelKeys(d);
  const file = page.index === undefined ? { key: page.key } : { key: page.key, child: { index: page.index } };
  const copyKeys = multi ? visibleCopyKeys(d, file, set.services.map((c) => c.index)) : [];

  const dataPaths = mode === 'proposed' ? editableDataPaths(d, page) : TODAY_PATHS(d);
  for (const path of dataPaths) {
    const value = getPath(d, path);
    if (typeof value !== 'string' || value === '') continue;
    const id = letterId(n++); ids[id] = path;
    marked = setPath(marked, path, `${M}${id}${M}${value}${M}/${M}`);
  }
  for (const key of labelKeys) {
    const def = defs[key];
    if (def.tap === false) continue;
    const stored = getPath(d, `labels.${key}`);
    let text = typeof stored === 'string' ? clampLabel(stored, def.max) : '';
    if (def.plain && !isFigureFreeLabel(text)) text = '';
    if (text === '') text = defaultLabel(key, nicheOf(d), d);
    const value = clampLabel(text, def.max);
    if (value === '') continue;
    const id = letterId(n++); ids[id] = `labels.${key}`;
    marked = setPath(marked, `labels.${key}`, `${M}${id}${M}${value}${M}/${M}`);
  }
  for (const key of copyKeys) {
    const text = copyDefault(d, key);
    if (text === '') continue;
    const id = letterId(n++); ids[id] = `copy.${key}`;
    const info = copyBlockInfo(key);
    marked = { ...marked, copy: { ...(marked.copy ?? {}), [key]: markCopyText(text, info?.kind ?? 'p', info?.max ?? 600, id) } };
  }
  return { marked, ids };
}

const TODAY_PATTERNS = ['shopName', 'hero.heading', 'hero.tagline', 'about.heading', 'about.description.{i}', 'services.{i}.title', 'services.{i}.subtitle', 'services.{i}.description', 'phone', 'area', 'contact.address', 'policy.title', 'policy.body', 'pullQuote.text'];
function TODAY_PATHS(d: WebsiteData): string[] {
  const out: string[] = [];
  for (const p of TODAY_PATTERNS) {
    if ((p.startsWith('policy') || p.startsWith('pullQuote')) && d.template !== 'prime') continue;
    const i = p.indexOf('.{i}');
    if (i < 0) { out.push(p); continue; }
    const arr = getPath(d, p.slice(0, i));
    if (Array.isArray(arr)) arr.forEach((_, k) => out.push(p.replace('{i}', String(k))));
  }
  return out;
}

const ENC = '%E2%81%A3';
const RAW_MARKER = /⁣(?:[a-zA-Z]+|\/)⁣/g;
const ENC_MARKER = /%E2%81%A3(?:[a-zA-Z]+|%2F)%E2%81%A3/gi;
const stripMarkers = (s: string) => s.replace(RAW_MARKER, '').replace(/⁣/g, '');
const stripAll = (s: string) => stripMarkers(s.replace(ENC_MARKER, '').replace(new RegExp(ENC, 'gi'), ''));
const NON_TEXT = /<!--[\s\S]*?-->|<(script|style|title|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:[^>"']|"[^"]*"|'[^']*')*>|<[^>]*>/gi;
const TEXT_RUN = /⁣([a-z]+)⁣([^⁣<]*)⁣\/⁣/g;
/** The app's prepareEditableHtml. */
export function prepareEditableHtml(html: string, ids: Record<string, string>): string {
  let out = ''; let last = 0;
  const text = (s: string) => stripAll(s.replace(TEXT_RUN, (_w, id: string, v: string) => (Object.prototype.hasOwnProperty.call(ids, id) ? `<span data-edit="${ids[id]}">${v}</span>` : v)));
  for (const m of html.matchAll(NON_TEXT)) { out += text(html.slice(last, m.index)) + stripAll(m[0]); last = m.index! + m[0].length; }
  return out + text(html.slice(last));
}

export interface TextNode { text: string; edit: string | null; tag: string }
export interface AttrText { attr: string; text: string; tag: string }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_m, c) => String.fromCharCode(+c));

/** Visible text segments of the body (not in hidden elements, scripts, styles, svg) and the visible attribute texts. */
export function visibleText(html: string): { nodes: TextNode[]; attrs: AttrText[] } {
  const body = html.slice(Math.max(0, html.search(/<body\b/i)));
  const nodes: TextNode[] = []; const attrs: AttrText[] = [];
  const stack: { tag: string; hidden: boolean; edit: string | null }[] = [];
  const tok = /<!--[\s\S]*?-->|<(script|style|textarea|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
  for (const m of body.matchAll(tok)) {
    if (m[3]) {
      const tag = m[3].toLowerCase(); const a = m[4] || '';
      if (m[2]) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
      const hidden = /\shidden(?=[\s>=\/]|$)/i.test(a) || /aria-hidden="true"/i.test(a) && tag === 'svg';
      const edit = /data-edit="([^"]*)"/.exec(a)?.[1] ?? null;
      const anyHidden = stack.some((s) => s.hidden) || hidden;
      if (!anyHidden) for (const am of a.matchAll(/\s(alt|placeholder|aria-label|title)="([^"]*)"/gi)) { const t = decode(am[2]).trim(); if (/[A-Za-z]/.test(t)) attrs.push({ attr: am[1].toLowerCase(), text: t, tag }); }
      if (!VOID.has(tag) && !/\/\s*$/.test(a)) stack.push({ tag, hidden, edit });
    } else if (m[5] !== undefined) {
      if (stack.some((s) => s.hidden)) continue;
      const text = decode(m[5]).replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const edit = [...stack].reverse().find((s) => s.edit)?.edit ?? null;
      nodes.push({ text, edit, tag: stack[stack.length - 1]?.tag ?? '' });
    }
  }
  return { nodes, attrs };
}

const norm = (h: string): string => h.replace(/published-at" content="\d+"/, 'published-at" content="0"');

export interface PageAudit {
  page: string;
  nodes: TextNode[];
  attrs: AttrText[];
  ref: PageRef;
  ids: Record<string, string>;
  /** The published render of the page (plain data, no markers). */
  plainHtml: string;
  /** The marked render with every marker removed: must equal plainHtml. */
  strippedHtml: string;
  /** The app's editable preview document of the page. */
  previewHtml: string;
}

/** Render every page of a site in the app's editable preview way and list its visible text nodes. */
export function auditSite(site: WebsiteData, template: TemplateId, mode: Mode): PageAudit[] {
  const d = { ...site, template } as WebsiteData;
  const opts = { siteBaseUrl: 'https://fresh.example.com' };
  const plain = renderSiteBundle(d, opts);
  const out: PageAudit[] = [];
  for (const file of plain.set.files) {
    const ref: PageRef = file.child ? { key: file.key, index: file.child.index } : { key: file.key };
    const { marked, ids } = markFor(d, ref, mode);
    const mb = renderSiteBundle(marked, { imageUrls: imageUrlMapOf(d), ...opts });
    const hit = mb.pages.find((p) => p.path === file.path);
    if (!hit) throw new Error(`marking changed the page set: ${template} ${file.path} is missing (${mb.pages.map((p) => p.path).join(', ')})`);
    // The app fills the hidden Shop strip in (withShopPreview), so its words are visible there.
    const previewHtml = prepareEditableHtml(hit.html, ids).replace(/(<section id="shop-preview"[^>]*?) hidden>/, '$1>');
    const { nodes, attrs } = visibleText(previewHtml);
    out.push({
      page: file.path, nodes, attrs, ref, ids, previewHtml,
      plainHtml: norm(plain.pages.find((p) => p.path === file.path)!.html),
      strippedHtml: norm(stripAll(hit.html)),
    });
  }
  return out;
}
