import type { SiteRecord } from '@/lib/siteStore';

export type WebsiteView = {
  name: string;
  /** The live URL, or null before the first publish. */
  url: string | null;
  /** The URL without its scheme, for display. */
  host: string | null;
  /** Published and online: Open / Copy / Share. */
  live: boolean;
  /** Published, but the subscription has lapsed: taken offline, Resubscribe. */
  offline: boolean;
  status: 'Live' | 'Offline' | 'Not published yet';
};

/** What the Settings tab's "Your website" shows for the local site. */
export function websiteView(site: SiteRecord, lapsed = false): WebsiteView {
  const url = site.deployedUrl || null;
  const offline = url != null && lapsed;
  return {
    name: site.data.shopName || site.inputs.shopName || 'Your barbershop',
    url,
    host: url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
    live: url != null && !offline,
    offline,
    status: offline ? 'Offline' : url ? 'Live' : 'Not published yet',
  };
}

/** A URL's lower-cased host, or null for anything unparsable. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#:]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Whether the site /api/ios/site returned for a transaction is this local
 * site: the same slug when the phone knows it, otherwise (a site loaded from
 * the account) the same live host, or a slug equal to the host's first label
 * (`<slug>.vercel.app`) when the server has no URL.
 */
export function boundMatches(
  site: { slug: string | null; deployedUrl: string | null },
  bound: { siteId: string; deployedUrl: string | null },
): boolean {
  if (site.slug != null) return bound.siteId === site.slug;
  const host = hostOf(site.deployedUrl);
  if (!host) return false;
  const boundHost = hostOf(bound.deployedUrl);
  if (boundHost) return boundHost === host;
  return host.split('.')[0] === bound.siteId.toLowerCase();
}
