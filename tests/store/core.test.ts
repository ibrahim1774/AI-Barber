import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  parseCart,
  parseUsAddress,
  priceCart,
  publicProductView,
  shippingEnabled,
  statusUrl,
  storeOpen,
} from '../../lib/store/core.js';
import { makeProduct, storeWorld } from './fakeRepo.js';

const A = '0b6f7a3e-1111-4111-8111-000000000001';
const B = '0b6f7a3e-1111-4111-8111-000000000002';

describe('parseCart', () => {
  it('merges lines with the same productId', () => {
    expect(parseCart([{ productId: A, quantity: 1 }, { productId: B, quantity: 1 }, { productId: A, quantity: 2 }]))
      .toEqual([{ productId: A, quantity: 3 }, { productId: B, quantity: 1 }]);
  });

  it('rejects quantities 0, 11 and 1.5, a merged total over 10, and non-numbers', () => {
    for (const q of [0, 11, 1.5, -1, '2', null, NaN]) expect(parseCart([{ productId: A, quantity: q }]), String(q)).toBeNull();
    expect(parseCart([{ productId: A, quantity: 6 }, { productId: A, quantity: 5 }])).toBeNull();
  });

  it('rejects 0 lines, 21 lines, a non-array and a non-uuid id', () => {
    expect(parseCart([])).toBeNull();
    expect(parseCart(Array.from({ length: 21 }, () => ({ productId: randomUUID(), quantity: 1 })))).toBeNull();
    expect(parseCart(Array.from({ length: 20 }, () => ({ productId: randomUUID(), quantity: 1 })))).toHaveLength(20);
    expect(parseCart({ productId: A, quantity: 1 })).toBeNull();
    expect(parseCart(undefined)).toBeNull();
    expect(parseCart([{ productId: 'oil', quantity: 1 }])).toBeNull();
    expect(parseCart(['x'])).toBeNull();
  });
});

describe('priceCart', () => {
  const w = storeWorld();
  const { ids } = w;
  const shop = w.shop();
  const products = w.state.products;

  it('snapshots name, price and the https cover, and totals the cart', () => {
    const r = priceCart(shop, products, [{ productId: ids.oil, quantity: 2 }, { productId: ids.balm, quantity: 1 }], 'pickup');
    expect(r).toEqual({
      lines: [
        { product_id: ids.oil, name: 'Beard oil', unit_price_cents: 1500, quantity: 2, photo_url: 'https://img/oil-1.jpg' },
        { product_id: ids.balm, name: 'Balm', unit_price_cents: 2000, quantity: 1, photo_url: null },
      ],
      subtotal: 5000, shipping: 0, total: 5000,
    });
  });

  it('adds the flat rate only for shipping', () => {
    const r = priceCart(shop, products, [{ productId: ids.oil, quantity: 1 }], 'shipping');
    expect(r).toMatchObject({ subtotal: 1500, shipping: 500, total: 2000 });
    expect(priceCart({ ...shop, shipping_flat_cents: null }, products, [{ productId: ids.oil, quantity: 1 }], 'shipping'))
      .toMatchObject({ shipping: 0, total: 1500 });
  });

  it('{ soldOut: [ids] } when any line is sold out', () => {
    expect(priceCart(shop, products, [{ productId: ids.oil, quantity: 1 }, { productId: ids.pomade, quantity: 1 }], 'pickup'))
      .toEqual({ soldOut: [ids.pomade] });
  });

  it('invalid for an inactive, foreign or unknown product, and for one under 50 cents', () => {
    expect(priceCart(shop, products, [{ productId: ids.comb, quantity: 1 }], 'pickup')).toEqual({ invalid: 'items' });
    expect(priceCart(shop, products, [{ productId: ids.foreign, quantity: 1 }], 'pickup')).toEqual({ invalid: 'items' });
    expect(priceCart(shop, products, [{ productId: randomUUID(), quantity: 1 }], 'pickup')).toEqual({ invalid: 'items' });
    const cheap = makeProduct({ id: randomUUID(), shop_id: shop.id, price_cents: 49 });
    expect(priceCart(shop, [...products, cheap], [{ productId: cheap.id, quantity: 2 }], 'pickup')).toEqual({ invalid: 'items' });
    // invalid wins over sold out
    expect(priceCart(shop, products, [{ productId: ids.pomade, quantity: 1 }, { productId: ids.comb, quantity: 1 }], 'pickup'))
      .toEqual({ invalid: 'items' });
  });
});

