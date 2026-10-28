import type { WebsiteData } from '@/web/types';
import type { Service } from '@/lib/shop';
import { parsePriceCents, withMirroredServices } from '@/lib/setup/servicesMap';

/** Typical US sample prices (whole dollars) shown on starter services. Plain editable prices, never a flag in the data. */
export const SAMPLE_PRICES: Readonly<Record<string, number>> = {
  'haircut': 30,
  'beard trim': 20,
  'haircut & beard': 45,
};


const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*(&|\+|\band\b)\s*/g, ' & ');

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

/** True when any service still shows exactly its sample price. */
export function hasSamplePrices(services: { title: string; price?: string }[] | undefined): boolean {
  return !!services?.some((s) => isSamplePrice(s.title, s.price ?? ''));
}

/**
 * Publish shows the "Check your prices" alert: sample prices still on the site, services never reviewed. A booking-link
 * import is exempt (its prices are the real ones) unless the sample-price migration filled blanks on it (`samplePricesFilled`).
 */
export function needsPriceReminder(rec: { data: { services?: { title: string; price?: string }[] }; inputs: { pricesReviewed?: boolean; importedFrom?: string; samplePricesFilled?: boolean } }): boolean {
  return !rec.inputs.pricesReviewed && (rec.inputs.importedFrom !== 'booking' || !!rec.inputs.samplePricesFilled) && hasSamplePrices(rec.data.services);
}

export const PRICE_REMINDER = { title: 'Check your prices', body: 'Some services still show example prices. Make sure they match yours before customers see them.', button: 'Edit prices' };

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
 * Check-your-prices reminder on an import and keeps the sample prices out of the bookings shop (see buildSetupBody).
 * The same object when the site was already migrated.
 */
export function migrateSamplePrices<T extends { data: { services?: { title: string; price?: string }[] }; inputs: { samplePricesApplied?: boolean; samplePricesFilled?: boolean } }>(rec: T): T {
  if (rec.inputs.samplePricesApplied) return rec;
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
