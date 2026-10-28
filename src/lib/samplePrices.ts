import { parsePriceCents } from '@/lib/setup/servicesMap';

/** Typical US sample prices (whole dollars) shown on starter services. Plain editable prices, never a flag in the data. */
export const SAMPLE_PRICES: Readonly<Record<string, number>> = {
  'haircut': 30,
  'beard trim': 20,
  'haircut & beard': 45,
};

export const EXAMPLE_PRICE_NOTE = 'Example price. Change it to yours.';

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

/** Publish shows the "Check your prices" alert: sample prices still on the site, services never reviewed, not a booking-link import. */
export function needsPriceReminder(rec: { data: { services?: { title: string; price?: string }[] }; inputs: { pricesReviewed?: boolean; importedFrom?: string } }): boolean {
  return !rec.inputs.pricesReviewed && rec.inputs.importedFrom !== 'booking' && hasSamplePrices(rec.data.services);
}

export const PRICE_REMINDER = { title: 'Check your prices', body: 'Some services still show example prices. Make sure they match yours before customers see them.', button: 'Edit prices' };

/** Fills the sample price on standard-named services that have none; anything already priced is untouched. */
export function withSamplePrices<T extends { title: string; price?: string }>(list: T[] | undefined): T[] | undefined {
  return list?.map((s) => {
    const c = samplePriceCents(s.title);
    return c != null && !(s.price ?? '').trim() ? { ...s, price: `$${c / 100}` } : s;
  });
}
