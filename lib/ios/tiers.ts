// The one product → tier → entitlement map (spec §11). Mirrored in Superwall and
// RevenueCat; the server is authoritative. No imports on purpose: the bookings and
// store gates use it, and they must not pull in the App Store library.

export type Tier = 'website' | 'bookings' | 'store';
export type Entitlement = 'hosting' | 'bookings' | 'store';

const PREFIX = 'com.ibrahim1774.aibarber.';

const TIERS: readonly { prefix: string; tier: Tier; entitlements: readonly Entitlement[] }[] = [
  { prefix: `${PREFIX}hosting.`, tier: 'website', entitlements: ['hosting'] },
  { prefix: `${PREFIX}bookings.`, tier: 'bookings', entitlements: ['hosting', 'bookings'] },
  { prefix: `${PREFIX}store.`, tier: 'store', entitlements: ['hosting', 'bookings', 'store'] },
];

/** Every product the server accepts (all in subscription group 22497224). Anything else is bad-product. */
export const IOS_PRODUCT_IDS: readonly string[] = TIERS.flatMap((t) => [`${t.prefix}monthly`, `${t.prefix}yearly`]);

/**
 * The custom-domain subscription (spec 2026-10-22-custom-domains): its own subscription group,
 * entitlement `domain`. Deliberately NOT in IOS_PRODUCT_IDS and NOT a tier: it is accepted only
 * by the domain endpoints' verifier (lib/ios/domainFlow.ts), never by the site verifier, and
 * grants none of hosting / bookings / store.
 */
export const DOMAIN_PRODUCT_ID = `${PREFIX}domain.yearly`;

export function isDomainProduct(productId: string | null | undefined): boolean {
  return productId === DOMAIN_PRODUCT_ID;
}

function entry(productId: string | null | undefined) {
  if (typeof productId !== 'string') return undefined;
  return TIERS.find((t) => productId.startsWith(t.prefix));
}

export function tierOf(productId: string | null | undefined): Tier | null {
  return entry(productId)?.tier ?? null;
}

export function entitlementsOf(productId: string | null | undefined): Set<Entitlement> {
  return new Set(entry(productId)?.entitlements ?? []);
}

export function grants(productId: string | null | undefined, ent: Entitlement): boolean {
  return entitlementsOf(productId).has(ent);
}

// Scheme optional; `/book` followed by `/`, `?`, `#` or the end (never `/bookings`).
const AI_BARBER_BOOKING = /^(https?:\/\/)?(www\.)?aibarber\.org\/book(?=[/?#]|$)/i;

/** Host + path of the configured BOOKING_BASE_URL (a preview or staging origin), lower case. */
function configuredBase(): string | null {
  const raw = typeof process !== 'undefined' ? process.env.BOOKING_BASE_URL : undefined;
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase() || null;
}

// The site's own booking page (lib/render/subpages.ts): the relative `/book`, proxied to
// aibarber.org by the site's rewrites (lib/siteSubpages.ts). Kept in step with isSiteBookLink;
// no import so this module stays dependency-free.
const SITE_BOOKING = /^\/book(?=[?#]|$)/;

/** An AI Barber booking page link, old (aibarber.org/book/…) or new (/book). A Booksy or Square link is not one. */
export function isAiBarberBookingLink(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (AI_BARBER_BOOKING.test(u) || SITE_BOOKING.test(u)) return true;
  const base = configuredBase();
  if (!base) return false;
  const rest = u.replace(/^https?:\/\//i, '').toLowerCase();
  if (!rest.startsWith(`${base}/book`)) return false;
  const next = rest.charAt(base.length + 5);
  return next === '' || next === '/' || next === '?' || next === '#';
}

const AI_BARBER_SHOP = /^(https?:\/\/)?(www\.)?aibarber\.org\/shop(?=[/?#]|$)/i;
const SITE_SHOP = /^\/shop(?=[?#]|$)/;

/** An AI Barber shop page link, old (aibarber.org/shop/…, or the BOOKING_BASE_URL form) or new (/shop). A barber's own store is not one. */
export function isAiBarberShopLink(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (AI_BARBER_SHOP.test(u) || SITE_SHOP.test(u)) return true;
  const base = configuredBase();
  if (!base) return false;
  const rest = u.replace(/^https?:\/\//i, '').toLowerCase();
  if (!rest.startsWith(`${base}/shop`)) return false;
  const next = rest.charAt(base.length + 5);
  return next === '' || next === '/' || next === '?' || next === '#';
}

/**
 * A copy of the site data without the links the product doesn't cover: the AI Barber
 * `bookingUrl` without `bookings`, and `shopUrl` without `store`. Other booking links
 * (Booksy, Square) are never touched. The input is not mutated.
 */
export function stripLapsedLinks<T extends object>(siteData: T, productId: string | null | undefined): T {
  const out = { ...siteData } as T & { bookingUrl?: unknown; shopUrl?: unknown };
  if (isAiBarberBookingLink(out.bookingUrl) && !grants(productId, 'bookings')) delete out.bookingUrl;
  if ('shopUrl' in out && !grants(productId, 'store')) delete out.shopUrl;
  return out;
}
