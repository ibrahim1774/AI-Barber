import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  createCardCheckout, refundAppointment, expireCheckoutSession, stripeOnboard, stripeStatus, verifyStripeSignature,
  handleConnectEvent, CHECKOUT_HOLD_SEC, type WebhookDeps, type WebhookAppointment, type OwnerStripeDeps,
} from '../../lib/bookings/payments.js';

const shop = { id: 'shop-1', slug: 'fade-factory', name: 'Fade Factory', currency: 'usd', stripe_account_id: 'acct_123', platform_fee_bps: 200 };
const appt = { id: 'appt-1', service_name: 'Fade', price_cents: 3000, manage_token: 'tok_abc', customer_email: 'sam@example.com' };

type Call = { url: string; init: any; params: URLSearchParams };
function fakeFetch(...responses: Array<{ status?: number; body: any }>) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init, params: new URLSearchParams(init.body ?? url.split('?')[1] ?? '') });
    const r = responses.shift() ?? { body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
  return { f, calls };
}

const saved = { ...process.env };
beforeEach(() => {
  process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_connect';
  process.env.STRIPE_SECRET_KEY = 'sk_primehub_never_use';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { process.env = { ...saved }; vi.restoreAllMocks(); });

describe('createCardCheckout', () => {
  it('direct charge on the connected account with the platform fee, 30-min hold and manage return URLs', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' } });
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const r = await createCardCheckout(shop, appt, 3000, { fetch: f, now: () => now });
    expect(r).toEqual({ url: 'https://checkout.stripe.com/c/cs_1', sessionId: 'cs_1' });
    const c = calls[0];
    expect(c.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(c.init.method).toBe('POST');
    expect(c.init.headers.Authorization).toBe('Bearer sk_test_connect');
    expect(c.init.headers['Stripe-Account']).toBe('acct_123');
    expect(c.init.headers['Idempotency-Key']).toBe('ab-checkout-appt-1-3000');
    const p = c.params;
    expect(p.get('mode')).toBe('payment');
    expect(p.get('payment_intent_data[application_fee_amount]')).toBe('60');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('3000');
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('Fade');
    expect(Number(p.get('expires_at'))).toBe(now / 1000 + CHECKOUT_HOLD_SEC);
    expect(CHECKOUT_HOLD_SEC).toBeGreaterThanOrEqual(30 * 60);
    expect(CHECKOUT_HOLD_SEC).toBeLessThanOrEqual(32 * 60);
    expect(p.get('success_url')).toBe('https://www.aibarber.org/book/manage/tok_abc?checkout=success');
    expect(p.get('cancel_url')).toBe('https://www.aibarber.org/book/manage/tok_abc?checkout=cancelled');
    expect(p.get('client_reference_id')).toBe('appt-1');
    expect(p.get('metadata[appointment_id]')).toBe('appt-1');
    expect(p.get('payment_intent_data[metadata][shop_id]')).toBe('shop-1');
    expect(p.get('customer_email')).toBe('sam@example.com');
  });

  it('labels deposits and uses the fee of the deposit amount', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'cs_2', url: 'u' } });
    await createCardCheckout({ ...shop, platform_fee_bps: 150 }, appt, 1000, { fetch: f });
    expect(calls[0].params.get('line_items[0][price_data][product_data][name]')).toBe('Deposit: Fade');
    expect(calls[0].params.get('payment_intent_data[application_fee_amount]')).toBe('15');
  });

  it('omits a zero fee', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'cs_3', url: 'u' } });
    await createCardCheckout({ ...shop, platform_fee_bps: 0 }, appt, 3000, { fetch: f });
    expect(calls[0].params.has('payment_intent_data[application_fee_amount]')).toBe(false);
  });

  it('rejects: no connected account, below 50¢, Stripe errors, missing key', async () => {
    const { f } = fakeFetch({ status: 400, body: { error: { message: 'nope', code: 'x' } } });
    await expect(createCardCheckout({ ...shop, stripe_account_id: null }, appt, 3000, { fetch: f })).rejects.toThrow(/connected/);
    await expect(createCardCheckout(shop, appt, 49, { fetch: f })).rejects.toThrow(/minimum/);
    await expect(createCardCheckout(shop, appt, 3000, { fetch: f })).rejects.toThrow('nope');
    delete process.env.STRIPE_CONNECT_SECRET_KEY;
    await expect(createCardCheckout(shop, appt, 3000, { fetch: f })).rejects.toThrow(/STRIPE_CONNECT_SECRET_KEY/);
  });
});

