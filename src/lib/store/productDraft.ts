import type { Product } from '@/lib/store/data';

export const MAX_PHOTOS = 5;
export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 1000;
export const MAX_PRICE_CENTS = 1_000_000;
/** Stripe's card minimum. */
export const MIN_PRICE_CENTS = 50;

/** The product form's state: price and description are what the barber typed. */
export type ProductDraft = {
  name: string;
  price: string;
  description: string;
  photos: string[];
  soldOut: boolean;
};

export type DraftErrors = Partial<Record<'name' | 'price' | 'description' | 'photos', string>>;

export const emptyDraft = (): ProductDraft => ({ name: '', price: '', description: '', photos: [], soldOut: false });

/** "$12.50" / "12" / "1,000" to cents. null when it is not a plain non-negative amount. */
export function parsePrice(input: string): number | null {
  const t = input.trim().replace(/^\$/, '').trim();
  // Plain digits, or thousands groups of exactly three ("1,000"); never "1,2,3".
  if (!/^((\d+|\d{1,3}(,\d{3})+)(\.\d{0,2})?|\.\d{1,2})$/.test(t)) return null;
  return Math.round(parseFloat(t.replace(/,/g, '')) * 100);
}

/** 1250 -> "$12.50", 1200 -> "$12". */
export function formatPrice(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, '0')}`;
}

export function validateDraft(d: ProductDraft): DraftErrors {
  const e: DraftErrors = {};
  const name = d.name.trim();
  if (name.length < 1) e.name = 'Give your product a name.';
  else if (name.length > MAX_NAME) e.name = `Keep the name to ${MAX_NAME} characters.`;
  const cents = parsePrice(d.price);
  if (cents == null) e.price = 'Enter a price like 12 or 12.50.';
  else if (cents < MIN_PRICE_CENTS) e.price = `The lowest price is ${formatPrice(MIN_PRICE_CENTS)} (card payments need at least that).`;
  else if (cents > MAX_PRICE_CENTS) e.price = `The highest price is ${formatPrice(MAX_PRICE_CENTS)}.`;
  if (d.description.trim().length > MAX_DESCRIPTION) e.description = `Keep the description to ${MAX_DESCRIPTION} characters.`;
  if (d.photos.length > MAX_PHOTOS) e.photos = `Add up to ${MAX_PHOTOS} photos.`;
  return e;
}

/** A valid draft as the data layer's product fields (call validateDraft first). */
export function draftToProduct(d: ProductDraft): Omit<Product, 'id' | 'shopId' | 'sort'> {
  return {
    name: d.name.trim(),
    priceCents: parsePrice(d.price) ?? 0,
    description: d.description.trim(),
    photos: d.photos.slice(0, MAX_PHOTOS),
    soldOut: d.soldOut,
  };
}

export function productToDraft(p: Product): ProductDraft {
  const price = p.priceCents % 100 === 0 ? String(p.priceCents / 100) : (p.priceCents / 100).toFixed(2);
  return { name: p.name, price, description: p.description, photos: [...p.photos], soldOut: p.soldOut };
}
