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
