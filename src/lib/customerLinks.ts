import { useEffect, useState } from 'react';
import { SITE_BOOK_PATH, SITE_SHOP_PATH, isSiteSubpageLink } from '@/web/lib/render/subpages';
import { bookingUrl, type Shop } from '@/lib/shop';
import { shopUrl } from '@/lib/store/data';
import { loadSite, type SiteRecord } from '@/lib/siteStore';

/**
 * The address customers use for the booking page and the shop (share sheet, QR, copy link): the barber's
 * own site + /book or /shop once that site has the pages, never aibarber.org then.
 *
 * - The server's stored base (ab_shops.site_base_url, set after a deploy that included the pages).
 * - Else the local site's live address, when its last publish put /book or /shop on it (so the pages exist).
 * - Else (not published with the pages yet) the aibarber.org page, which keeps working for every shop.
 */
export function siteBase(
  shop: Pick<Shop, 'siteBaseUrl'> | null | undefined,
  site?: Pick<SiteRecord, 'deployedUrl' | 'liveLinks'> | null,
): string | null {
  if (shop?.siteBaseUrl) return shop.siteBaseUrl;
  const live = site?.liveLinks;
  const url = site?.deployedUrl?.trim();
  if (url && /^https:\/\//i.test(url) && live && (isSiteSubpageLink(live.bookingUrl) || isSiteSubpageLink(live.shopUrl))) {
    return url.replace(/\/+$/, '');
  }
  return null;
}

export function customerBookingUrl(
  shop: Pick<Shop, 'slug' | 'siteBaseUrl'>,
  site?: Pick<SiteRecord, 'deployedUrl' | 'liveLinks'> | null,
): string {
  const base = siteBase(shop, site);
  return base ? `${base}${SITE_BOOK_PATH}` : bookingUrl(shop);
}

export function customerShopUrl(
  shop: Pick<Shop, 'slug' | 'siteBaseUrl'>,
  site?: Pick<SiteRecord, 'deployedUrl' | 'liveLinks'> | null,
): string {
  const base = siteBase(shop, site);
  return base ? `${base}${SITE_SHOP_PATH}` : shopUrl(shop);
}

/** The local site record for siteBase's fallback, loaded once per screen. */
export function useSiteForLinks(): Pick<SiteRecord, 'deployedUrl' | 'liveLinks'> | null {
  const [site, setSite] = useState<SiteRecord | null>(null);
  useEffect(() => {
    let alive = true;
    loadSite().then((s) => alive && setSite(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return site;
}
