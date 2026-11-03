import { describe, expect, it } from 'vitest';
import { formatAddress, newClientKey, parseShopRoute, safeTrackingHref, shippedOnLabel, shipsWithinLabel } from '../../src/shop/logic';

describe('parseShopRoute', () => {
  it('/shop/{slug} is the shop', () => {
    expect(parseShopRoute('/shop/fresh-cuts')).toEqual({ kind: 'shop', slug: 'fresh-cuts' });
    expect(parseShopRoute('/shop/fresh-cuts/')).toEqual({ kind: 'shop', slug: 'fresh-cuts' });
  });
  it('/shop/manage/{token} is an order', () => {
    expect(parseShopRoute('/shop/manage/abc123_-XYZ')).toEqual({ kind: 'order', token: 'abc123_-XYZ' });
  });
  it('/shop and /shop/ are the barber site\'s own shop page (tests/site/site.test.ts); /shop/manage is none', () => {
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

describe('shippedOnLabel / safeTrackingHref (customer order page)', () => {
  it('formats the shipped date and tolerates a missing or bad one', () => {
    expect(shippedOnLabel('2026-11-02T23:30:00.000Z')).toBe('Nov 2, 2026');
    expect(shippedOnLabel(null)).toBe('');
    expect(shippedOnLabel(undefined)).toBe('');
    expect(shippedOnLabel('nope')).toBe('');
  });
  it('only an https link becomes the Track package button', () => {
    expect(safeTrackingHref('https://www.ups.com/track?tracknum=1Z')).toBe('https://www.ups.com/track?tracknum=1Z');
    expect(safeTrackingHref('http://x.example/1')).toBeNull();
    expect(safeTrackingHref('javascript:alert(1)')).toBeNull();
    expect(safeTrackingHref('')).toBeNull();
    expect(safeTrackingHref(null)).toBeNull();
  });
});
