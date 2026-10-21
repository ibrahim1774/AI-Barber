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

const AI_BARBER_BOOKING = /^https?:\/\/(www\.)?aibarber\.org\/book\//i;

/** An AI Barber booking page link (a Booksy or Square link is not one). */
export function isAiBarberBookingLink(url: unknown): boolean {
  return typeof url === 'string' && AI_BARBER_BOOKING.test(url.trim());
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
