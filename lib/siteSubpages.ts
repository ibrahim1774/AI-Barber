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
import { isAiBarberBookingLink, isAiBarberShopLink } from './ios/tiers.js';
import { isSiteBookLink, isSiteShopLink, SITE_CONFIG_PATH } from './render/subpages.js';
import { resolveAibTheme } from './render/luxe.js';
import { resolvePrimeTheme } from './render/prime.js';
import { resolveEuphoriaTheme } from './render/euphoria.js';
import { isMissingSiteColumn } from './siteColumns.js';

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
// Manage and order tokens: the ab_appointments / ab_orders manage_token alphabet (005), as an
// unnamed group (a named parameter unused in the destination is appended to the upstream
// query). The page reads the token from the browser's path.
const TOKEN = '([A-Za-z0-9_-]+)';
const BOOK_MANAGE = `/book/manage/${TOKEN}`;
const SHOP_MANAGE = `/shop/manage/${TOKEN}`;
/**
 * A file the /_ab build emits: `[name]-[hash].js|css`, one segment, no dots but the extension
 * (vite.subpages.config.ts names its output to match; tests/subpagesBuild.test.ts checks every
 * emitted file). Nothing else under /_ab/assets is proxied, so a miss is the barber site's 404.
 */
export const SUBPAGE_ASSET_FILE = '[A-Za-z0-9_-]+\\.(?:js|css)';
const ASSETS = `/_ab/assets/:file(${SUBPAGE_ASSET_FILE})`;
const ASSETS_DEST = '/_ab/assets/:file';

/** Every public endpoint src/book and src/shop call (src/book/api.ts, src/shop/api.ts). */
const PAGE_APIS = [
  '/api/book/shop', '/api/book/days', '/api/book/slots', '/api/book/appointments', '/api/book/manage', '/api/book/sent',
  '/api/store/shop', '/api/store/orders', '/api/store/order', '/api/store/sent',
] as const;
/** The ones the manage and order pages call. */
const MANAGE_APIS = ['/api/book/manage', '/api/book/sent', '/api/store/order', '/api/store/sent'] as const;

const to = (path: string): string => `${AIBARBER_ORIGIN}${path}`;
// Vercel matches sources strictly: the trailing-slash form is its own rule, to the same page.
const page = (source: string, dest: string): Rewrite[] => [
  { source, destination: to(dest) },
  { source: `${source}/`, destination: to(dest) },
];

