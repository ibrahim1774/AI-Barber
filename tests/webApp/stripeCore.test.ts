import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { PRICES, isEntitledStatus, keyMode, priceIdFor, rowFromSubscription, tierForPriceId, verifyStripeSignature } from '../../lib/webApp/stripeCore';

const env = { STRIPE_WEBAPP_PRICE_WEBSITE_MONTH: 'p_wm', STRIPE_WEBAPP_PRICE_BOOKINGS_YEAR: 'p_by' };
const sign = (raw: string, secret: string, t: number) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const sub = (over: any = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, metadata: { app: 'aibarber-app', user_id: 'u1', site_slug: 'joes' }, items: { data: [{ price: { id: 'p_by' }, current_period_end: 1800000000 }] }, ...over });

describe('web app stripe core', () => {
  it('prices match the iOS app', () => {
    expect(PRICES).toEqual({ website: { month: 1999, year: 19199 }, bookings: { month: 2999, year: 28799 }, store: { month: 3999, year: 37999 } });
  });
  it('maps price ids both ways', () => {
    expect(priceIdFor('website', 'month', env)).toBe('p_wm');
    expect(priceIdFor('store', 'year', env)).toBeNull();
    expect(tierForPriceId('p_by', env)).toEqual({ tier: 'bookings', interval: 'year' });
    expect(tierForPriceId('other', env)).toBeNull();
  });
  it('verifies signatures, rejects tampering and stale timestamps', () => {
    const now = 1_700_000_000;
    expect(verifyStripeSignature('{"a":1}', sign('{"a":1}', 's', now), 's', now)).toBe(true);
    expect(verifyStripeSignature('{"a":2}', sign('{"a":1}', 's', now), 's', now)).toBe(false);
    expect(verifyStripeSignature('{"a":1}', sign('{"a":1}', 'x', now), 's', now)).toBe(false);
    expect(verifyStripeSignature('{"a":1}', sign('{"a":1}', 's', now - 1000), 's', now)).toBe(false);
    expect(verifyStripeSignature('{"a":1}', undefined, 's', now)).toBe(false);
  });
  it('builds a row only for our tagged subscriptions', () => {
    expect(rowFromSubscription(sub(), false, env)).toMatchObject({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: 'u1', site_slug: 'joes', tier: 'bookings', billing_interval: 'year', status: 'active', environment: 'test' });
    expect(rowFromSubscription(sub({ metadata: {} }), true, env)).toBeNull();
    expect(rowFromSubscription(sub({ metadata: { app: 'other' } }), true, env)).toBeNull();
    expect(rowFromSubscription(sub(), true, env, true)?.status).toBe('canceled');
    // unknown price: stored but not entitled, so access can still end
    const bad = rowFromSubscription(sub({ items: { data: [{ price: { id: 'nope', recurring: { interval: 'year' } } }] } }), true, env);
    expect(bad).toMatchObject({ status: 'invalid_price', billing_interval: 'year' });
    expect(isEntitledStatus(bad!.status)).toBe(false);
    expect(rowFromSubscription(sub(), true, env)?.environment).toBe('live');
  });
  it('reads the stripe mode from the key', () => {
    expect(keyMode('sk_live_x')).toBe('live');
    expect(keyMode('sk_test_x')).toBe('test');
    expect(keyMode('rk_test_x')).toBe('test');
    expect(keyMode(undefined)).toBeNull();
  });
  it('treats past_due as still entitled, canceled as not', () => {
    expect(['active', 'trialing', 'past_due'].every(isEntitledStatus)).toBe(true);
    expect(['canceled', 'unpaid', 'incomplete_expired'].some(isEntitledStatus)).toBe(false);
  });
});
