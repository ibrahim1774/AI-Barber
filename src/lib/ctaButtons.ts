/**
 * The call-to-action buttons of the site and what their link is. A tap on a button's text reaches the app as
 * `labels.<key>` (the preview bridge already whitelists those); the registry says which of them are buttons,
 * so the editor can open the button sheet (text AND link) instead of the plain text box.
 *
 * A button's link is never its own override: it edits the site-wide source the button reads (the Book choice,
 * the phone number, the address). See the book-button-target plan, Decision 2.
 */
export type CtaKind = 'book' | 'call' | 'directions' | 'shop' | 'inSite';

export const CTA_KINDS: Readonly<Record<string, CtaKind>> = {
  bookButton: 'book', primeNavBook: 'book', primeBookButton: 'book', primeBookOnlineLink: 'book',
  euNavBook: 'book', euBookButton: 'book', bookStripButton: 'book', pgBookCta: 'book', pgNavBook: 'book', teamBookWith: 'book',
  callNow: 'call', euCall: 'call', primePhoneLabel: 'call',
  pgDirectionsCta: 'directions',
  shopButton: 'shop', euShopButton: 'shop', primeShopLink: 'shop', pgShopCta: 'shop', shopStripLink: 'shop',
  navShop: 'shop', primeNavShop: 'shop', euNavShop: 'shop',
  primeViewServices: 'inSite', euViewServices: 'inSite', pgBackServices: 'inSite', pgBackTeam: 'inSite', pgViewProfile: 'inSite',
};

const PREFIX = 'labels.';

/** The button kind of a tap path (`labels.<key>`), or null for anything that is not a registered button. */
export function ctaKindOf(path: string): { kind: CtaKind; labelKey: string } | null {
  if (typeof path !== 'string' || !path.startsWith(PREFIX)) return null;
  const labelKey = path.slice(PREFIX.length);
  if (!Object.prototype.hasOwnProperty.call(CTA_KINDS, labelKey)) return null;
  return { kind: CTA_KINDS[labelKey], labelKey };
}

/** The design's main Book button label: where the All-fields "Booking link" row lands. */
export const MAIN_BOOK_KEY: Readonly<Record<string, string>> = { luxe: 'bookButton', prime: 'primeBookButton', euphoria: 'euBookButton' };

export type TapRoute = { sheet: 'button'; kind: CtaKind; labelKey: string } | { sheet: 'edit' };

/**
 * Where a tap (or a row of "All fields") goes: a registered button opens the button sheet (text and link),
 * the raw booking link row opens it in Book mode, everything else is the plain text box.
 */
export function routeTap(path: string, data: { template?: string }): TapRoute {
  if (path === 'bookingUrl') return { sheet: 'button', kind: 'book', labelKey: MAIN_BOOK_KEY[data.template ?? 'luxe'] ?? 'bookButton' };
  const c = ctaKindOf(path);
  return c ? { sheet: 'button', kind: c.kind, labelKey: c.labelKey } : { sheet: 'edit' };
}