/** The closed allow-list. The only place a barber site's proxy rules are made. */
export function subpageRewrites(sp: SiteSubpages): Rewrite[] {
  const assets = { source: ASSETS, destination: to(ASSETS_DEST) };
  if (sp.mode === 'full') {
    if (!isShopSlug(sp.shopSlug)) throw new Error(`invalid shop slug for site subpages: ${String(sp.shopSlug).slice(0, 80)}`);
    return [
      ...page('/book', BOOK_HTML), ...page(BOOK_MANAGE, BOOK_HTML),
      ...page('/shop', SHOP_HTML), ...page(SHOP_MANAGE, SHOP_HTML),
      assets,
      ...PAGE_APIS.map((p) => ({ source: p, destination: to(p) })),
    ];
  }
  if (sp.mode === 'manage-only') {
    return [
      ...page(BOOK_MANAGE, BOOK_HTML), ...page(SHOP_MANAGE, SHOP_HTML),
      assets,
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

/**
 * The vercel.json every site deploy ships. Without subpages and nested pages: exactly the config sites
 * always had. A multi-page deploy (`nestedPages`) adds the same revalidate header for `/<page>/` and
 * `/<page>/index.html` (any depth), so a republish shows at once on every page; nothing else changes
 * (no cleanUrls, no trailingSlash, no rewrite for the pages: Vercel serves `/about` and `/about/` from
 * `about/index.html`).
 */
export function siteVercelConfig(sp: SiteSubpages | null, opts: { nestedPages?: boolean } = {}): SiteVercelConfig {
  const headers: Header[] = [
    { source: '/index.html', headers: REVALIDATE },
    { source: '/', headers: REVALIDATE },
  ];
  if (opts.nestedPages) {
    headers.push({ source: '/(.*)/', headers: REVALIDATE }, { source: '/(.*)/index.html', headers: REVALIDATE });
  }
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
  return isAiBarberBookingLink(sd.bookingUrl) || isAiBarberShopLink(sd.shopUrl);
}

/**
 * The copy that gets rendered for a deploy (the stored copy is not changed):
 * - with the pages: an AI Barber booking link (either form) is `/book`, an AI Barber shop link
 *   (either form) is `/shop`;
 * - without them: a relative `/book` or `/shop` is dropped (it would be a dead button). Old
 *   absolute aibarber.org links stay (those pages still work).
 * - with the pages but `opts.bookingsOn === false` (the shop has switched bookings off): the
 *   site's own `/book` (either form) is dropped, so a deploy never ships a Book button that
 *   leads to the paused page. `undefined` (unknown / old callers) changes nothing.
 * Another booking site's link, and a barber's own store link, are never touched.
 */
export function withSubpageLinks<T extends Links>(sd: T, hasPages: boolean, opts?: { bookingsOn?: boolean }): T {
  const out = { ...sd };
  if (hasPages) {
    if (isAiBarberBookingLink(out.bookingUrl)) out.bookingUrl = '/book';
    if (isAiBarberShopLink(out.shopUrl)) out.shopUrl = '/shop';
    if (opts?.bookingsOn === false && isSiteBookLink(out.bookingUrl)) delete out.bookingUrl;
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

/**
 * The shop's public base, from the Vercel project's own domain list only:
 * - a custom domain that is verified, doesn't redirect elsewhere and whose DNS Vercel reports
 *   as correctly pointed (`serving`), shortest first;
 * - else the project's own *.vercel.app production domain from that list.
 * Never a constructed `{project}.vercel.app` (short names belong to strangers; see
 * lib/deploySite.ts) and never the deploy's fallback URL. Null when nothing qualifies.
 */
export function pickPublicBase(domains: ProjectDomain[] | null | undefined, serving: (name: string) => boolean): string | null {
  const usable = (domains || [])
    .filter((d) => d && typeof d.name === 'string' && d.verified === true && !d.redirect && HOSTNAME.test(d.name))
    .map((d) => d.name.toLowerCase())
    .sort((x, y) => x.length - y.length || x.localeCompare(y));
  const custom = usable.find((n) => !n.endsWith('.vercel.app') && serving(n));
  if (custom) return `https://${custom}`;
  const own = usable.find((n) => n.endsWith('.vercel.app'));
  return own ? `https://${own}` : null;
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
  /** The Vercel project's domains. Throws on an outage (the stored base is then kept). */
  projectDomains(projectName: string): Promise<ProjectDomain[]>;
  /** Does Vercel report this custom domain's DNS as correctly pointed (config misconfigured === false)? Throws on an outage. */
  domainServing(name: string): Promise<boolean>;
  /** The stored public base (ab_shops.site_base_url), or null. Optional: absent means no canonical links. */
  readBase?(shopId: string): Promise<string | null>;
  /** A partial update: only the fields given are written. */
  updateShop(shopId: string, fields: { site_base_url?: string; site_look?: SiteLook }): Promise<void>;
}

/**
 * After a deploy that included the pages: store the shop's public base and look.
 * - A failed domains lookup, or any DNS check that errors, keeps the stored base (only the look is written).
 * - No site data (a web-editor deploy without it) leaves the stored look alone.
 * Returns the base written, or null when the base was left as it was.
 */
export async function refreshSiteBase(
  input: { shopId: string; projectName: string; siteData?: Pick<WebsiteData, 'template' | 'colorTheme'> | null; imageUrlMap?: Record<string, string> | null },
  deps: SiteBaseDeps,
): Promise<string | null> {
  const fields: { site_base_url?: string; site_look?: SiteLook } = {};
  if (input.siteData) fields.site_look = siteLookOf(input.siteData, input.imageUrlMap);
  const base = await resolvePublicBase(input.projectName, deps);
  if (base) fields.site_base_url = base;
  if (!fields.site_base_url && !fields.site_look) return null;
  await deps.updateShop(input.shopId, fields);
  return base;
}

/**
 * The project's public base right now (the same rules refreshSiteBase stores, without writing): a verified
 * custom domain whose DNS Vercel reports as pointed, else the project's own *.vercel.app. Null when it can't
 * be told: a failed domains lookup, a DNS check that errored (only a successful "not pointed" may demote a
 * custom domain), or no qualifying domain. Callers then keep the stored base, or go without.
 */
export async function resolvePublicBase(projectName: string, deps: Pick<SiteBaseDeps, 'projectDomains' | 'domainServing'>): Promise<string | null> {
  try {
    const domains = await deps.projectDomains(projectName);
    const serving = new Set<string>();
    let unsure = false;
    for (const d of domains || []) {
      const name = typeof d?.name === 'string' ? d.name.toLowerCase() : '';
      if (!name || name.endsWith('.vercel.app') || d.verified !== true || d.redirect) continue;
      try {
        if (await deps.domainServing(name)) serving.add(name);
      } catch (e: any) {
        unsure = true;
        console.warn(`[siteSubpages] ${projectName}: DNS check for ${name} failed; keeping the stored base:`, e?.message || e);
      }
    }
    return unsure ? null : pickPublicBase(domains, (n) => serving.has(n));
  } catch (e: any) {
    console.warn(`[siteSubpages] ${projectName}: domain lookup failed; keeping the stored base:`, e?.message || e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live wiring (service role)
// ---------------------------------------------------------------------------

export interface SiteShop { id: string; slug: string; /** ab_shops.bookings_enabled; absent when unknown. */ bookingsEnabled?: boolean }

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
  const { data: s, error: e2 } = await db().from('ab_shops').select('id, slug, bookings_enabled').eq('ios_otid', p.original_transaction_id).maybeSingle();
  if (e2) throw new Error(`ab_shops lookup failed: ${e2.message}`);
  if (!s?.id || !isShopSlug(s.slug)) return null;
  return { id: s.id, slug: s.slug, bookingsEnabled: s.bookings_enabled === true };
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
  async domainServing(name) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error('VERCEL_TOKEN is not set');
    const res = await fetch(`https://api.vercel.com/v6/domains/${encodeURIComponent(name)}/config`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Vercel domain config ${res.status}`);
    const body = (await res.json()) as { misconfigured?: boolean };
    return body?.misconfigured === false;
  },
  updateShop: (shopId, fields) => updateShopSite(db(), shopId, fields),
  readBase: (shopId) => readShopBase(db(), shopId),
};

/** ab_shops.site_base_url, or null when unset or before migration 011 (the column is missing). */
export async function readShopBase(client: SupabaseClient, shopId: string): Promise<string | null> {
  const { data, error } = await client.from('ab_shops').select('site_base_url').eq('id', shopId).maybeSingle();
  if (error) {
    if (isMissingSiteColumn(error)) return null;
    throw new Error(`ab_shops read failed: ${error.message}`);
  }
  const v = (data as { site_base_url?: unknown } | null)?.site_base_url;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Write the 011 columns. Before migration 011 is applied the columns don't exist: the write is
 * skipped (logged), so deploys never fail on it and the shop keeps today's aibarber.org URLs.
 */
export async function updateShopSite(client: SupabaseClient, shopId: string, fields: { site_base_url?: string; site_look?: SiteLook }): Promise<void> {
  const { error } = await client.from('ab_shops').update(fields).eq('id', shopId);
  if (!error) return;
  if (isMissingSiteColumn(error)) {
    console.warn(`[siteSubpages] ab_shops has no site columns yet (migration 011 not applied); skipping the site URL for ${shopId}`);
    return;
  }
  throw new Error(`ab_shops update failed: ${error.message}`);
}
