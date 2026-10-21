import { describe, expect, it } from 'vitest';
import { addItem, cartTotals, loadCart, reconcile, removeItem, saveCart, setQty, MAX_LINES, MAX_QTY } from '../../src/shop/cart';
import type { Cart, Product, StorageLike } from '../../src/shop/types';

const P = (id: string, priceCents = 1000, extra: Partial<Product> = {}): Product => ({
  id, name: `Product ${id}`, priceCents, description: null, photos: [`https://x.test/${id}.jpg`], soldOut: false, ...extra,
});
const empty: Cart = { lines: [] };

describe('addItem', () => {
  it('merges lines for the same product', () => {
    const c = addItem(addItem(empty, P('a'), 1), P('a'), 2);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].quantity).toBe(3);
  });
  it('caps a line at 10', () => {
    let c = empty;
    for (let i = 0; i < 4; i++) c = addItem(c, P('a'), 4);
    expect(c.lines[0].quantity).toBe(MAX_QTY);
    expect(MAX_QTY).toBe(10);
  });
  it('caps the cart at 20 lines and ignores a 21st', () => {
    let c = empty;
    for (let i = 0; i < 25; i++) c = addItem(c, P(`p${i}`), 1);
    expect(c.lines).toHaveLength(MAX_LINES);
    expect(MAX_LINES).toBe(20);
    expect(c.lines.some((l) => l.productId === 'p20')).toBe(false);
    // An existing line can still grow when the cart is full.
    expect(addItem(c, P('p0'), 1).lines[0].quantity).toBe(2);
  });
  it('does not mutate its input', () => {
    const c = addItem(empty, P('a'), 1);
    addItem(c, P('a'), 1);
    expect(c.lines[0].quantity).toBe(1);
  });
});

describe('setQty / removeItem', () => {
  const c = addItem(addItem(empty, P('a'), 2), P('b'), 1);
  it('sets a quantity and clamps to 10', () => {
    expect(setQty(c, 'a', 5).lines[0].quantity).toBe(5);
    expect(setQty(c, 'a', 99).lines[0].quantity).toBe(10);
  });
  it('removes a line at 0', () => {
    expect(setQty(c, 'a', 0).lines.map((l) => l.productId)).toEqual(['b']);
  });
  it('removeItem drops the line', () => {
    expect(removeItem(c, 'b').lines.map((l) => l.productId)).toEqual(['a']);
  });
});

describe('reconcile', () => {
  const c = addItem(addItem(addItem(empty, P('a', 1000), 1), P('gone', 500), 1), P('b', 700), 2);
  it('drops a deleted product', () => {
    const r = reconcile(c, [P('a'), P('b')]);
    expect(r.cart.lines.map((l) => l.productId)).toEqual(['a', 'b']);
    expect(r.dropped).toEqual(['gone']);
  });
  it('flags a sold-out product and keeps the line', () => {
    const r = reconcile(c, [P('a'), P('gone'), P('b', 700, { soldOut: true })]);
    expect(r.soldOut).toEqual(['b']);
    expect(r.cart.lines.find((l) => l.productId === 'b')?.soldOut).toBe(true);
    expect(r.cart.lines.find((l) => l.productId === 'a')?.soldOut).toBe(false);
  });
  it('takes the server price, not the stored one', () => {
    const r = reconcile(c, [P('a', 1250), P('gone'), P('b', 700)]);
    expect(r.cart.lines.find((l) => l.productId === 'a')?.priceCents).toBe(1250);
  });
  it('clamps a stored quantity to 10', () => {
    const big: Cart = { lines: [{ productId: 'a', name: 'A', priceCents: 1, photo: null, quantity: 50 }] };
    expect(reconcile(big, [P('a')]).cart.lines[0].quantity).toBe(10);
  });
});

describe('cartTotals', () => {
  const c = addItem(addItem(empty, P('a', 1000), 2), P('b', 250), 1);
  const products = [P('a', 1000), P('b', 250)];
  it('shipping adds the flat rate', () => {
    expect(cartTotals(c, products, 'shipping', 599)).toEqual({ subtotalCents: 2250, shippingCents: 599, totalCents: 2849, count: 3 });
  });
  it('pickup does not', () => {
    expect(cartTotals(c, products, 'pickup', 599)).toEqual({ subtotalCents: 2250, shippingCents: 0, totalCents: 2250, count: 3 });
  });
  it('uses the product price, not the stored line price', () => {
    expect(cartTotals(c, [P('a', 2000), P('b', 250)], 'pickup', 0).subtotalCents).toBe(4250);
  });
  it('an empty cart has no shipping charge', () => {
    expect(cartTotals(empty, products, 'shipping', 599)).toEqual({ subtotalCents: 0, shippingCents: 0, totalCents: 0, count: 0 });
  });
});

describe('storage', () => {
  const mem = (): StorageLike & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
  };
  const throwing: StorageLike = {
    getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); },
  };
  it('round-trips under ab-cart:{slug}', () => {
    const s = mem();
    saveCart('fresh-cuts', addItem(empty, P('a'), 2), s);
    expect(Object.keys(s.data)).toEqual(['ab-cart:fresh-cuts']);
    expect(loadCart('fresh-cuts', s).lines[0].quantity).toBe(2);
    expect(loadCart('other', s).lines).toEqual([]);
  });
  it('an empty cart removes the key', () => {
    const s = mem();
    saveCart('x', addItem(empty, P('a'), 1), s);
    saveCart('x', empty, s);
    expect(s.data).toEqual({});
  });
  it('storage that throws gives an empty cart and no crash', () => {
    expect(loadCart('x', throwing).lines).toEqual([]);
    expect(() => saveCart('x', addItem(empty, P('a'), 1), throwing)).not.toThrow();
  });
  it('no storage at all is fine', () => {
    expect(loadCart('x', undefined).lines).toEqual([]);
    expect(() => saveCart('x', empty, undefined)).not.toThrow();
  });
  it('corrupt JSON or a wrong shape gives an empty cart', () => {
    const s = mem();
    s.data['ab-cart:x'] = '{nope';
    expect(loadCart('x', s).lines).toEqual([]);
    s.data['ab-cart:x'] = JSON.stringify({ lines: [{ productId: 5 }, { productId: 'a', name: 'A', priceCents: 1, photo: null, quantity: 2 }] });
    expect(loadCart('x', s).lines.map((l) => l.productId)).toEqual(['a']);
  });
});
