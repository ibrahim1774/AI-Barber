import type { WebsiteData } from '@/web/types';

/**
 * Master switch for the logo feature, and the ONE place to flip it. While false, the Logo choice (Header sheet, Photos
 * Logo tile) is hidden and nothing is uploaded. Flip to true only after the server header-logo change is deployed
 * (get-upload-urls contentType/kind and the logo checks on publish) and src/web is re-synced to main
 * (`bash scripts/sync-web.sh`); an app that sends a logo to an older server fails the upload or gets a 400 on publish.
 */
export const LOGO_ENABLED = true;

export type ShopLogo = NonNullable<WebsiteData['logo']>;

/** The data with this logo. The field exists only while a logo is set. */
export function withLogo(d: WebsiteData, logo: ShopLogo): WebsiteData {
  return { ...d, logo: { url: logo.url, w: logo.w, h: logo.h } };
}

/** The data without a logo: the field is removed (never null or empty), so the header shows the shop name again. */
export function withoutLogo(d: WebsiteData): WebsiteData {
  if (!d.logo) return d;
  const { logo: _gone, ...rest } = d;
  return rest as WebsiteData;
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
