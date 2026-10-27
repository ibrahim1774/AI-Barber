// The shop logo as the renderers see it. Vendored into the app with the other render modules (imports only types).
// Whether a logo URL is allowed is decided on the server when a site is saved or published (lib/logoUrl.ts);
// here only the pixel size is checked, so a broken value falls back to the shop name instead of a broken image.
import type { WebsiteData } from '../../types';

/** Largest logo edge in pixels (the app trims to 600), and the widest/tallest shape accepted. */
export const MAX_LOGO_EDGE = 4000;
export const MAX_LOGO_ASPECT = 20;

/** w and h are whole numbers from 1 to MAX_LOGO_EDGE and not an absurd sliver. */
export function logoDimsOk(w: unknown, h: unknown): boolean {
  if (!Number.isInteger(w) || !Number.isInteger(h)) return false;
  const [a, b] = [w as number, h as number];
  if (a < 1 || b < 1 || a > MAX_LOGO_EDGE || b > MAX_LOGO_EDGE) return false;
  return a / b <= MAX_LOGO_ASPECT && b / a <= MAX_LOGO_ASPECT;
}

/** The logo's pixel size when the site has a usable one (its URL is in the image map as `logo`), else null: the name shows. */
export function renderableLogo(d: Pick<WebsiteData, 'logo'>): { w: number; h: number } | null {
  const l = d.logo as { url?: unknown; w?: unknown; h?: unknown } | undefined;
  if (!l || typeof l !== 'object' || typeof l.url !== 'string' || !l.url || !logoDimsOk(l.w, l.h)) return null;
  return { w: l.w as number, h: l.h as number };
}

export type HeaderMode = 'both' | 'logo' | 'name';

/** `site.headerShow` when it is one of the two literals, else undefined (so anything else is dropped on save and means both). */
export function cleanHeaderShow(v: unknown): 'logo' | 'name' | undefined {
  return v === 'logo' || v === 'name' ? v : undefined;
}

/** What the header prints: no usable logo = the name; headerShow 'logo' / 'name' pick one; anything else = logo and name together. */
export function headerBrand(d: Pick<WebsiteData, 'logo' | 'headerShow'>): { mode: HeaderMode; logo: { w: number; h: number } | null } {
  const logo = renderableLogo(d);
  if (!logo) return { mode: 'name', logo: null };
  const show = cleanHeaderShow(d.headerShow);
  return { mode: show ?? 'both', logo: show === 'name' ? null : logo };
}
