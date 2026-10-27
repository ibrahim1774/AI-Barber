import type { WebsiteData } from '@/web/types';

/**
 * Master switch for the logo feature, and the ONE place to flip it. While false, the Logo choice (Header sheet, Photos
 * Logo tile) is hidden and nothing is uploaded. Flip to true only after the server header-logo change is deployed
 * (get-upload-urls contentType/kind and the logo checks on publish) and src/web is re-synced to main
 * (`bash scripts/sync-web.sh`); an app that sends a logo to an older server fails the upload or gets a 400 on publish.
 */
export const LOGO_ENABLED = true;

/**
 * The "Logo + name / Logo only / Name only" choice. TEST BUILD: true. Published sites only honour `headerShow` once the
 * server branch (w-both) is merged and deployed and src/web is re-synced to main; keep this false in any build that
 * ships before the server merge (the choice is hidden, nothing new is written or sent, and the logo replaces the name
 * as before).
 */
export const LOGO_BOTH_ENABLED = true;

export type ShopLogo = NonNullable<WebsiteData['logo']>;

/** The data with this logo. The field exists only while a logo is set. */
export function withLogo(d: WebsiteData, logo: ShopLogo): WebsiteData {
  return { ...d, logo: { url: logo.url, w: logo.w, h: logo.h } };
}

/** The data without a logo: the field is removed (never null or empty), so the header shows the shop name again. headerShow goes with it. */
export function withoutLogo(d: WebsiteData): WebsiteData {
  if (!d.logo && !('headerShow' in d)) return d;
  const { logo: _gone, headerShow: _hs, ...rest } = d;
  return rest as WebsiteData;
}

export type HeaderShow = 'both' | 'logo' | 'name';

/** What the header shows: no logo means the name; otherwise the stored choice, and a missing one means both. */
export function headerShowOf(d: WebsiteData): HeaderShow {
  if (!d.logo) return 'name';
  return d.headerShow === 'logo' || d.headerShow === 'name' ? d.headerShow : 'both';
}

/** The data with this header choice. Both removes the field (the default; "both" is never written). The logo is never touched. */
export function withHeaderShow(d: WebsiteData, s: HeaderShow): WebsiteData {
  if (s === 'both') {
    if (!('headerShow' in d)) return d;
    const { headerShow: _gone, ...rest } = d;
    return rest as WebsiteData;
  }
  return { ...d, headerShow: s };
}

/**
 * The data as the preview shows it: the saved logo's URL swapped for the data URI of the image just uploaded (the
 * preview has it at once, and a data URI loads in the WebView). Only for the preview: never saved or published.
 */
export function withLogoPreview(d: WebsiteData, preview: { url: string; dataUri: string } | null): WebsiteData {
  if (!d.logo || !preview || preview.url !== d.logo.url) return d;
  return { ...d, logo: { ...d.logo, url: preview.dataUri } };
}

/** A PNG data URI the renderer may print into the page's logo image (nothing else starting with `data:` is). */
export function isLogoDataUri(s: string): boolean {
  return /^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(s);
}

/** The Sections row's summary: Add, or what the header shows now. */
export function logoSummary(d: WebsiteData): string {
  if (!d.logo) return 'Add';
  if (!LOGO_BOTH_ENABLED) return 'Change or remove';
  const m = headerShowOf(d);
  return m === 'logo' ? 'Logo only' : m === 'name' ? 'Name only' : 'Logo + name';
}
