// Booking and shop as pages of the barber's own site (spec 2026-10-22-site-subpages).
//
// A barber site is its own Vercel project. When the site belongs to a shop (ab_shops, linked
// through the iOS purchase bound to the site's slug), every deploy of it carries a vercel.json
// whose rewrites proxy /book, /shop, the pages' assets and the exact public APIs those pages
// call to www.aibarber.org. The address bar stays on the barber's domain, and nothing else of
// aibarber.org is reachable through it: the list below is closed and tested
// (tests/siteSubpages.test.ts).
//
// Also here: the static /ab-site.json that tells the pages (and the homepage Shop preview)
// which shop they are, the render-time link normalisation, and the shop's public base URL and
// look, stored on ab_shops after a deploy (migration 011) so customer-facing URLs (Stripe
// returns, manage links, emails) use the barber's domain.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WebsiteData } from '../types.js';
import { isAiBarberBookingLink } from './ios/tiers.js';
import { isSiteBookLink, isSiteShopLink, SITE_CONFIG_PATH } from './render/subpages.js';
import { resolveAibTheme } from './render/luxe.js';
import { resolvePrimeTheme } from './render/prime.js';
import { resolveEuphoriaTheme } from './render/euphoria.js';

/** Where the proxied pages and APIs live. Never the request's host. */
export const AIBARBER_ORIGIN = 'https://www.aibarber.org';
export const SITE_CONFIG_FILE = SITE_CONFIG_PATH;

/** The ab_shops slug check (005): lower-case, hyphens inside, at most 63, not a reserved word. */
const RESERVED_SLUGS = new Set(['manage', 'api', 'stripe-return', 'book', 'shop']);
export function isShopSlug(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s) && !RESERVED_SLUGS.has(s);
}

/**
 * - full: the site's shop has the pages (any app site with an ab_shops row).
 * - manage-only: the offline page of a lapsed site. Customers' manage and order links (in
 *   emails already sent) keep working; nothing new can be booked or bought.
 */
export type SiteSubpages = { mode: 'full'; shopSlug: string } | { mode: 'manage-only' };

export interface Rewrite { source: string; destination: string }

const BOOK_HTML = '/_ab/book.html';
const SHOP_HTML = '/_ab/shop.html';
// Unnamed group on purpose: a named parameter unused in the destination is appended to the
// upstream query. The page reads the token from the browser's path.
const BOOK_MANAGE = '/book/manage/([^/]+)';
const SHOP_MANAGE = '/shop/manage/([^/]+)';
const ASSETS = '/_ab/assets/:file';

/** Every public endpoint src/book and src/shop call (src/book/api.ts, src/shop/api.ts). */
const PAGE_APIS = [
  '/api/book/shop', '/api/book/days', '/api/book/slots', '/api/book/appointments', '/api/book/manage', '/api/book/sent',
  '/api/store/shop', '/api/store/orders', '/api/store/order', '/api/store/sent',
] as const;
/** The ones the manage and order pages call. */
const MANAGE_APIS = ['/api/book/manage', '/api/book/sent', '/api/store/order', '/api/store/sent'] as const;

const to = (path: string): string => `${AIBARBER_ORIGIN}${path}`;

/** The closed allow-list. The only place a barber site's proxy rules are made. */
export function subpageRewrites(sp: SiteSubpages): Rewrite[] {
  if (sp.mode === 'full') {
    if (!isShopSlug(sp.shopSlug)) throw new Error(`invalid shop slug for site subpages: ${String(sp.shopSlug).slice(0, 80)}`);
    return [
      { source: '/book', destination: to(BOOK_HTML) },
      { source: BOOK_MANAGE, destination: to(BOOK_HTML) },
      { source: '/shop', destination: to(SHOP_HTML) },
      { source: SHOP_MANAGE, destination: to(SHOP_HTML) },
      { source: ASSETS, destination: to(ASSETS) },
      ...PAGE_APIS.map((p) => ({ source: p, destination: to(p) })),
    ];
  }
  if (sp.mode === 'manage-only') {
    return [
      { source: BOOK_MANAGE, destination: to(BOOK_HTML) },
      { source: SHOP_MANAGE, destination: to(SHOP_HTML) },
      { source: ASSETS, destination: to(ASSETS) },
      ...MANAGE_APIS.map((p) => ({ source: p, destination: to(p) })),
    ];
  }
  throw new Error('unknown site subpages mode');
}

type Header = { source: string; headers: { key: string; value: string }[] };
export interface SiteVercelConfig { headers: Header[]; rewrites?: Rewrite[] }

