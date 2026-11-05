// Removed and renamed service pages: 308 redirects in the site's vercel.json (Phase 1, step 5).
//
// A web-created pages-v2 site records the page paths it published (web_app_sites.published_paths, migration 027). On the next publish the
// recorded set is compared with the new one: a service page that is gone gets a redirect, to the page it was renamed to when the owner's
// data says so (`extraPages.moved`, old slug -> new slug), else to /services/. Nothing else is ever redirected, and nothing is redirected to
// a page that is not in the new set, so there are no chains and no loops by construction (a `from` is never live, a `to` always is).
//
// Every path that reaches a rule is checked here, whatever produced it: `/services/<slug>/` with a clean slug (isPageSlug) and nothing else
// (no host, no scheme, no query, no '..', no percent sign, no wildcard), and never a reserved top-level path (/book, /shop, /api, /_ab ...).
// Stored state and the owner's `moved` map are untrusted: an entry that fails is OMITTED, never repaired.
//
// Pure, no I/O. Imports only other pure modules.
import { RESERVED_PATHS, isMultiPage, isPageSlug, type SiteFile } from './render/pages.js';
import { hasPagesV2, isWebCreated } from './pagesV2.js';

/** Most redirects a site carries; beyond it the oldest are dropped. DECISION: 200 and no expiry (the plan said 100 and 12 months; no timestamps are
 *  stored, a dead URL costs one small rule and an old link should keep working). Three vercel.json rules per redirect: 600 at most. */
export const REDIRECT_CAP = 200;
/** Most `moved` entries read from the owner's data. */
export const MOVED_CAP = 200;
/** Most page paths recorded (a site has far fewer: 12 service pages, the top-level pages and the team). */
export const PATHS_CAP = 400;

/** Top-level paths no page or redirect may take: the site's own reserved words plus the platform's and the apps' routes. */
export const REDIRECT_RESERVED: ReadonlySet<string> = new Set([
  ...RESERVED_PATHS, 'app', 'edit', 'admin', 'stripe-return', 'learn-clips', 'assets', 'manage', 'static', 'public', 'favicon.ico', '.well-known',
]);

export interface SiteRedirect { from: string; to: string }

/** What is stored per site (web_app_sites.published_paths). */
export interface PublishedPaths {
  v: 1;
  /** Every page of the last publish as a root-absolute path: `/`, `/services/`, `/services/skin-fade/`. Sorted. */
  paths: string[];
  /** Oldest first. */
  redirects: SiteRedirect[];
}

export interface VercelRedirect { source: string; destination: string; permanent: true }

const segmentsOf = (p: string): string[] | null => {
  if (typeof p !== 'string' || !p.startsWith('/') || p.length > 200) return null;
  if (p === '/') return [];
  if (!p.endsWith('/')) return null;
  const segs = p.slice(1, -1).split('/');
  return segs.length <= 2 && segs.every(isPageSlug) ? segs : null;
};

/** Is this a page path we would publish (`/`, `/x/`, `/x/y/`, clean slugs, top segment not reserved)? */
export function isPagePath(p: unknown): p is string {
  const segs = typeof p === 'string' ? segmentsOf(p) : null;
  return !!segs && (segs.length === 0 || !REDIRECT_RESERVED.has(segs[0]));
}

const SERVICE_PATH = /^\/services\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/;
/** `/services/<slug>/`, the only kind of path that is redirected from. */
export const isServicePath = (p: unknown): p is string => isPagePath(p) && SERVICE_PATH.test(p);
/** `/services/<slug>/` or the group page `/services/`: the only kinds of path redirected to. */
export const isRedirectTarget = (p: unknown): p is string => p === '/services/' || isServicePath(p);
const slugOf = (p: string): string => SERVICE_PATH.exec(p)![1];

/** `index.html` -> `/`, `services/fade/index.html` -> `/services/fade/`; null for anything that is not a page file. */
export function hrefOfFile(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  if (path === 'index.html') return '/';
  if (!path.endsWith('/index.html')) return null;
  const href = `/${path.slice(0, -'index.html'.length)}`;
  return isPagePath(href) ? href : null;
}

/** The paths a deploy publishes (from its page files), sorted, no duplicates. */
export function pagePathsOf(pages: readonly SiteFile[]): string[] {
  const out = new Set<string>();
  for (const f of pages) { const h = hrefOfFile(f?.path); if (h) out.add(h); }
  return [...out].sort();
}

/**
 * Do this site's publishes track paths and redirects? Only a web-created site with pages v2 and pages beyond Home: the same gate as the
 * service-page text, noindex and JSON-LD (render/site.ts). Anything else (iOS-made, single page, pages v1, legacy) is left exactly as it was.
 */
export const redirectsApply = (d: Parameters<typeof isMultiPage>[0] & { extraPages?: unknown; source?: unknown }, pages: readonly SiteFile[]): boolean =>
  isMultiPage(d) && hasPagesV2(d) && isWebCreated(d) && pages.length > 1;

