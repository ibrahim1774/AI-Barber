// Customer-facing URLs for bookings and orders (spec 2026-10-22-site-subpages).
//
// A shop whose site carries the /book and /shop pages has ab_shops.site_base_url (migration
// 011, set by lib/siteSubpages.ts after a deploy): its customers only ever see the barber's
// domain, in Stripe Checkout returns, manage and order links, emails and calendar files.
// Without it (null, or anything that isn't a plain https origin), today's aibarber.org URLs.
// Owner-facing links (Stripe Connect onboarding return, admin) never come from here.
// No imports: the bookings and store modules both use it.

export const AIBARBER_SITE = 'https://www.aibarber.org';

export interface SiteBased {
  slug?: string | null;
  site_base_url?: string | null;
}

const ORIGIN = /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}\/?$/i;

/** The shop's own site origin, or null. */
export function shopSiteBase(shop: SiteBased | null | undefined): string | null {
  const u = shop?.site_base_url;
  if (typeof u !== 'string' || !ORIGIN.test(u.trim())) return null;
  return u.trim().replace(/\/+$/, '').toLowerCase();
}

const clean = (origin: string) => origin.replace(/\/+$/, '');

/** Where this shop's customer pages live: its site, else `fallback` (aibarber.org). */
export function customerOrigin(shop: SiteBased | null | undefined, fallback: string = AIBARBER_SITE): string {
  return shopSiteBase(shop) ?? clean(fallback);
}

/** The booking manage page (Stripe returns, emails, calendar files). */
export function bookingManageUrl(shop: SiteBased | null | undefined, token: string, fallback?: string): string {
  return `${customerOrigin(shop, fallback)}/book/manage/${encodeURIComponent(token)}`;
}

/** The order status page (Stripe returns, emails). */
export function orderStatusUrl(shop: SiteBased | null | undefined, token: string, fallback?: string): string {
  return `${customerOrigin(shop, fallback)}/shop/manage/${encodeURIComponent(token)}`;
}

/** The booking page: `{site}/book`, else `{aibarber.org}/book/{slug}`; null without either. */
export function bookingPageUrl(shop: SiteBased | null | undefined, fallback?: string): string | null {
  const site = shopSiteBase(shop);
  if (site) return `${site}/book`;
  return shop?.slug ? `${clean(fallback ?? AIBARBER_SITE)}/book/${encodeURIComponent(shop.slug)}` : null;
}

/** The shop page: `{site}/shop`, else `{aibarber.org}/shop/{slug}`; null without either. */
export function shopPageUrl(shop: SiteBased | null | undefined, fallback?: string): string | null {
  const site = shopSiteBase(shop);
  if (site) return `${site}/shop`;
  return shop?.slug ? `${clean(fallback ?? AIBARBER_SITE)}/shop/${encodeURIComponent(shop.slug)}` : null;
}

export interface PublicSiteLook {
  template: 'luxe' | 'prime' | 'euphoria';
  accent: string | null;
  bg: string | null;
  text: string | null;
  heroUrl: string | null;
}

const hex = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return null;
};

/**
 * `site` on the public booking/store responses: where the shop's site is and how it looks, so
 * the /book and /shop pages link home and match it. Every value is re-checked (it is stored
 * JSON). Nulls when the shop has no site with the pages.
 */
export function publicSiteView(shop: SiteBased & { site_look?: unknown }): { baseUrl: string | null; look: PublicSiteLook | null } {
  const l = shop?.site_look;
  let look: PublicSiteLook | null = null;
  if (l && typeof l === 'object' && !Array.isArray(l)) {
    const o = l as Record<string, unknown>;
    look = {
      template: o.template === 'prime' || o.template === 'euphoria' ? o.template : 'luxe',
      accent: hex(o.accent),
      bg: hex(o.bg),
      text: hex(o.text),
      heroUrl: typeof o.heroUrl === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(o.heroUrl) && o.heroUrl.length <= 2048 ? o.heroUrl : null,
    };
  }
  return { baseUrl: shopSiteBase(shop), look };
}

/** `{ site }` to spread into a public response; empty when the shop has no site with the pages. */
export function siteField(shop: SiteBased & { site_look?: unknown }): { site?: ReturnType<typeof publicSiteView> } {
  const site = publicSiteView(shop);
  return site.baseUrl || site.look ? { site } : {};
}
