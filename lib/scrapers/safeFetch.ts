// SSRF-safe page fetch for the "import from any website" flow (api/import-scrape with source 'website'). The endpoint
// has no login, so the URL is untrusted: it must never make this server read a private network, a cloud metadata
// address or any non-web port. Rules (all enforced before and on every redirect hop):
//   - http / https only, no user:password@, default ports only (80 / 443);
//   - the host is resolved and EVERY address must be public (loopback, private, link-local, CGNAT, metadata, multicast,
//     IPv4-mapped / NAT64 forms of those are all refused); IP-literal hosts are checked directly;
//   - redirects are followed by hand (max 3), each hop re-validated; HTML only; 3 MB body cap; 8 s total timeout.
// Known limit (not fixed): fetch() resolves the name again itself, so a DNS-rebinding host could answer differently the
// second time. Pinning the checked IPs needs an undici Agent with a custom lookup, but undici is not a declared
// dependency of this repo (only a transitive one), so it was left out; the rebinding window needs egress rules too.
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { ScrapeError } from './types.js';

export const MAX_HTML_BYTES = 3 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;

export type HostResolver = (host: string) => Promise<string[]>;

export const defaultResolver: HostResolver = async (host) => {
  const rows = await dnsLookup(host, { all: true });
  return rows.map((r) => r.address);
};

function v4Private(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224; // multicast, reserved, broadcast
}

/** Expand an IPv6 literal to eight 16-bit groups, or null. Handles "::", and a trailing dotted IPv4. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    if (p.some((n) => n > 255)) return null;
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if ((halves.length === 1 && fill !== 0) || fill < 0) return null;
  const all = [...head, ...(halves.length === 2 ? Array(fill).fill('0') : []), ...tail].map((g) => parseInt(g, 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}

/** True when `ip` (v4 or v6 literal) is NOT a public unicast address. Unparseable input counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const embeddedV4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((n) => n === 0)) return g[5] === 0xffff ? v4Private(embeddedV4) : true; // ::ffff:a.b.c.d mapped; ::, ::1, ::a.b.c.d all refused
  if (g[0] === 0x64 && g[1] === 0xff9b) return v4Private(embeddedV4); // NAT64
  if (g[0] === 0x2002) return v4Private(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation 2001:db8::/32
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

const blocked = (why: string) => new ScrapeError(`We can't read that address (${why}). Paste your shop's public website link.`, 'blocked_url');

/** Parse + validate a user-typed website URL. Throws ScrapeError('blocked_url'). Does not touch the network. */
export function parseWebsiteUrl(raw: string): URL {
  const text = String(raw || '').trim();
  if (!text || text.length > 2000) throw blocked('not a web link');
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw blocked('not a web link');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw blocked('only http and https links');
  if (u.username || u.password) throw blocked('links with a login are not allowed');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') throw blocked('unusual port');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw blocked('no host');
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) throw blocked('private host');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw blocked('private address');
  } else if (!host.includes('.')) {
    throw blocked('not a public host');
  }
  return u;
}

/** Resolve `host` and require every address to be public. IP literals skip DNS. */
export async function assertPublicHost(host: string, resolve: HostResolver = defaultResolver): Promise<void> {
  const h = host.replace(/^\[|\]$/g, '');
  if (isIP(h)) {
    if (isPrivateAddress(h)) throw blocked('private address');
    return;
  }
  let addrs: string[];
  try {
    addrs = await resolve(h);
  } catch {
    throw new ScrapeError("We couldn't find that website. Check the link and try again.", 'fetch_failed');
  }
  if (!addrs.length) throw new ScrapeError("We couldn't find that website. Check the link and try again.", 'fetch_failed');
  if (addrs.some(isPrivateAddress)) throw blocked('private address');
}

