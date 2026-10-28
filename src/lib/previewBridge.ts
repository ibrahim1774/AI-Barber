import type { WebsiteData } from '@/web/types';
import { IMAGE_PATHS, previewEditPaths, type PreviewPage } from '@/lib/editable';
import { buildPageSet } from '@/web/lib/render/pages';
import { imageUrlMap } from '@/lib/render';

/** The only messages the native side acts on. */
export type PreviewMessage =
  | { type: 'edit'; path: string }
  | { type: 'image'; path: string }
  | { type: 'nav'; href: string }
  | { type: 'service'; index: number }
  | { type: 'hours' }
  | { type: 'addService' }
  | { type: 'addButton' }
  | { type: 'scrollY'; y: number }
  | { type: 'rects'; items: ImageRect[] }
  | { type: 'ready' };

/** Where a photo's "Change image" chip is on screen, in WebView points (reported for the Edit tour only). */
export interface ImageRect { path: string; x: number; y: number; w: number; h: number }

/** Photo whose chip the Edit tour points at: the hero if it is on screen, else the first. */
export function tourPillPath(items: ImageRect[]): string | null {
  return (items.find((r) => r.path === 'hero.imageUrl') ?? items[0])?.path ?? null;
}

// 2,000 characters for every message but the photo rectangles, which carry one entry per visible photo.
const MAX_MESSAGE = 2000;
const MAX_RECTS_MESSAGE = 8000;
const MAX_RECTS = 24;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 100000;

const MAX_HREF = 200;

/**
 * The only links a menu tap may name: the page files of this site (computed here from the data, never read
 * from the page) plus the proxied /book and /shop pages.
 */
export function pageHrefsFor(data: WebsiteData): string[] {
  const hrefs = buildPageSet(data, { imageUrls: imageUrlMap(data) }).files.map((f) => f.href);
  for (const h of ['/book', '/shop']) if (!hrefs.includes(h)) hrefs.push(h);
  return hrefs;
}

/**
 * Validate a raw WebView message. The page runs third-party script (Tailwind
 * CDN; shop-supplied text in luxe is not escaped). Analytics tags are removed
 * from the preview by stripTracking() in buildPreviewHtml, but anything that
 * is not exactly one of our messages, for a path this site actually has, is
 * still ignored (null).
 */
export function parsePreviewMessage(raw: unknown, data: WebsiteData, page?: PreviewPage | null, editPaths?: readonly string[]): PreviewMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_RECTS_MESSAGE) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.type !== 'rects' && raw.length > MAX_MESSAGE) return null;
  switch (o.type) {
    case 'edit':
      return typeof o.path === 'string' && (editPaths ?? previewEditPaths(data, page)).includes(o.path) ? { type: 'edit', path: o.path } : null;
    case 'image':
      return typeof o.path === 'string' && IMAGE_PATHS(data, page).includes(o.path) ? { type: 'image', path: o.path } : null;
    case 'nav':
      return typeof o.href === 'string' && o.href.length <= MAX_HREF && pageHrefsFor(data).includes(o.href) ? { type: 'nav', href: o.href } : null;
    case 'service': {
      // A service card: the index of a service this page's text names (services.<i>.*), never a free number.
      const i = o.index;
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0) return null;
      const prefix = `services.${i}.`;
      return (editPaths ?? previewEditPaths(data, page)).some((p) => p.startsWith(prefix)) ? { type: 'service', index: i } : null;
    }
    case 'hours':
      // The shop's working-hours list: only when this page prints shop hours (hours.<i>.*).
      return (editPaths ?? previewEditPaths(data, page)).some((p) => p.startsWith('hours.')) ? { type: 'hours' } : null;
    case 'addService':
      return { type: 'addService' };
    case 'addButton':
      return { type: 'addButton' };
    case 'scrollY':
      return typeof o.y === 'number' && Number.isFinite(o.y) ? { type: 'scrollY', y: Math.max(0, o.y) } : null;
    case 'rects': {
      if (!Array.isArray(o.items)) return null;
      const slots = new Set(IMAGE_PATHS(data, page));
      const items: ImageRect[] = [];
      for (const it of o.items) {
        if (items.length >= MAX_RECTS) break;
        if (it === null || typeof it !== 'object' || Array.isArray(it)) continue;
        const r = it as Record<string, unknown>;
        if (typeof r.path !== 'string' || !slots.has(r.path)) continue;
        if (!finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h) || r.w <= 0 || r.h <= 0) continue;
        items.push({ path: r.path, x: r.x, y: r.y, w: r.w, h: r.h });
      }
      return { type: 'rects', items };
    }
    case 'ready':
      return { type: 'ready' };
    default:
      return null;
  }
}

/** The fields of react-native-webview's ShouldStartLoadRequest we decide on. */
export interface PreviewRequest {
  url: string;
  isTopFrame?: boolean;
  navigationType?: string;
}

// The map <iframe> luxe/prime/euphoria embed: https://maps.google.com/maps?q=…&output=embed
// (and the www.google.com/maps/embed URL it may redirect to).
const MAPS_EMBED = /^https:\/\/(?:maps\.google\.com|www\.google\.com)\/maps(?:[/?#]|$)/;

/**
 * The preview is not a browser. Allowed:
 *  - the in-memory document itself: source={{ html }} loads as a top-frame
 *    `about:blank` with navigationType 'other' (initially and again on every
 *    re-render, since each edit sets new html);
 *  - the Google Maps embed iframe (subframe, not a click/form post).
 * Everything else (links, booking URLs, tel:/mailto:, in-page #anchors, form
 * posts, script navigations to any URL) is blocked. Paired with
 * originWhitelist={['*']}: a narrower whitelist would hand non-matching URLs
 * to Linking.openURL (react-native-webview WebViewShared.tsx), i.e. open the
 * dialer or Safari — exactly what we must not do.
 */
export function shouldAllowPreviewRequest(req: PreviewRequest): boolean {
  const nav = req.navigationType;
  const userNav = nav === 'click' || nav === 'formsubmit' || nav === 'formresubmit';
  if (req.isTopFrame === false) {
    if (userNav) return false;
    return req.url === 'about:blank' || MAPS_EMBED.test(req.url);
  }
  return req.url === 'about:blank' && nav === 'other';
}
