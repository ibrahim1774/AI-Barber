import type { WebsiteData } from '@/web/types';
import type { Service } from '@/lib/shop';
import { parsePriceCents, withMirroredServices } from '@/lib/setup/servicesMap';

/**
 * Typical US example prices (whole dollars) filled on a service that has no price: the one list every start option
 * and the once-per-site migration read. Plain editable values, never a flag in the data. Keys are the normalized
 * service name (lower case, "&" for and/+, no apostrophes or hyphens; see `norm`); a name not listed here stays blank.
 */
export const SAMPLE_PRICES: Readonly<Record<string, number>> = {
  'haircut': 30,
  'beard trim': 20,
  'haircut & beard': 45,
  'kids haircut': 25,
  'kids cut': 25,
  'boys haircut': 25,
  'boys cut': 25,
  'fade': 35,
  'skin fade': 35,
  'line up': 15,
  'lineup': 15,
  'edge up': 15,
  'beard line up': 15,
  'beard lineup': 15,
  'shave': 25,
  'hot towel shave': 30,
  'haircut & shave': 50,
  'eyebrows': 10,
  'senior cut': 25,
  'senior haircut': 25,
};

const norm = (name: string) =>
  name.trim().toLowerCase().replace(/['\u2019]/g, '').replace(/[-\u2013]/g, ' ').replace(/\s+/g, ' ').replace(/\s*(&|\+|\band\b)\s*/g, ' & ');

/** The sample price in cents for a service name, or null when it has none. */
export function samplePriceCents(name: string): number | null {
  const d = SAMPLE_PRICES[norm(name)];
  return d == null ? null : d * 100;
}

/** True when `price` (as typed, "$30" or "30") is exactly the sample price for `name`. */
export function isSamplePrice(name: string, price: string): boolean {
  const s = samplePriceCents(name);
  return s != null && parsePriceCents(price) === s;
}

/** Fills the sample price on standard-named services that have none; anything already priced is untouched. */
export function withSamplePrices<T extends { title: string; price?: string }>(list: T[] | undefined): T[] | undefined {
  return list?.map((s) => {
    const c = samplePriceCents(s.title);
    return c != null && !(s.price ?? '').trim() ? { ...s, price: `$${c / 100}` } : s;
  });
}

/**
 * Once per site (`inputs.samplePricesApplied`), whatever the start option (booking-link import, a site made before sample
 * prices existed): fills the sample price on standard-named services that have a blank price. Priced services (any text,
 * "0" and "Free" included) are kept. `samplePricesFilled` is set only when something was filled: it is what keeps the
 * shop-setup guard and mirror keep-rule on an import and keeps the sample prices out of the bookings shop (see buildSetupBody).
 * The same object when the site was already migrated or started from a Google listing (`importedFrom: 'gbp'`).
 */
export function migrateSamplePrices<T extends { data: { services?: { title: string; price?: string }[] }; inputs: { samplePricesApplied?: boolean; samplePricesFilled?: boolean; importedFrom?: string } }>(rec: T): T {
  if (rec.inputs.samplePricesApplied) return rec;
  // A Google-listing site never gets sample prices (blank stays blank); a flag from an earlier build is left as is.
  if (rec.inputs.importedFrom === 'gbp') return rec;
  const filled = withSamplePrices(rec.data.services);
  const changed = !!filled && filled.some((s, i) => s !== rec.data.services![i]);
  return {
    ...rec,
    data: changed ? { ...rec.data, services: filled } : rec.data,
    inputs: { ...rec.inputs, samplePricesApplied: true as const, ...(changed ? { samplePricesFilled: true as const } : {}) },
  };
}

/**
 * withMirroredServices for a site whose example prices were filled by the migration (`keep` = inputs.samplePricesFilled):
 * a mirrored service the shop has no price for keeps the site's price when that is still exactly its sample price.
 * The shop is never written. A price the shop has wins; a price that was changed on the site (or set in the shop
 * and then cleared: the site then holds that price, not the sample) is not brought back.
 */
export function mirrorServices(d: WebsiteData, list: Service[], keep?: boolean): WebsiteData {
  const next = withMirroredServices(d, list);
  if (!keep) return next;
  const norm2 = (t: string) => norm(t);
  const before = new Map((d.services ?? []).map((s) => [norm2(s.title), s.price ?? '']));
  return {
    ...next,
    services: next.services?.map((s) => {
      const was = before.get(norm2(s.title));
      return s.price == null && was != null && isSamplePrice(s.title, was) ? { ...s, price: was } : s;
    }),
  };
}
