import type { SiteRecord } from '@/lib/siteStore';

export type WebsiteView = {
  name: string;
  /** The live URL, or null before the first publish. */
  url: string | null;
  /** The URL without its scheme, for display. */
  host: string | null;
  live: boolean;
  status: 'Live' | 'Not published yet';
};

/** What the Settings tab's "Your website" shows for the local site. */
export function websiteView(site: SiteRecord): WebsiteView {
  const url = site.deployedUrl || null;
  return {
    name: site.data.shopName || site.inputs.shopName || 'Your barbershop',
    url,
    host: url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
    live: url != null,
    status: url ? 'Live' : 'Not published yet',
  };
}