describe('refundAppointment', () => {
  const paid = { ...appt, stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000, amount_refunded_cents: 0 };

  it('refunds on the connected account with refund_application_fee', async () => {
    const { f, calls } = fakeFetch({ body: { id: 're_1', amount: 3000, status: 'succeeded' } });
    expect(await refundAppointment(shop, paid, 3000, { fetch: f })).toEqual({ refundedCents: 3000 });
    const c = calls[0];
    expect(c.url).toBe('https://api.stripe.com/v1/refunds');
    expect(c.init.headers['Stripe-Account']).toBe('acct_123');
    expect(c.params.get('payment_intent')).toBe('pi_1');
    expect(c.params.get('amount')).toBe('3000');
    expect(c.params.get('refund_application_fee')).toBe('true');
    expect(c.init.headers['Idempotency-Key']).toBe('ab-refund-appt-1-0-3000');
  });

  it('clamps to what is still refundable', async () => {
    const { f, calls } = fakeFetch({ body: { id: 're_2', amount: 1000, status: 'pending' } });
    expect(await refundAppointment(shop, { ...paid, amount_refunded_cents: 2000 }, 3000, { fetch: f })).toEqual({ refundedCents: 1000 });
    expect(calls[0].params.get('amount')).toBe('1000');
  });

  it('returns 0 without calling Stripe when nothing is refundable', async () => {
    const { f } = fakeFetch();
    expect(await refundAppointment(shop, { ...paid, stripe_payment_intent_id: null }, 3000, { fetch: f })).toEqual({ refundedCents: 0 });
    expect(await refundAppointment(shop, paid, 0, { fetch: f })).toEqual({ refundedCents: 0 });
    expect(await refundAppointment(shop, { ...paid, amount_refunded_cents: 3000 }, 3000, { fetch: f })).toEqual({ refundedCents: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('throws on a failed refund', async () => {
    const { f } = fakeFetch({ body: { id: 're_3', amount: 3000, status: 'failed' } });
    await expect(refundAppointment(shop, paid, 3000, { fetch: f })).rejects.toThrow(/failed/);
  });
});

describe('expireCheckoutSession', () => {
  it('expires on the connected account; false (no throw) when Stripe refuses', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'cs_1', status: 'expired' } }, { status: 400, body: { error: { message: 'complete' } } });
    expect(await expireCheckoutSession(shop, 'cs_1', { fetch: f })).toBe(true);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1/expire');
    expect(calls[0].init.headers['Stripe-Account']).toBe('acct_123');
    expect(await expireCheckoutSession(shop, 'cs_1', { fetch: f })).toBe(false);
  });
});

