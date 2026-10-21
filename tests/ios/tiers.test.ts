import { describe, it, expect } from 'vitest';
import {
  IOS_PRODUCT_IDS, tierOf, entitlementsOf, grants, isAiBarberBookingLink, stripLapsedLinks,
} from '../../lib/ios/tiers.js';
import { IOS_PRODUCT_IDS as VERIFY_IDS } from '../../lib/ios/appleVerify.js';

const P = 'com.ibrahim1774.aibarber.';

describe('product to tier map', () => {
  it('lists exactly the six products, re-exported by appleVerify', () => {
    expect([...IOS_PRODUCT_IDS].sort()).toEqual([
      `${P}bookings.monthly`, `${P}bookings.yearly`,
      `${P}hosting.monthly`, `${P}hosting.yearly`,
      `${P}store.monthly`, `${P}store.yearly`,
    ]);
    expect(VERIFY_IDS).toBe(IOS_PRODUCT_IDS);
  });

  it.each([
    ['hosting.monthly', 'website', ['hosting']],
    ['hosting.yearly', 'website', ['hosting']],
    ['bookings.monthly', 'bookings', ['hosting', 'bookings']],
    ['bookings.yearly', 'bookings', ['hosting', 'bookings']],
    ['store.monthly', 'store', ['hosting', 'bookings', 'store']],
    ['store.yearly', 'store', ['hosting', 'bookings', 'store']],
  ])('%s → %s', (suffix, tier, ents) => {
    expect(tierOf(P + suffix)).toBe(tier);
    expect([...entitlementsOf(P + suffix)].sort()).toEqual([...ents].sort());
  });

  it('an unknown or missing id has no tier and no entitlements', () => {
    for (const id of ['com.other.app.store.monthly', 'store.monthly', '', null, undefined]) {
      expect(tierOf(id as any)).toBeNull();
      expect(entitlementsOf(id as any).size).toBe(0);
    }
  });

  it('grants', () => {
    expect(grants(`${P}store.yearly`, 'bookings')).toBe(true);
    expect(grants(`${P}store.yearly`, 'store')).toBe(true);
    expect(grants(`${P}hosting.monthly`, 'bookings')).toBe(false);
    expect(grants(`${P}hosting.monthly`, 'hosting')).toBe(true);
    expect(grants(`${P}bookings.monthly`, 'store')).toBe(false);
    expect(grants(null, 'hosting')).toBe(false);
  });
});

describe('isAiBarberBookingLink', () => {
  it.each([
    ['https://www.aibarber.org/book/fresh-cuts', true],
    ['http://aibarber.org/book/x', true],
    ['HTTPS://WWW.AIBARBER.ORG/BOOK/x', true],
    ['  https://www.aibarber.org/book/x  ', true],
    ['https://www.aibarber.org/shop/x', false],
    ['https://booksy.com/en-us/123_fresh-cuts', false],
    ['https://evil.com/?u=https://www.aibarber.org/book/x', false],
    ['https://aibarber.org.evil.com/book/x', false],
    ['', false],
  ])('%s → %s', (url, want) => expect(isAiBarberBookingLink(url)).toBe(want));

  it('non-strings are not links', () => {
    expect(isAiBarberBookingLink(undefined)).toBe(false);
    expect(isAiBarberBookingLink(42 as any)).toBe(false);
  });
});

describe('stripLapsedLinks', () => {
  const AB = 'https://www.aibarber.org/book/x';
  const SHOP = 'https://www.aibarber.org/shop/x';
  const site = (over: Record<string, unknown> = {}) => ({ shopName: 'Fresh Cuts', bookingUrl: AB, shopUrl: SHOP, ...over });

  it('Website: removes the AI Barber booking link and the shop link', () => {
    const out = stripLapsedLinks(site(), `${P}hosting.monthly`);
    expect('bookingUrl' in out).toBe(false);
    expect('shopUrl' in out).toBe(false);
    expect(out.shopName).toBe('Fresh Cuts');
  });

  it('Bookings: keeps the booking link, removes the shop link', () => {
    const out = stripLapsedLinks(site(), `${P}bookings.yearly`);
    expect(out.bookingUrl).toBe(AB);
    expect('shopUrl' in out).toBe(false);
  });

  it('Store: keeps both', () => {
    const out = stripLapsedLinks(site(), `${P}store.monthly`);
    expect(out.bookingUrl).toBe(AB);
    expect(out.shopUrl).toBe(SHOP);
  });

  it('never removes a Booksy (or Square) link', () => {
    for (const url of ['https://booksy.com/en-us/1_fresh', 'https://squareup.com/appointments/book/abc']) {
      expect(stripLapsedLinks(site({ bookingUrl: url }), `${P}hosting.monthly`).bookingUrl).toBe(url);
    }
  });

  it('an unknown product strips both (fails closed)', () => {
    const out = stripLapsedLinks(site(), 'com.other');
    expect('bookingUrl' in out).toBe(false);
    expect('shopUrl' in out).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = site();
    const before = JSON.stringify(input);
    const out = stripLapsedLinks(input, `${P}hosting.monthly`);
    expect(JSON.stringify(input)).toBe(before);
    expect(out).not.toBe(input);
  });

  it('leaves a site without links unchanged', () => {
    expect(stripLapsedLinks({ shopName: 'A' }, `${P}hosting.monthly`)).toEqual({ shopName: 'A' });
  });
});