const REVALIDATE = [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }];
// Projects created after 2026-04-06 cache external-rewrite responses by the upstream's headers.
// The proxied HTML must never outlive an aibarber.org deploy (its hashed assets are replaced),
// and the APIs are personal and live. Hashed /_ab/assets/* may be cached.
const NO_REWRITE_CACHE = [{ key: 'x-vercel-enable-rewrite-caching', value: '0' }];

/** The vercel.json every site deploy ships. Without subpages: exactly the config sites always had. */
export function siteVercelConfig(sp: SiteSubpages | null): SiteVercelConfig {
  const headers: Header[] = [
    { source: '/index.html', headers: REVALIDATE },
    { source: '/', headers: REVALIDATE },
  ];
  if (!sp) return { headers };
  const rewrites = subpageRewrites(sp);
  for (const r of rewrites) if (r.source !== ASSETS) headers.push({ source: r.source, headers: NO_REWRITE_CACHE });
  if (sp.mode === 'full') headers.push({ source: SITE_CONFIG_FILE, headers: REVALIDATE });
  return { headers, rewrites };
}

/** /ab-site.json: which shop the site's pages are. Public on purpose (the slug is in the old URLs too). */
export function siteConfigFile(shopSlug: string): string {
  if (!isShopSlug(shopSlug)) throw new Error('invalid shop slug for the site config');
  return JSON.stringify({ slug: shopSlug });
}

// ---------------------------------------------------------------------------
// Links on the rendered site
// ---------------------------------------------------------------------------

type Links = { bookingUrl?: unknown; shopUrl?: unknown };

/** Does the site show an AI Barber Book or Shop link (old absolute or new relative form)? */
export function hasAiBarberSiteLinks(sd: Links): boolean {
  return isAiBarberBookingLink(sd.bookingUrl) || isSiteShopLink(sd.shopUrl)
    || (typeof sd.shopUrl === 'string' && sd.shopUrl.trim() !== '');
}

/**
 * The copy that gets rendered for a deploy (the stored copy is not changed):
 * - with the pages: an AI Barber booking link (either form) is `/book`, a shop link is `/shop`;
 * - without them: a relative `/book` or `/shop` is dropped (it would be a dead button). Old
 *   absolute aibarber.org links stay (those pages still work).
 * Another booking site's link is never touched.
 */