describe('onboard / status', () => {
  const ownerShop = { ...shop, owner_id: 'user-1', phone: '+15551234567', stripe_account_id: null as string | null, stripe_charges_enabled: false };
  const mkDeps = (over: Partial<OwnerStripeDeps> = {}, fetchImpl?: any): OwnerStripeDeps => ({
    getUser: vi.fn(async (jwt: string) => (jwt === 'good' ? { id: 'user-1', email: 'owner@example.com' } : null)),
    shopForOwner: vi.fn(async () => ({ ...ownerShop })),
    saveAccountId: vi.fn(async (_s: string, id: string) => id),
    setChargesEnabled: vi.fn(async () => {}),
    stripe: { fetch: fetchImpl },
    ...over,
  });

  it('401 without a valid bearer; 404 without a shop', async () => {
    expect((await stripeOnboard(undefined, mkDeps())).status).toBe(401);
    expect((await stripeOnboard('Bearer bad', mkDeps())).status).toBe(401);
    expect(await stripeOnboard('Bearer good', mkDeps({ shopForOwner: vi.fn(async () => null) }))).toEqual({ status: 404, body: { error: 'no-shop' } });
  });

  it('creates a Standard account (prefilled), stores it, returns the account link', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'acct_new' } }, { body: { url: 'https://connect.stripe.com/setup/x' } });
    const deps = mkDeps({}, f);
    expect(await stripeOnboard('Bearer good', deps)).toEqual({ status: 200, body: { url: 'https://connect.stripe.com/setup/x' } });
    const acct = calls[0];
    expect(acct.url).toBe('https://api.stripe.com/v1/accounts');
    expect(acct.init.headers['Stripe-Account']).toBeUndefined();
    expect(acct.init.headers['Idempotency-Key']).toBe('ab-account-shop-1');
    expect(acct.params.get('type')).toBe('standard');
    expect(acct.params.get('email')).toBe('owner@example.com');
    expect(acct.params.get('business_profile[name]')).toBe('Fade Factory');
    expect(acct.params.get('business_profile[url]')).toBe('https://www.aibarber.org/book/fade-factory');
    expect(acct.params.get('business_profile[support_phone]')).toBe('+15551234567');
    expect(deps.saveAccountId).toHaveBeenCalledWith('shop-1', 'acct_new');
    const link = calls[1];
    expect(link.url).toBe('https://api.stripe.com/v1/account_links');
    expect(link.params.get('account')).toBe('acct_new');
    expect(link.params.get('type')).toBe('account_onboarding');
    expect(link.params.get('return_url')).toBe('https://www.aibarber.org/stripe-return?shop=shop-1&state=return');
    expect(link.params.get('refresh_url')).toBe('https://www.aibarber.org/stripe-return?shop=shop-1&state=refresh');
  });

  it('reuses the stored account (and the race winner)', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'acct_mine' } }, { body: { url: 'L' } });
    const deps = mkDeps({ saveAccountId: vi.fn(async () => 'acct_winner') }, f);
    await stripeOnboard('Bearer good', deps);
    expect(calls[1].params.get('account')).toBe('acct_winner');

    const g = fakeFetch({ body: { url: 'L2' } });
    const deps2 = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_old' })) }, g.f);
    expect(await stripeOnboard('Bearer good', deps2)).toEqual({ status: 200, body: { url: 'L2' } });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].params.get('account')).toBe('acct_old');
  });

  it('retries account creation once without a phone Stripe rejected', async () => {
    const { f, calls } = fakeFetch({ status: 400, body: { error: { message: 'Invalid phone', param: 'business_profile[support_phone]' } } }, { body: { id: 'acct_np' } }, { body: { url: 'L' } });
    expect(await stripeOnboard('Bearer good', mkDeps({}, f))).toEqual({ status: 200, body: { url: 'L' } });
    expect(calls[0].params.get('business_profile[support_phone]')).toBe('+15551234567');
    expect(calls[1].params.has('business_profile[support_phone]')).toBe(false);
    expect(calls[1].init.headers['Idempotency-Key']).toBe('ab-account-shop-1-nophone');
    expect(calls[2].params.get('account')).toBe('acct_np');
  });

  it('502 on Stripe errors', async () => {
    const { f } = fakeFetch({ status: 400, body: { error: { message: 'bad' } } });
    expect(await stripeOnboard('Bearer good', mkDeps({}, f))).toEqual({ status: 502, body: { error: 'stripe-error' } });
  });

  it('status: not connected without an account; refreshed + synced from Stripe', async () => {
    expect(await stripeStatus('Bearer good', mkDeps())).toEqual({ status: 200, body: { connected: false, chargesEnabled: false, detailsSubmitted: false } });
    const { f, calls } = fakeFetch({ body: { id: 'acct_1', charges_enabled: true, details_submitted: true } });
    const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_1' })) }, f);
    expect(await stripeStatus('Bearer good', deps)).toEqual({ status: 200, body: { connected: true, chargesEnabled: true, detailsSubmitted: true } });
    expect(calls[0].url).toBe('https://api.stripe.com/v1/accounts/acct_1');
    expect(calls[0].init.method).toBe('GET');
    expect(deps.setChargesEnabled).toHaveBeenCalledWith('shop-1', true);
  });

  it('status: revoked access reads as disconnected', async () => {
    const { f } = fakeFetch({ status: 403, body: { error: { type: 'invalid_request_error', message: 'no access' } } });
    const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_1', stripe_charges_enabled: true })) }, f);
    expect(await stripeStatus('Bearer good', deps)).toEqual({ status: 200, body: { connected: false, chargesEnabled: false, detailsSubmitted: false } });
    expect(deps.setChargesEnabled).toHaveBeenCalledWith('shop-1', false);
  });
});

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';
  const sign = (t: number, b = body, s = secret) => crypto.createHmac('sha256', s).update(`${t}.${b}`).digest('hex');
  const now = 1_800_000_000;

  it('accepts a valid signature (any of several v1s)', () => {
    expect(verifyStripeSignature(Buffer.from(body), `t=${now},v1=${sign(now)}`, secret, 300, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,v1=${sign(now)}`, secret, 300, now)).toBe(true);
  });
  it('rejects tampering, wrong secret, stale/future timestamps and junk headers', () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', `t=${now},v1=${sign(now)}`, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now},v1=${sign(now, body, 'other')}`, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now - 301},v1=${sign(now - 301)}`, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now + 301},v1=${sign(now + 301)}`, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now - 300},v1=${sign(now - 300)}`, secret, 300, now)).toBe(true);
    expect(verifyStripeSignature(body, undefined, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, `v1=${sign(now)}`, secret, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${now}`, secret, 300, now)).toBe(false);
  });
});

