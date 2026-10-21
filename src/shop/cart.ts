import type { Cart, CartLine, Fulfilment, Product, StorageLike } from './types';

export const MAX_QTY = 10;
export const MAX_LINES = 20;
const key = (slug: string) => `ab-cart:${slug}`;
const clampQty = (n: number) => Math.max(0, Math.min(MAX_QTY, Math.floor(n)));

const isLine = (l: any): l is CartLine =>
  l && typeof l.productId === 'string' && typeof l.name === 'string' && Number.isFinite(l.priceCents)
  && Number.isFinite(l.quantity) && l.quantity > 0 && (l.photo == null || typeof l.photo === 'string');

/** Reads the cart for a shop. Any storage failure (Safari private mode) or bad data gives an empty cart. */
export function loadCart(slug: string, storage: StorageLike | undefined): Cart {
  try {
    const raw = storage?.getItem(key(slug));
    if (!raw) return { lines: [] };
    const parsed = JSON.parse(raw);
    const lines = Array.isArray(parsed?.lines) ? parsed.lines.filter(isLine) : [];
    return {
      lines: lines.slice(0, MAX_LINES).map((l: CartLine) => ({
        productId: l.productId, name: l.name, priceCents: l.priceCents, photo: l.photo ?? null, quantity: clampQty(l.quantity) || 1,
      })),
    };
  } catch {
    return { lines: [] };
  }
}

export function saveCart(slug: string, cart: Cart, storage: StorageLike | undefined): void {
  try {
    if (!storage) return;
    if (cart.lines.length === 0) storage.removeItem(key(slug));
    else storage.setItem(key(slug), JSON.stringify({ lines: cart.lines.map(({ soldOut, ...l }) => l) }));
  } catch { /* storage unavailable: the cart just won't persist */ }
}

export function addItem(cart: Cart, product: Pick<Product, 'id' | 'name' | 'priceCents' | 'photos'>, qty = 1): Cart {
  const n = Math.max(1, Math.floor(qty));
  const i = cart.lines.findIndex((l) => l.productId === product.id);
  if (i >= 0) {
    const lines = cart.lines.slice();
    lines[i] = { ...lines[i], quantity: clampQty(lines[i].quantity + n) };
    return { lines };
  }
  if (cart.lines.length >= MAX_LINES) return cart;
  return { lines: [...cart.lines, { productId: product.id, name: product.name, priceCents: product.priceCents, photo: product.photos[0] ?? null, quantity: clampQty(n) }] };
}

export function setQty(cart: Cart, productId: string, qty: number): Cart {
  const q = clampQty(qty);
  if (q === 0) return removeItem(cart, productId);
  return { lines: cart.lines.map((l) => (l.productId === productId ? { ...l, quantity: q } : l)) };
}

export function removeItem(cart: Cart, productId: string): Cart {
  return { lines: cart.lines.filter((l) => l.productId !== productId) };
}

/**
 * Lines against the fresh product list: unknown products are dropped, sold-out ones are flagged
 * (and kept, so the customer sees which to remove), and name/price/photo come from the server.
 */
export function reconcile(cart: Cart, products: Product[]): { cart: Cart; dropped: string[]; soldOut: string[] } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const dropped: string[] = [];
  const soldOut: string[] = [];
  const lines: CartLine[] = [];
  for (const l of cart.lines) {
    const p = byId.get(l.productId);
    if (!p) { dropped.push(l.productId); continue; }
    if (p.soldOut) soldOut.push(p.id);
    lines.push({ productId: p.id, name: p.name, priceCents: p.priceCents, photo: p.photos[0] ?? null, quantity: clampQty(l.quantity) || 1, soldOut: p.soldOut });
  }
  return { cart: { lines }, dropped, soldOut };
}

export type Totals = { subtotalCents: number; shippingCents: number; totalCents: number; count: number };

/** Same arithmetic as the server: subtotal from fresh product prices, flat shipping only for shipping. */
export function cartTotals(cart: Cart, products: Product[], fulfilment: Fulfilment, flatCents: number): Totals {
  const byId = new Map(products.map((p) => [p.id, p]));
  let subtotalCents = 0;
  let count = 0;
  for (const l of cart.lines) {
    const p = byId.get(l.productId);
    if (!p) continue;
    subtotalCents += p.priceCents * l.quantity;
    count += l.quantity;
  }
  const shippingCents = fulfilment === 'shipping' && count > 0 ? flatCents : 0;
  return { subtotalCents, shippingCents, totalCents: subtotalCents + shippingCents, count };
}
