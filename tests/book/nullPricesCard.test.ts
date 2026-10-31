// Regression: a shop with every price null and card payments enabled (real public
// /api/book/shop response for the ios-test-jacks-barbershop test shop). The booking page was
// reported as "Something went wrong"; the cause was a poisoned test browser, not the app, so
// this pins the behaviour that matters: such a shop still offers pay-in-shop, and card only
// when a charge of at least 50 cents exists.
import { describe, expect, it } from 'vitest';
import fx from './fixtures/shop-null-prices-card.json';
import { barberFromSearch, cardChargeCents, eligibleMembers, formatMoney, payOptions } from '../../src/book/logic';
import { siteTheme } from '../../src/site/site';

const d: any = fx;

describe('shop with null prices and card enabled', () => {
  it('fixture has the shape under test', () => {
    expect(d.shop.pay).toMatchObject({ inShop: true, card: true });
    expect(d.services.every((s: any) => s.priceCents === null && s.depositCents === 0)).toBe(true);
  });
  it('every service offers pay-in-shop and never card', () => {
    for (const s of d.services) expect(payOptions(d.shop.pay, s)).toEqual(['shop']);
  });
  it('before a service is picked, shop and card are both listed', () => {
    expect(payOptions(d.shop.pay, null)).toEqual(['shop', 'card']);
  });
  it('card is offered once a charge of 50 cents or more exists (price or deposit)', () => {
    expect(payOptions(d.shop.pay, { priceCents: 50, depositCents: 0 })).toEqual(['shop', 'card']);
    expect(payOptions(d.shop.pay, { priceCents: null, depositCents: 500 })).toEqual(['shop']); // a deposit needs a price
    expect(payOptions(d.shop.pay, { priceCents: 49, depositCents: 0 })).toEqual(['shop']);
    expect(cardChargeCents({ priceCents: null, depositCents: 0 })).toBe(0);
  });
  it('a card-only shop with an unpriced service offers nothing (page asks to call)', () => {
    expect(payOptions({ inShop: false, card: true, manual: {} }, d.services[0])).toEqual([]);
  });
  it('null prices format to nothing, members without team fields and site theme do not throw', () => {
    expect(formatMoney(d.services[0].priceCents)).toBe('');
    expect(eligibleMembers(d.members, d.services[0].id)).toHaveLength(1);
    expect(barberFromSearch('', d.members)).toBe('any');
    expect(siteTheme(d.site, d.shop.accent).vars['--accent']).toBe('#3b82f6');
  });
});