describe('handleConnectEvent', () => {
  const base: WebhookAppointment = {
    ...appt, shop_id: 'shop-1', status: 'booked', payment_status: 'awaiting', payment_method: 'card',
    stripe_checkout_session_id: 'cs_1', stripe_payment_intent_id: null, amount_paid_cents: 0, amount_refunded_cents: 0,
  };
  function mkDeps(a: WebhookAppointment | null = base, over: Partial<WebhookDeps> = {}) {
    const seen = new Set<string>();
    const deps: WebhookDeps = {
      claimEvent: vi.fn(async (id: string) => (seen.has(id) ? false : (seen.add(id), true))),
      releaseEvent: vi.fn(async (id: string) => { seen.delete(id); }),
      appointmentBySession: vi.fn(async (sid: string) => (a && a.stripe_checkout_session_id === sid ? a : null)),
      appointmentByPaymentIntent: vi.fn(async (pi: string) => (a && a.stripe_payment_intent_id === pi ? a : null)),
      appointmentById: vi.fn(async (id: string) => (a && a.id === id ? a : null)),
      shop: vi.fn(async () => shop),
      markPaid: vi.fn(async () => true),
      expireHold: vi.fn(async () => true),
      setRefunded: vi.fn(async () => {}),
      setChargesEnabledForAccount: vi.fn(async () => {}),
      refund: vi.fn(async (_s, _a, amt: number) => ({ refundedCents: amt })),
      notify: vi.fn(async () => {}),
      now: () => Date.UTC(2026, 9, 21, 12),
      ...over,
    };
    return deps;
  }
  const completed = (over: any = {}, account: string | null = 'acct_123') => ({
    id: 'evt_1', type: 'checkout.session.completed', account,
    data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 3000, payment_intent: 'pi_1', ...over } },
  });

  it('completed → paid, records the PI, sends the confirmation; duplicates are no-ops', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent(completed(), deps)).toBe('paid:paid');
    expect(deps.markPaid).toHaveBeenCalledWith('appt-1', { paymentStatus: 'paid', amountPaidCents: 3000, paymentIntentId: 'pi_1' });
    expect(deps.notify).toHaveBeenCalledWith({ kind: 'booking_created', appointmentId: 'appt-1' });
    expect(await handleConnectEvent(completed(), deps)).toBe('duplicate');
    expect(deps.markPaid).toHaveBeenCalledTimes(1);
  });

  it('completed with less than the price → deposit; null price → deposit', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent(completed({ amount_total: 1000 }), deps)).toBe('paid:deposit');
    const deps2 = mkDeps({ ...base, price_cents: null });
    expect(await handleConnectEvent(completed(), deps2)).toBe('paid:deposit');
  });

  it('completed but already recorded (different event id) → no second confirmation', async () => {
    const deps = mkDeps(base, { markPaid: vi.fn(async () => false) });
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:already-recorded');
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('ignores events from another connected account, unpaid sessions and unknown sessions', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent(completed({}, 'acct_evil'), deps)).toBe('ignored:no-appointment');
    expect(await handleConnectEvent({ ...completed(), id: 'evt_2', account: null }, deps)).toBe('ignored:no-appointment');
    expect(await handleConnectEvent({ ...completed({ payment_status: 'unpaid' }), id: 'evt_3' }, deps)).toBe('ignored:unpaid');
    expect(await handleConnectEvent({ ...completed({ id: 'cs_other' }), id: 'evt_4' }, deps)).toBe('ignored:no-appointment');
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it('paid after the booking was cancelled → automatic full refund, no confirmation', async () => {
    const deps = mkDeps({ ...base, status: 'cancelled', payment_status: 'none' });
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect(deps.refund).toHaveBeenCalledWith(shop, expect.objectContaining({ stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000 }), 3000);
    expect(deps.setRefunded).toHaveBeenCalledWith('appt-1', 3000, 'refunded');
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('a failed refund for paid-after-cancel is completed on the Stripe retry', async () => {
    let row: WebhookAppointment = { ...base, status: 'cancelled', payment_status: 'none' };
    const refund = vi.fn().mockRejectedValueOnce(new Error('stripe 500')).mockImplementation(async (_s, _a, amt: number) => ({ refundedCents: amt }));
    const deps = mkDeps(row, {
      refund,
      markPaid: vi.fn(async (_id, f) => {
        if (row.stripe_payment_intent_id) return false;
        row = { ...row, stripe_payment_intent_id: f.paymentIntentId, amount_paid_cents: f.amountPaidCents, payment_status: f.paymentStatus };
        return true;
      }),
      appointmentBySession: vi.fn(async () => row),
    });
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('stripe 500');
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect(refund).toHaveBeenCalledTimes(2);
    expect(refund.mock.calls[1][2]).toBe(3000);
    expect(deps.setRefunded).toHaveBeenCalledWith('appt-1', 3000, 'refunded');
    // once refunded, further deliveries are plain no-ops
    row = { ...row, amount_refunded_cents: 3000 };
    expect(await handleConnectEvent({ ...completed(), id: 'evt_9' }, deps)).toBe('noop:already-recorded');
  });

  it('falls back to client_reference_id when the session id was never stored (not for another session)', async () => {
    const appointmentId = '11111111-2222-4333-8444-555555555555';
    const row = { ...base, id: appointmentId, stripe_checkout_session_id: null };
    const deps = mkDeps(row);
    const ev = { id: 'evt_x2', type: 'checkout.session.expired', account: 'acct_123', data: { object: { id: 'cs_9', client_reference_id: appointmentId } } };
    expect(await handleConnectEvent(ev, deps)).toBe('cancelled:expired');
    const deps2 = mkDeps({ ...row, stripe_checkout_session_id: 'cs_other' });
    expect(await handleConnectEvent(ev, deps2)).toBe('ignored:no-appointment');
    const deps3 = mkDeps(row);
    expect(await handleConnectEvent({ ...ev, data: { object: { id: 'cs_9', client_reference_id: 'not-a-uuid' } } }, deps3)).toBe('ignored:no-appointment');
    expect(deps3.appointmentById).not.toHaveBeenCalled();
    expect(await handleConnectEvent({ ...ev, id: 'evt_x3', account: 'acct_evil' }, mkDeps(row))).toBe('ignored:no-appointment');
  });

  it('expired → frees the held slot', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent({ id: 'evt_x', type: 'checkout.session.expired', account: 'acct_123', data: { object: { id: 'cs_1' } } }, deps)).toBe('cancelled:expired');
    expect(deps.expireHold).toHaveBeenCalledWith('appt-1', '2026-10-21T12:00:00.000Z');
  });

  it('charge.refunded → cumulative amount and status', async () => {
    const a = { ...base, payment_status: 'paid', stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000 };
    const deps = mkDeps(a);
    const ev = (amt: number, id: string) => ({ id, type: 'charge.refunded', account: 'acct_123', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: amt, amount_captured: 3000 } } });
    expect(await handleConnectEvent(ev(1000, 'e1'), deps)).toBe('refund:recorded');
    expect(deps.setRefunded).toHaveBeenLastCalledWith('appt-1', 1000, 'partially_refunded');
    await handleConnectEvent(ev(3000, 'e2'), deps);
    expect(deps.setRefunded).toHaveBeenLastCalledWith('appt-1', 3000, 'refunded');
  });

  it('account.updated → stripe_charges_enabled; deauthorized → false', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent({ id: 'a1', type: 'account.updated', account: 'acct_123', data: { object: { id: 'acct_123', charges_enabled: true } } }, deps)).toBe('account:enabled');
    expect(deps.setChargesEnabledForAccount).toHaveBeenCalledWith('acct_123', true);
    await handleConnectEvent({ id: 'a2', type: 'account.application.deauthorized', account: 'acct_123', data: { object: {} } }, deps);
    expect(deps.setChargesEnabledForAccount).toHaveBeenLastCalledWith('acct_123', false);
  });

  it('unknown events are acknowledged', async () => {
    expect(await handleConnectEvent({ id: 'u1', type: 'payout.paid', account: 'acct_123', data: { object: {} } }, mkDeps())).toBe('ignored:payout.paid');
  });

  it('a processing failure releases the claim so the Stripe retry is processed', async () => {
    const markPaid = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(true);
    const deps = mkDeps(base, { markPaid });
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('db down');
    expect(deps.releaseEvent).toHaveBeenCalledWith('evt_1');
    expect(await handleConnectEvent(completed(), deps)).toBe('paid:paid');
  });
});