export function withSubpageLinks<T extends Links>(sd: T, hasPages: boolean): T {
  const out = { ...sd };
  if (hasPages) {
    if (isAiBarberBookingLink(out.bookingUrl)) out.bookingUrl = '/book';
    if (typeof out.shopUrl === 'string' && out.shopUrl.trim()) out.shopUrl = '/shop';
  } else {
    if (isSiteBookLink(out.bookingUrl)) delete out.bookingUrl;
    if (isSiteShopLink(out.shopUrl)) delete out.shopUrl;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public base URL and look
// ---------------------------------------------------------------------------

export interface ProjectDomain { name: string; verified?: boolean; redirect?: string | null }

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** An https origin (no path), or null. */
export function httpsOrigin(u: unknown): string | null {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const p = new URL(u.trim());
    if (p.protocol !== 'https:' || !HOSTNAME.test(p.hostname) || p.port || p.username || p.password) return null;
    return `https://${p.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/**
 * The shop's public base: a verified custom domain on the site's project that doesn't redirect
 * elsewhere (shortest first), else the deployed URL the deploy resolved. Never a constructed
 * `{slug}.vercel.app` (short names can belong to strangers; see lib/deploySite.ts).
 */
export function pickPublicBase(domains: ProjectDomain[] | null | undefined, deployedUrl: string | null | undefined): string | null {
  const custom = (domains || [])
    .filter((d) => d && typeof d.name === 'string' && d.verified === true && !d.redirect && !/\.vercel\.app$/i.test(d.name) && HOSTNAME.test(d.name))
    .map((d) => d.name.toLowerCase())
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (custom[0]) return `https://${custom[0]}`;
  return httpsOrigin(deployedUrl);
}

export interface SiteLook {
  template: 'luxe' | 'prime' | 'euphoria';
  accent: string;
  bg: string;
  text: string;
  heroUrl: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const rgbToHex = (rgb: string) => '#' + rgb.trim().split(/\s+/).map((n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0')).join('');

/** The site's look for the /book and /shop pages: template, its theme colours, the hero photo. */
export function siteLookOf(sd: Pick<WebsiteData, 'template' | 'colorTheme'>, imageUrlMap: Record<string, string> | null | undefined): SiteLook {
  const template = sd.template === 'prime' || sd.template === 'euphoria' ? sd.template : 'luxe';
  const ct = typeof sd.colorTheme === 'string' && (sd.colorTheme.charAt(0) !== '#' || HEX.test(sd.colorTheme)) ? sd.colorTheme : undefined;
  let accent: string; let bg: string; let text: string;
  if (template === 'prime') {
    const t = resolvePrimeTheme(ct);
    accent = t?.brand ?? '#d4a64a'; bg = t?.bg ?? '#0a0a0a'; text = '#f0ece4';
  } else if (template === 'euphoria') {
    const t = resolveEuphoriaTheme(ct);
    accent = t?.brand ?? '#d4a64a'; bg = t?.bg ?? '#000000'; text = '#f0ece4';
  } else {
    const t = resolveAibTheme({ colorTheme: ct } as WebsiteData);
    accent = t.accent; bg = rgbToHex(t.bgRgb); text = rgbToHex(t.textRgb);
  }
  const norm = (c: string) => (/^#[0-9a-f]{3}$/i.test(c) ? '#' + c.slice(1).split('').map((x) => x + x).join('') : c).toLowerCase();
  const hero = imageUrlMap?.hero;
  return {
    template,
    accent: HEX.test(norm(accent)) ? norm(accent) : '#d4a64a',
    bg: HEX.test(norm(bg)) ? norm(bg) : '#0d0d0d',
    text: HEX.test(norm(text)) ? norm(text) : '#ffffff',
    heroUrl: typeof hero === 'string' && /^https:\/\/\S+$/i.test(hero) && hero.length <= 2048 ? hero : null,
  };
}

export interface SiteBaseDeps {
  /** The Vercel project's domains. Throws on an outage (the deployed URL is used then). */
  projectDomains(projectName: string): Promise<ProjectDomain[]>;
  updateShop(shopId: string, fields: { site_base_url: string; site_look: SiteLook }): Promise<void>;
}

/** After a deploy that included the pages: store the shop's public base and look. Returns the base, or null when none is usable. */
export async function refreshSiteBase(
  input: { shopId: string; projectName: string; deployedUrl: string; siteData: Pick<WebsiteData, 'template' | 'colorTheme'>; imageUrlMap?: Record<string, string> | null },
  deps: SiteBaseDeps,
): Promise<string | null> {
  let domains: ProjectDomain[] | null = null;
  try {
    domains = await deps.projectDomains(input.projectName);
  } catch (e: any) {
    console.warn(`[siteSubpages] ${input.projectName}: domain lookup failed, using the deployed URL:`, e?.message || e);
  }
  const base = pickPublicBase(domains, input.deployedUrl);
  if (!base) return null;
  await deps.updateShop(input.shopId, { site_base_url: base, site_look: siteLookOf(input.siteData, input.imageUrlMap) });
  return base;
}

// ---------------------------------------------------------------------------
// Live wiring (service role)
// ---------------------------------------------------------------------------

export interface SiteShop { id: string; slug: string }

let sb: SupabaseClient | undefined;
function db(): SupabaseClient {
  if (sb) return sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return (sb = createClient(url, key, { auth: { persistSession: false } }));
}

/**
 * The shop behind a site slug: the iOS purchase bound to it (ios_purchases.site_slug), then the
 * shop on that purchase (ab_shops.ios_otid). Null for a web (Stripe) site, an app site without
 * a shop, or a shop without a valid booking slug. Throws on a lookup error.
 */
export async function findShopForSite(siteSlug: string): Promise<SiteShop | null> {
  const { data: p, error } = await db().from('ios_purchases').select('original_transaction_id').eq('site_slug', siteSlug).maybeSingle();
  if (error) throw new Error(`ios_purchases lookup failed: ${error.message}`);
  if (!p?.original_transaction_id) return null;
  const { data: s, error: e2 } = await db().from('ab_shops').select('id, slug').eq('ios_otid', p.original_transaction_id).maybeSingle();
  if (e2) throw new Error(`ab_shops lookup failed: ${e2.message}`);
  if (!s?.id || !isShopSlug(s.slug)) return null;
  return { id: s.id, slug: s.slug };
}

export const liveSiteBaseDeps: SiteBaseDeps = {
  async projectDomains(projectName) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error('VERCEL_TOKEN is not set');
    const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectName)}/domains`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Vercel domains ${res.status}`);
    const body = (await res.json()) as { domains?: ProjectDomain[] };
    return Array.isArray(body?.domains) ? body.domains : [];
  },
  async updateShop(shopId, fields) {
    const { error } = await db().from('ab_shops').update(fields).eq('id', shopId);
    if (error) throw new Error(`ab_shops update failed: ${error.message}`);
  },
};