describe('parseUsAddress', () => {
  const base = { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'tx', postalCode: '78701' };

  it('accepts 12345 and 12345-6789 and stores the db shape', () => {
    expect(parseUsAddress(base)).toEqual({
      name: 'Sam Lee', line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US',
    });
    expect(parseUsAddress({ ...base, postalCode: '78701-1234', line2: 'Apt 2' })).toMatchObject({ postal_code: '78701-1234', line2: 'Apt 2' });
  });

  it('rejects a 3-letter state, an empty line1, a bad zip and fields over 100 characters', () => {
    expect(parseUsAddress({ ...base, state: 'TEX' })).toBeNull();
    expect(parseUsAddress({ ...base, state: 'T1' })).toBeNull();
    expect(parseUsAddress({ ...base, line1: '' })).toBeNull();
    expect(parseUsAddress({ ...base, line1: '   ' })).toBeNull();
    expect(parseUsAddress({ ...base, postalCode: '1234' })).toBeNull();
    expect(parseUsAddress({ ...base, postalCode: '12345-67' })).toBeNull();
    for (const k of ['name', 'line1', 'line2', 'city'] as const) expect(parseUsAddress({ ...base, [k]: 'x'.repeat(101) }), k).toBeNull();
    expect(parseUsAddress({ ...base, city: 'x'.repeat(100) })).not.toBeNull();
    expect(parseUsAddress(null)).toBeNull();
    expect(parseUsAddress('1 Main St')).toBeNull();
  });
});

describe('storeOpen', () => {
  it('true for an enabled store with a live purchase', async () => {
    const w = storeWorld();
    expect(await storeOpen(w.deps.repo, w.shop())).toBe(true);
  });

  it('false when store_enabled is false or ios_otid is null', async () => {
    const w = storeWorld();
    expect(await storeOpen(w.deps.repo, { ...w.shop(), store_enabled: false })).toBe(false);
    expect(await storeOpen(w.deps.repo, { ...w.shop(), ios_otid: null })).toBe(false);
  });

  it('false when the purchase is missing, revoked or taken down', async () => {
    const w = storeWorld();
    expect(await storeOpen(w.deps.repo, { ...w.shop(), ios_otid: '999' })).toBe(false);
    const p = w.state.purchases[w.shop().ios_otid!];
    p.revoked_at = '2026-10-01T00:00:00Z';
    expect(await storeOpen(w.deps.repo, w.shop())).toBe(false);
    p.revoked_at = null;
    p.taken_down_at = '2026-10-01T00:00:00Z';
    expect(await storeOpen(w.deps.repo, w.shop())).toBe(false);
  });

  it('does not depend on bookings or a valid timezone', async () => {
    const w = storeWorld({ shop: { bookings_enabled: false, timezone: 'Nowhere/Land' } });
    expect(await storeOpen(w.deps.repo, w.shop())).toBe(true);
  });
});

describe('views and helpers', () => {
  it('publicProductView drops non-https photos, then caps at 5, cover first', () => {
    const p = makeProduct({
      id: A, shop_id: B, name: 'Oil', price_cents: 1500, description: 'Nice',
      photos: ['http://x/0', 'https://x/1', 'https://x/2', 'javascript:x', 'https://x/3', 'https://x/4', 'https://x/5', 'https://x/6'],
    });
    expect(publicProductView(p)).toEqual({
      id: A, name: 'Oil', priceCents: 1500, description: 'Nice',
      photos: ['https://x/1', 'https://x/2', 'https://x/3', 'https://x/4', 'https://x/5'], soldOut: false,
    });
  });

  it('statusUrl is /shop/manage/{token}', () => {
    expect(statusUrl('https://www.aibarber.org/', 'abc')).toBe('https://www.aibarber.org/shop/manage/abc');
  });

  it('shipping is enabled only with store_shipping and a flat rate', () => {
    const s = storeWorld().shop();
    expect(shippingEnabled(s)).toBe(true);
    expect(shippingEnabled({ ...s, store_shipping: false })).toBe(false);
    expect(shippingEnabled({ ...s, shipping_flat_cents: null })).toBe(false);
    expect(shippingEnabled({ ...s, shipping_flat_cents: 0 })).toBe(true);
  });
});
