import { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { SITE_BOOK_PATH, SITE_CONFIG_PATH, SITE_SHOP_PATH, isSiteSubpageLink } from '@/web/lib/render/subpages';
import { bookingUrl, type Shop } from '@/lib/shop';
import { onSiteAdopted, onSiteLive } from '@/lib/siteEvents';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { shopUrl } from '@/lib/store/data';

/**
 * The address customers use for the booking page and the shop (share sheet, QR, copy link): the barber's
 * own site + /book or /shop, but only where the server really shipped those pages; else the aibarber.org
 * page, which keeps working for every shop.
 *
 * 1. The server's stored base (ab_shops.site_base_url): written only after a deploy that had the pages.
 * 2. Else the local site's live address, when its last publish carried /book or /shop AND the site's
 *    /ab-site.json (shipped only with the pages) confirms it. What the app sent is not proof: the server
 *    drops the links and ships no pages when it finds no shop for the site.
 * 3. Else aibarber.org.
 */
export type CustomerLinks = { booking: string; shop: string };

type ShopLike = Pick<Shop, 'slug' | 'siteBaseUrl'>;
type SiteLike = Pick<SiteRecord, 'deployedUrl' | 'liveLinks'>;

/** From a known base (or none): base + /book, /shop; else the aibarber.org pages. */
export function linksFrom(shop: ShopLike, base: string | null): CustomerLinks {
  return base
    ? { booking: `${base}${SITE_BOOK_PATH}`, shop: `${base}${SITE_SHOP_PATH}` }
    : { booking: bookingUrl(shop), shop: shopUrl(shop) };
}

/** What can be said without the network: only the server's stored base. */
export function customerLinksNow(shop: ShopLike): CustomerLinks {
  return linksFrom(shop, shop.siteBaseUrl ?? null);
}

export const customerBookingUrl = (shop: ShopLike): string => customerLinksNow(shop).booking;
export const customerShopUrl = (shop: ShopLike): string => customerLinksNow(shop).shop;

export const PAGES_CHECK_TIMEOUT_MS = 3000;
/** A failed check is retried after this; a confirmed one holds for the session. */
export const PAGES_RECHECK_MS = 60_000;

const checks = new Map<string, { ok: boolean; at: number; p: Promise<boolean> }>();
/** Test only. */
export function resetPagesChecksForTests(): void {
  checks.clear();
}

/** True when `${base}/ab-site.json` answers with a shop slug: the deploy has the /book and /shop pages. */
export function sitePagesLive(base: string, now = Date.now()): Promise<boolean> {
  const hit = checks.get(base);
  if (hit && (hit.ok || now - hit.at < PAGES_RECHECK_MS)) return hit.p;
  const entry = { ok: false, at: now, p: Promise.resolve(false) };
  entry.p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PAGES_CHECK_TIMEOUT_MS);
    try {
      const resp = await fetch(`${base}${SITE_CONFIG_PATH}`, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
      if (!resp.ok) return false;
      const json: unknown = JSON.parse(await resp.text());
      const slug = json && typeof json === 'object' ? (json as { slug?: unknown }).slug : null;
      entry.ok = typeof slug === 'string' && slug.length > 0;
      return entry.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  checks.set(base, entry);
  return entry.p;
}

/** The base to use: the stored one, else the confirmed local live address, else null (aibarber.org). */
export async function verifiedSiteBase(shop: ShopLike | null | undefined, site: SiteLike | null | undefined): Promise<string | null> {
  if (shop?.siteBaseUrl) return shop.siteBaseUrl;
  const live = site?.liveLinks;
  const url = site?.deployedUrl?.trim().replace(/\/+$/, '');
  if (!url || !/^https:\/\//i.test(url) || !live || !(isSiteSubpageLink(live.bookingUrl) || isSiteSubpageLink(live.shopUrl))) return null;
  return (await sitePagesLive(url)) ? url : null;
}

export async function resolveCustomerLinks(shop: ShopLike, site: SiteLike | null | undefined): Promise<CustomerLinks> {
  return linksFrom(shop, await verifiedSiteBase(shop, site));
}

/**
 * The customer links for a screen: the no-network answer at once, then the verified one. Re-resolved when
 * the screen regains focus and after a publish (or an adopted copy) changed what is live.
 */
export function useCustomerLinks(shop: ShopLike | null): CustomerLinks | null {
  const navigation = useContext(NavigationContext);
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((x) => x + 1);
    const offs = [onSiteLive(bump), onSiteAdopted(bump)];
    if (navigation) offs.push(navigation.addListener('focus', bump));
    return () => offs.forEach((off) => off());
  }, [navigation]);

  const slug = shop?.slug;
  const base = shop?.siteBaseUrl ?? null;
  const [links, setLinks] = useState<CustomerLinks | null>(() => (shop ? customerLinksNow(shop) : null));
  useEffect(() => {
    if (!slug) {
      setLinks(null);
      return;
    }
    const s: ShopLike = { slug, siteBaseUrl: base };
    let alive = true;
    setLinks(customerLinksNow(s));
    loadSite()
      .catch(() => null)
      .then((site) => resolveCustomerLinks(s, site))
      .then((l) => alive && setLinks(l))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, base, n]);
  return links;
}