/** extraPages.moved (old service slug -> new slug, written by the web editor on a rename), clean entries only. */
export function movedMap(d: { extraPages?: unknown } | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const ep = d?.extraPages;
  const raw = ep && typeof ep === 'object' && !Array.isArray(ep) && Object.prototype.hasOwnProperty.call(ep, 'moved') ? (ep as { moved?: unknown }).moved : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (++n > MOVED_CAP) break;
    if (isPageSlug(k) && isPageSlug(v) && k !== v) out.set(k, v as string);
  }
  return out;
}

const validRedirect = (r: unknown): r is SiteRedirect =>
  !!r && typeof r === 'object' && isServicePath((r as SiteRedirect).from) && isRedirectTarget((r as SiteRedirect).to) && (r as SiteRedirect).from !== (r as SiteRedirect).to;

/** The stored value read back: well-formed entries only (the rest are omitted), or null when it is not a v1 record at all. */
export function parsePublishedPaths(raw: unknown): PublishedPaths | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as { v?: unknown }).v !== 1) return null;
  const r = raw as { paths?: unknown; redirects?: unknown };
  const paths = Array.isArray(r.paths) ? [...new Set(r.paths.filter(isPagePath))].sort().slice(0, PATHS_CAP) : [];
  const seen = new Set<string>();
  const redirects: SiteRedirect[] = [];
  if (Array.isArray(r.redirects)) {
    for (const x of r.redirects.slice(0, REDIRECT_CAP * 2)) {
      if (!validRedirect(x) || seen.has(x.from)) continue;
      seen.add(x.from); redirects.push({ from: x.from, to: x.to });
    }
  }
  return { v: 1, paths, redirects: redirects.slice(-REDIRECT_CAP) };
}

/**
 * The record to store after publishing `newPaths`, and the redirects to ship, given the record of the previous publish.
 *  - a service page that was published before and is not now: redirect to its renamed page (moved chain, target must be a page that is new
 *    in this publish), else to /services/ when that page exists, else none (a plain 404);
 *  - a redirect that is already stored stays, unless its source is live again (a re-added service drops its redirect), and one that pointed at
 *    a page that has itself disappeared is pointed at that page's redirect target (no chains);
 *  - the oldest beyond REDIRECT_CAP are dropped;
 *  - last, every rule is checked again: source not live, target live, both valid, no duplicate source.
 * No previous record (first publish, or the store could not be read): nothing can be told to be gone, so there are no redirects.
 */
export function planPublishedPaths(prev: PublishedPaths | null, newPaths: readonly string[], moved: ReadonlyMap<string, string> = new Map()): PublishedPaths {
  const paths = [...new Set(newPaths.filter(isPagePath))].sort().slice(0, PATHS_CAP);
  const live = new Set(paths);
  const hasServices = live.has('/services/');
  const before = new Set(prev?.paths ?? []);
  // DECISION: a rename onto a service page that already existed (a merge) goes to /services/, not to the merged page: `moved` can be stale.

  const targetFor = (slug: string): string | null => {
    let cur = slug;
    const seen = new Set<string>([slug]);
    for (let i = 0; i < 12; i++) {
      const next = moved.get(cur);
      if (!next || seen.has(next)) break;
      seen.add(next); cur = next;
      const p = `/services/${cur}/`;
      if (live.has(p) && !before.has(p)) return p;
    }
    return hasServices ? '/services/' : null;
  };

  const fresh = new Map<string, string>();
  for (const p of [...before].filter(isServicePath).sort()) {
    if (live.has(p)) continue;
    const to = targetFor(slugOf(p));
    if (to) fresh.set(p, to);
  }

  const out: SiteRedirect[] = [];
  for (const r of prev?.redirects ?? []) {
    if (live.has(r.from) || fresh.has(r.from)) continue;
    let to = r.to;
    for (let i = 0; i < 4 && !live.has(to) && fresh.has(to); i++) to = fresh.get(to)!;
    if (!live.has(to)) { if (!hasServices) continue; to = '/services/'; }
    out.push({ from: r.from, to });
  }
  for (const [from, to] of fresh) out.push({ from, to });

  const seen = new Set<string>();
  const redirects = out.filter((r) => validRedirect(r) && !live.has(r.from) && live.has(r.to) && !seen.has(r.from) && !!seen.add(r.from)).slice(-REDIRECT_CAP);
  return { v: 1, paths, redirects };
}

/**
 * The Vercel `redirects` of a list: 308 (permanent), one rule for the path with its trailing slash and one without (Vercel matches
 * sources strictly), destination always the slash form. Invalid entries are omitted. Deterministic for the same list.
 */
export function redirectRules(list: readonly SiteRedirect[] | null | undefined): VercelRedirect[] {
  const out: VercelRedirect[] = [];
  const seen = new Set<string>();
  for (const r of (Array.isArray(list) ? list : []).slice(-REDIRECT_CAP)) {
    if (!validRedirect(r) || seen.has(r.from)) continue;
    seen.add(r.from);
    out.push({ source: r.from.slice(0, -1), destination: r.to, permanent: true }, { source: r.from, destination: r.to, permanent: true }, { source: `${r.from}index.html`, destination: r.to, permanent: true });
  }
  return out;
}
