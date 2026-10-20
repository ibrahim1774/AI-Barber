import type { WebsiteData } from '@/web/types';
import { IMAGE_PATHS, editableTextPaths } from '@/lib/editable';

/** The only messages the native side acts on. */
export type PreviewMessage =
  | { type: 'edit'; path: string }
  | { type: 'image'; path: string }
  | { type: 'scrollY'; y: number }
  | { type: 'ready' };

/**
 * Validate a raw WebView message. The page runs third-party script (Tailwind
 * CDN; shop-supplied text in luxe is not escaped). Analytics tags are removed
 * from the preview by stripTracking() in buildPreviewHtml, but anything that
 * is not exactly one of our messages, for a path this site actually has, is
 * still ignored (null).
 */
export function parsePreviewMessage(raw: unknown, data: WebsiteData): PreviewMessage | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case 'edit':
      return typeof o.path === 'string' && editableTextPaths(data).includes(o.path) ? { type: 'edit', path: o.path } : null;
    case 'image':
      return typeof o.path === 'string' && IMAGE_PATHS(data).includes(o.path) ? { type: 'image', path: o.path } : null;
    case 'scrollY':
      return typeof o.y === 'number' && Number.isFinite(o.y) ? { type: 'scrollY', y: Math.max(0, o.y) } : null;
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