/** URL for an <img> / photo: https only, public-looking host (no IP literal, no private name), default port. Never fetched by us. */
export function isPublicImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (isIP(host)) return false;
    if (host === 'localhost' || !host.includes('.') || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

async function readCapped(resp: any): Promise<string> {
  const declared = Number(resp.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) throw tooLarge();
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const text = await resp.text();
    if (Buffer.byteLength(text) > MAX_HTML_BYTES) throw tooLarge();
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const tooLarge = () => new ScrapeError('That page is too big to read. Try your shop\'s home page link.', 'too_large');

export interface SafeFetchDeps {
  resolve?: HostResolver;
  timeoutMs?: number;
}

/** GET a public web page safely. Returns the HTML and the final (post-redirect) URL. Throws ScrapeError. */
export async function fetchPublicHtml(rawUrl: string, deps: SafeFetchDeps = {}): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let url = parseWebsiteUrl(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname, deps.resolve);
      let resp: any;
      try {
        resp = await fetch(url.toString(), {
          headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (e: any) {
        if (controller.signal.aborted) throw new ScrapeError('That website took too long to answer. Try again in a minute.', 'timeout');
        throw new ScrapeError("We couldn't open that website. Check the link and try again.", 'fetch_failed');
      }
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers?.get?.('location');
        if (!loc) throw new ScrapeError("That website redirected somewhere we can't follow.", 'fetch_failed');
        if (hop === MAX_REDIRECTS) throw new ScrapeError('That website redirects too many times.', 'fetch_failed');
        let next: URL;
        try {
          next = parseWebsiteUrl(new URL(loc, url).toString());
        } catch (e) {
          if (e instanceof ScrapeError) throw e;
          throw new ScrapeError("That website redirected somewhere we can't follow.", 'fetch_failed');
        }
        url = next;
        continue;
      }
      if (resp.status < 200 || resp.status >= 300) {
        throw new ScrapeError(`That website didn't let us read the page (it answered ${resp.status}). Try your booking link instead.`, 'fetch_failed');
      }
      const ct = String(resp.headers?.get?.('content-type') || '');
      if (!/\b(text\/html|application\/xhtml\+xml)\b/i.test(ct)) {
        throw new ScrapeError("That link isn't a web page we can read. Paste your shop's website link.", 'not_html');
      }
      let html: string;
      try {
        html = await readCapped(resp);
      } catch (e) {
        if (e instanceof ScrapeError) throw e;
        if (controller.signal.aborted) throw new ScrapeError('That website took too long to answer. Try again in a minute.', 'timeout');
        throw new ScrapeError("We couldn't read that website. Try again in a minute.", 'fetch_failed');
      }
      return { html, finalUrl: url.toString() };
    }
    throw new ScrapeError('That website redirects too many times.', 'fetch_failed');
  } finally {
    clearTimeout(timer);
  }
}

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 8_000;
/** SVG is deliberately absent (script-capable); HEIC is not web-displayable. */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export interface SafeImageDeps extends SafeFetchDeps {
  /** Aborts the fetch from outside (the caller's overall time budget). */
  signal?: AbortSignal;
  maxBytes?: number;
}

async function readCappedBytes(resp: any, max: number): Promise<Buffer> {
  const declared = Number(resp.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new ScrapeError('image too large', 'too_large');
  const reader = resp.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.byteLength > max) throw new ScrapeError('image too large', 'too_large');
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new ScrapeError('image too large', 'too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * GET a public image safely (same address checks and manual, re-checked redirects as fetchPublicHtml). Accepts only
 * image/jpeg, png, webp, gif, avif; the size cap is enforced while streaming. Throws ScrapeError.
 */
export async function fetchPublicImage(rawUrl: string, deps: SafeImageDeps = {}): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? IMAGE_TIMEOUT_MS);
  const onOuter = () => controller.abort();
  if (deps.signal) { if (deps.signal.aborted) controller.abort(); else deps.signal.addEventListener('abort', onOuter, { once: true }); }
  try {
    let url = parseWebsiteUrl(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname, deps.resolve);
      let resp: any;
      try {
        resp = await fetch(url.toString(), { headers: { 'User-Agent': BROWSER_UA, Accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif' }, redirect: 'manual', signal: controller.signal });
      } catch {
        throw new ScrapeError(controller.signal.aborted ? 'image fetch timed out' : 'image fetch failed', controller.signal.aborted ? 'timeout' : 'fetch_failed');
      }
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers?.get?.('location');
        if (!loc || hop === MAX_REDIRECTS) throw new ScrapeError('image redirect not followed', 'fetch_failed');
        try { url = parseWebsiteUrl(new URL(loc, url).toString()); }
        catch (e) { if (e instanceof ScrapeError) throw e; throw new ScrapeError('image redirect not followed', 'fetch_failed'); }
        continue;
      }
      if (resp.status < 200 || resp.status >= 300) throw new ScrapeError(`image answered ${resp.status}`, 'fetch_failed');
      const contentType = String(resp.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_TYPES.has(contentType)) throw new ScrapeError('not a supported image type', 'not_html');
      try {
        return { buffer: await readCappedBytes(resp, deps.maxBytes ?? MAX_IMAGE_BYTES), contentType, finalUrl: url.toString() };
      } catch (e) {
        if (e instanceof ScrapeError) throw e;
        throw new ScrapeError(controller.signal.aborted ? 'image fetch timed out' : 'image read failed', controller.signal.aborted ? 'timeout' : 'fetch_failed');
      }
    }
    throw new ScrapeError('image redirects too many times', 'fetch_failed');
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onOuter);
  }
}
