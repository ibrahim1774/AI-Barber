import { describe, expect, it } from 'vitest';
import { formatAddress, newClientKey, parseShopRoute, shipsWithinLabel } from '../../src/shop/logic';

describe('parseShopRoute', () => {
  it('/shop/{slug} is the shop', () => {
    expect(parseShopRoute('/shop/fresh-cuts')).toEqual({ kind: 'shop', slug: 'fresh-cuts' });
    expect(parseShopRoute('/shop/fresh-cuts/')).toEqual({ kind: 'shop', slug: 'fresh-cuts' });
  });
  it('/shop/manage/{token} is an order', () => {
    expect(parseShopRoute('/shop/manage/abc123_-XYZ')).toEqual({ kind: 'order', token: 'abc123_-XYZ' });
  });
  it('/shop/ and /shop/manage are none', () => {
    expect(parseShopRoute('/shop/')).toEqual({ kind: 'none' });
    expect(parseShopRoute('/shop')).toEqual({ kind: 'none' });
    expect(parseShopRoute('/shop/manage')).toEqual({ kind: 'none' });
    expect(parseShopRoute('/shop/manage/')).toEqual({ kind: 'none' });
    expect(parseShopRoute('/book/x')).toEqual({ kind: 'none' });
  });
});

describe('newClientKey', () => {
  it('matches the contract pattern and is 32 chars', () => {
    const k = newClientKey();
    expect(k).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(k).toHaveLength(32);
  });
  it('differs between calls', () => {
    expect(newClientKey()).not.toBe(newClientKey());
  });
});

describe('formatAddress', () => {
  it('joins the parts and skips an empty line 2', () => {
    expect(formatAddress({ name: 'Sam Lee', line1: '1 Main St', line2: '', city: 'Austin', state: 'TX', postal_code: '78701' }))
      .toEqual(['Sam Lee', '1 Main St', 'Austin, TX 78701']);
    expect(formatAddress({ name: 'Sam Lee', line1: '1 Main St', line2: 'Apt 2', city: 'Austin', state: 'TX', postal_code: '78701' }))
      .toEqual(['Sam Lee', '1 Main St', 'Apt 2', 'Austin, TX 78701']);
  });
  it('accepts postalCode too', () => {
    expect(formatAddress({ line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701' })).toEqual(['1 Main St', 'Austin, TX 78701']);
  });
});

describe('shipsWithinLabel', () => {
  it('mirrors the Checkout wording: 0 or 1 is "1 day", 2+ is N days, unset is no line', () => {
    expect(shipsWithinLabel(0)).toBe('Ships within 1 day');
    expect(shipsWithinLabel(1)).toBe('Ships within 1 day');
    expect(shipsWithinLabel(3)).toBe('Ships within 3 days');
    expect(shipsWithinLabel(null)).toBeNull();
    expect(shipsWithinLabel(undefined)).toBeNull();
  });
});
