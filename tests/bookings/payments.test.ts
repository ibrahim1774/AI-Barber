import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  liveWebhookDeps, refundKey, StripeApiError,
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
    expect(c.init.headers['Idempotency-Key']).toBe(`ab-checkout-appt-1-3000-${now / 1000}`);
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    const p = c.params;
    expect(p.get('mode')).toBe('payment');
    // Card only, through the 2026-09-30 allowlist (payment_method_types is rejected from that version).
    expect([...p.keys()].filter((k) => k.startsWith('payment_method_types'))).toEqual([]);
    expect(p.get('allowed_payment_method_types[0]')).toBe('card');
    expect(p.get('wallet_options[link][display]')).toBe('never');
    expect([...p.keys()].filter((k) => k.startsWith('allowed_payment_method_types'))).toEqual(['allowed_payment_method_types[0]']);
    expect(c.init.headers['Stripe-Version']).toBe('2026-09-30.endive');
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
    expect(c.init.headers['Idempotency-Key']).toBe('ab-refund-appt-1-pi_1-0-3000');
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
    audit: vi.fn(async () => {}),
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
    expect(acct.init.headers['Idempotency-Key']).toMatch(/^ab-account-shop-1-\d+-[0-9a-f]{16}$/);
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
    expect(calls[1].init.headers['Idempotency-Key']).toMatch(/^ab-account-shop-1-\d+-[0-9a-f]{16}$/);
    expect(calls[1].init.headers['Idempotency-Key']).not.toBe(calls[0].init.headers['Idempotency-Key']);
    expect(calls[2].params.get('account')).toBe('acct_np');
  });

  describe('account idempotency key time bucket', () => {
    const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
    const BUCKET = 10 * 60 * 1000;
    const keyOf = (c: Call) => c.init.headers['Idempotency-Key'] as string;

    it('same bucket -> same key (double-tap collapses)', async () => {
      const a = fakeFetch({ body: { id: 'acct_1' } }, { body: { url: 'L' } });
      const b = fakeFetch({ body: { id: 'acct_1' } }, { body: { url: 'L' } });
      await stripeOnboard('Bearer good', mkDeps({ stripe: { fetch: a.f, now: () => T0 } }));
      await stripeOnboard('Bearer good', mkDeps({ stripe: { fetch: b.f, now: () => T0 + BUCKET - 1 } }));
      expect(keyOf(a.calls[0])).toBe(keyOf(b.calls[0]));
    });

    it('next bucket -> new key', async () => {
      const a = fakeFetch({ body: { id: 'acct_1' } }, { body: { url: 'L' } });
      const b = fakeFetch({ body: { id: 'acct_1' } }, { body: { url: 'L' } });
      await stripeOnboard('Bearer good', mkDeps({ stripe: { fetch: a.f, now: () => T0 } }));
      await stripeOnboard('Bearer good', mkDeps({ stripe: { fetch: b.f, now: () => T0 + BUCKET } }));
      expect(keyOf(a.calls[0])).not.toBe(keyOf(b.calls[0]));
      expect(keyOf(a.calls[0])).toMatch(/^ab-account-shop-1-\d+-[0-9a-f]{16}$/);
    });

    it('stored account id short-circuits creation (no POST /accounts)', async () => {
      const { f, calls } = fakeFetch({ body: { url: 'L2' } });
      const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_old' })), stripe: { fetch: f, now: () => T0 } });
      await stripeOnboard('Bearer good', deps);
      expect(calls.every((c) => !c.url.endsWith('/v1/accounts'))).toBe(true);
      expect(deps.saveAccountId).not.toHaveBeenCalled();
    });

    it('a first-call 400 (no phone retry possible) then a later-bucket retry creates the account', async () => {
      const noPhone = { ...ownerShop, phone: null };
      const first = fakeFetch({ status: 400, body: { error: { message: 'This is a replay of a previous request', type: 'invalid_request_error' } } });
      const r1 = await stripeOnboard('Bearer good', mkDeps({ shopForOwner: vi.fn(async () => ({ ...noPhone })), stripe: { fetch: first.f, now: () => T0 } }));
      expect(r1.status).toBe(502);
      const second = fakeFetch({ body: { id: 'acct_ok' } }, { body: { url: 'L' } });
      const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...noPhone })), stripe: { fetch: second.f, now: () => T0 + BUCKET } });
      expect(await stripeOnboard('Bearer good', deps)).toEqual({ status: 200, body: { url: 'L' } });
      expect(keyOf(second.calls[0])).not.toBe(keyOf(first.calls[0]));
      expect(deps.saveAccountId).toHaveBeenCalledWith('shop-1', 'acct_ok');
    });
  });

  it('onboard: a 403/404 on the stored account → 409, logged + audited, nothing cleared or created', async () => {
    for (const status of [403, 404]) {
      const { f, calls } = fakeFetch({ status, body: { error: { type: 'permission_error', message: 'no access' } } });
      const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_real' })) }, f);
      const r = await stripeOnboard('Bearer good', deps);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ error: 'stripe-account-unavailable', message: expect.stringContaining('support') });
      expect(deps.audit).toHaveBeenCalledWith('shop-1', 'stripe_account_unavailable', { accountId: 'acct_real', status, code: null });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('unavailable'), expect.stringContaining('acct_real'));
      expect(deps.saveAccountId).not.toHaveBeenCalled();
      expect(deps.setChargesEnabled).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1); // no account creation, no key probing
      expect(Object.keys(deps)).not.toContain('clearAccount');
    }
  });

  it('onboard: other Stripe errors (500, 400, 429) → 502, nothing written', async () => {
    for (const status of [500, 400, 429]) {
      const { f } = fakeFetch({ status, body: { error: { message: 'x' } } });
      const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_real' })) }, f);
      expect((await stripeOnboard('Bearer good', deps)).status).toBe(502);
      expect(deps.audit).not.toHaveBeenCalled();
      expect(deps.saveAccountId).not.toHaveBeenCalled();
    }
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

  it('status: a 403/404 reports disconnected and never clears or changes anything', async () => {
    for (const status of [403, 404]) {
      const { f, calls } = fakeFetch({ status, body: { error: { type: 'invalid_request_error', message: 'no access' } } });
      const deps = mkDeps({ shopForOwner: vi.fn(async () => ({ ...ownerShop, stripe_account_id: 'acct_1', stripe_charges_enabled: true })) }, f);
      expect(await stripeStatus('Bearer good', deps)).toEqual({ status: 200, body: { connected: false, chargesEnabled: false, detailsSubmitted: false } });
      expect(deps.audit).not.toHaveBeenCalled();
      expect(deps.setChargesEnabled).not.toHaveBeenCalled();
      expect(deps.saveAccountId).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
    }
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
    cancelled_at: null, paid_at: null,
  };

  /** A stateful single-row model of ab_appointments with the live deps' conditional semantics. */
  function mkDeps(initial: WebhookAppointment | null = base, over: Partial<WebhookDeps> = {}) {
    const seen = new Set<string>();
    const claims = new Set<string>();
    const state = { row: initial ? { ...initial } : null as WebhookAppointment | null };
    const deps: WebhookDeps & { state: typeof state } = {
      state,
      eventProcessed: vi.fn(async (id: string) => seen.has(id)),
      recordEvent: vi.fn(async (id: string) => { seen.add(id); }),
      appointmentBySession: vi.fn(async (sid: string) => (state.row && state.row.stripe_checkout_session_id === sid ? { ...state.row } : null)),
      appointmentByPaymentIntent: vi.fn(async (pi: string) => (state.row && state.row.stripe_payment_intent_id === pi ? { ...state.row } : null)),
      appointmentById: vi.fn(async (id: string) => (state.row && state.row.id === id ? { ...state.row } : null)),
      shop: vi.fn(async () => shop),
      markPaid: vi.fn(async (_id: string, f) => {
        const r = state.row;
        if (!r || r.status === 'cancelled' || r.stripe_payment_intent_id) return false;
        state.row = { ...r, payment_status: f.paymentStatus, amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId, paid_at: 'T_PAID' };
        return true;
      }),
      recordPaidAfterCancel: vi.fn(async (_id: string, f) => {
        const r = state.row;
        if (!r || r.status !== 'cancelled' || r.paid_at || r.stripe_payment_intent_id) return false;
        state.row = { ...r, amount_paid_cents: f.amountPaidCents, stripe_payment_intent_id: f.paymentIntentId };
        return true;
      }),
      expireHold: vi.fn(async () => {
        const r = state.row;
        if (!r || r.status !== 'booked' || r.payment_status !== 'awaiting') return false;
        state.row = { ...r, status: 'cancelled', cancelled_at: 'T_CANCEL', payment_status: 'none' };
        return true;
      }),
      setRefunded: vi.fn(async (_id: string, total: number, ps: string) => {
        if (state.row && Math.floor(state.row.amount_refunded_cents ?? 0) <= total) state.row = { ...state.row, amount_refunded_cents: total, payment_status: ps };
      }),
      setChargesEnabledForAccount: vi.fn(async () => {}),
      disconnectAccount: vi.fn(async () => true),
      refund: vi.fn(async (_s, _a, amt: number) => ({ refundedCents: amt })),
      notify: vi.fn(async () => {}),
      claimOnce: vi.fn(async (k: string) => { if (claims.has(k)) return false; claims.add(k); return true; }),
      releaseClaim: vi.fn(async (k: string) => { claims.delete(k); }),
      now: () => Date.UTC(2026, 9, 21, 12),
      ...over,
    };
    return deps;
  }
  /** What the cancel path (S1) does: atomic `update … where status = 'booked'`. */
  const cancel = (d: ReturnType<typeof mkDeps>) => {
    if (d.state.row?.status === 'booked') d.state.row = { ...d.state.row, status: 'cancelled', cancelled_at: 'T_CANCEL' };
  };
  const completed = (over: any = {}, account: string | null = 'acct_123') => ({
    id: 'evt_1', type: 'checkout.session.completed', account,
    data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 3000, payment_intent: 'pi_1', ...over } },
  });

  it('completed → paid with paid_at, sends the confirmation; duplicates are no-ops', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent(completed(), deps)).toBe('paid:paid');
    expect(deps.markPaid).toHaveBeenCalledWith('appt-1', { paymentStatus: 'paid', amountPaidCents: 3000, paymentIntentId: 'pi_1' });
    expect(deps.state.row?.paid_at).toBe('T_PAID');
    expect(deps.notify).toHaveBeenCalledWith({ kind: 'booking_created', appointmentId: 'appt-1' });
    expect(await handleConnectEvent(completed(), deps)).toBe('duplicate');
    expect(deps.markPaid).toHaveBeenCalledTimes(1);
  });

  it('completed with less than the price → deposit; null price → deposit', async () => {
    expect(await handleConnectEvent(completed({ amount_total: 1000 }), mkDeps())).toBe('paid:deposit');
    expect(await handleConnectEvent(completed(), mkDeps({ ...base, price_cents: null }))).toBe('paid:deposit');
  });

  it('crash after markPaid (event never recorded): the redelivery sends the confirmation, once', async () => {
    const deps = mkDeps(base, { recordEvent: vi.fn().mockRejectedValueOnce(new Error('killed')).mockResolvedValue(undefined) });
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('killed');
    expect(deps.notify).not.toHaveBeenCalled();
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:already-recorded');
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('two concurrent deliveries of one completed event notify once (R-11)', async () => {
    const deps = mkDeps(base, { recordEvent: vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)); }) });
    deps.eventProcessed = vi.fn(async () => false);
    const [a, b] = await Promise.all([handleConnectEvent(completed(), deps), handleConnectEvent(completed(), deps)]);
    expect([a, b].sort()).toEqual(['noop:already-recorded', 'paid:paid']);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith({ kind: 'booking_created', appointmentId: 'appt-1' });
  });

  it('a replay of an already-processed event notifies nobody', async () => {
    const deps = mkDeps();
    await handleConnectEvent(completed(), deps);
    expect(await handleConnectEvent(completed(), deps)).toBe('duplicate');
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('a send that fails releases the claim, so the retry still sends exactly one', async () => {
    const notify = vi.fn().mockRejectedValueOnce(new Error('smtp')).mockResolvedValue(undefined);
    const deps = mkDeps(base, { notify, recordEvent: vi.fn().mockRejectedValueOnce(new Error('killed')).mockResolvedValue(undefined) });
    // first delivery: work done, record fails -> no notify yet; second: send throws; third: sends.
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('killed');
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:already-recorded');
    await new Promise((r) => setTimeout(r, 0));
    expect(deps.releaseClaim).toHaveBeenCalledWith('booking_created:appt-1');
    deps.eventProcessed = vi.fn(async () => false);
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:already-recorded');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:already-recorded');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('a claim store error still sends the confirmation', async () => {
    const deps = mkDeps(base, { claimOnce: vi.fn(async () => { throw new Error('db'); }) });
    expect(await handleConnectEvent(completed(), deps)).toBe('paid:paid');
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('a failing or throwing notify never fails the webhook', async () => {
    expect(await handleConnectEvent(completed(), mkDeps(base, { notify: vi.fn(async () => { throw new Error('smtp'); }) }))).toBe('paid:paid');
    expect(await handleConnectEvent(completed(), mkDeps(base, { notify: vi.fn(() => { throw new Error('sync'); }) as any }))).toBe('paid:paid');
  });

  it('a second, different payment is refunded in full under its own key', async () => {
    const deps = mkDeps({ ...base, payment_status: 'paid', stripe_payment_intent_id: 'pi_first', amount_paid_cents: 3000, paid_at: 'T0' });
    expect(await handleConnectEvent(completed({ payment_intent: 'pi_second' }), deps)).toBe('refunded:duplicate-payment');
    expect(deps.refund).toHaveBeenCalledWith(shop, expect.objectContaining({ stripe_payment_intent_id: 'pi_second', amount_paid_cents: 3000 }), 3000, 'refund-dup-pi_second');
    expect(deps.setRefunded).not.toHaveBeenCalled();
  });

  it('async_payment_succeeded is handled like completed; async_payment_failed like expired', async () => {
    expect(await handleConnectEvent({ ...completed(), id: 'as1', type: 'checkout.session.async_payment_succeeded' }, mkDeps())).toBe('paid:paid');
    expect(await handleConnectEvent({ id: 'as2', type: 'checkout.session.async_payment_failed', account: 'acct_123', data: { object: { id: 'cs_1', payment_status: 'unpaid' } } }, mkDeps())).toBe('cancelled:expired');
  });

  it('a paid session with no appointment is logged loudly', async () => {
    expect(await handleConnectEvent(completed(), mkDeps(null))).toBe('ignored:no-appointment');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('without a matching appointment'), expect.stringContaining('pi_1'));
  });

  it('ignores events from another connected account, unpaid sessions and unknown sessions', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent(completed({}, 'acct_evil'), deps)).toBe('ignored:no-appointment');
    expect(await handleConnectEvent({ ...completed(), id: 'evt_2', account: null }, deps)).toBe('ignored:no-appointment');
    expect(await handleConnectEvent({ ...completed({ payment_status: 'unpaid' }), id: 'evt_3' }, deps)).toBe('ignored:unpaid');
    expect(await handleConnectEvent({ ...completed({ id: 'cs_other' }), id: 'evt_4' }, deps)).toBe('ignored:no-appointment');
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it('cancelled, then paid → payment recorded without paid_at and refunded in full (pac key), no confirmation', async () => {
    const deps = mkDeps({ ...base, status: 'cancelled', cancelled_at: 'T_CANCEL' });
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect(deps.recordPaidAfterCancel).toHaveBeenCalledWith('appt-1', { amountPaidCents: 3000, paymentIntentId: 'pi_1' });
    expect(deps.state.row?.paid_at).toBeNull();
    expect(deps.refund).toHaveBeenCalledWith(shop, expect.objectContaining({ stripe_payment_intent_id: 'pi_1' }), 3000, 'refund-pac-pi_1-3000-0');
    expect(deps.state.row?.amount_refunded_cents).toBe(3000);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('I4: cancelled after Stripe created the event but before markPaid; first refund fails; the redelivery refunds', async () => {
    const deps = mkDeps(base, { refund: vi.fn().mockRejectedValueOnce(new Error('stripe 500')).mockImplementation(async (_s, _a, amt: number) => ({ refundedCents: amt })) });
    cancel(deps); // customer cancels on the manage page: S1 sees an unpaid hold, refunds nothing
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('stripe 500');
    expect(deps.state.row).toMatchObject({ status: 'cancelled', paid_at: null, stripe_payment_intent_id: 'pi_1', amount_refunded_cents: 0 });
    expect(deps.recordEvent).not.toHaveBeenCalled();
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect((deps.refund as any).mock.calls.map((c: any[]) => [c[2], c[3]])).toEqual([[3000, 'refund-pac-pi_1-3000-0'], [3000, 'refund-pac-pi_1-3000-0']]);
    expect(deps.state.row?.amount_refunded_cents).toBe(3000);
    // and further deliveries are plain no-ops
    expect(await handleConnectEvent({ ...completed(), id: 'evt_9' }, deps)).toBe('noop:already-refunded');
    expect(deps.refund).toHaveBeenCalledTimes(2);
  });

  it('paid-after-cancel: killed after the refund but before it was saved → the redelivery repeats the SAME keyed request', async () => {
    const deps = mkDeps({ ...base, status: 'cancelled', cancelled_at: 'T_CANCEL' });
    (deps as any).setRefunded = vi.fn().mockRejectedValueOnce(new Error('killed')).mockImplementation(async (_id: string, total: number) => { deps.state.row = { ...deps.state.row!, amount_refunded_cents: total }; });
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('killed');
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect((deps.refund as any).mock.calls.map((c: any[]) => c[3])).toEqual(['refund-pac-pi_1-3000-0', 'refund-pac-pi_1-3000-0']);
    expect(deps.state.row?.amount_refunded_cents).toBe(3000);
  });

  it('pac retry after the key expired: Stripe says charge_already_refunded → counted as done', async () => {
    const deps = mkDeps({ ...base, status: 'cancelled', stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000 }, {
      refund: vi.fn().mockRejectedValue(new StripeApiError('Charge already refunded', 400, 'charge_already_refunded')),
    });
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect(deps.state.row?.amount_refunded_cents).toBe(3000);
  });

  it('paid, then cancelled (fee kept) → the webhook never refunds; the cancel path owns it', async () => {
    const deps = mkDeps(base, { recordEvent: vi.fn().mockRejectedValueOnce(new Error('killed')).mockResolvedValue(undefined) });
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('killed'); // markPaid landed, record failed
    cancel(deps); // S1 cancel sees the payment (returned row), applies its policy
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:cancel-owns-refund');
    expect(deps.refund).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('decisions use the re-read row: a concurrent delivery that recorded the payment', async () => {
    const deps = mkDeps(base);
    deps.appointmentBySession = vi.fn(async () => ({ ...base })); // stale snapshot
    deps.state.row = { ...base, payment_status: 'paid', stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000, paid_at: 'T_PAID' };
    expect(await handleConnectEvent(completed(), deps)).toBe('noop:already-recorded');
    expect(deps.appointmentById).toHaveBeenCalledWith('appt-1');
    expect(deps.refund).not.toHaveBeenCalled();
  });

  it('pac: only the unrefunded remainder is refunded', async () => {
    const deps = mkDeps({ ...base, status: 'cancelled', stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000, amount_refunded_cents: 1000 });
    expect(await handleConnectEvent(completed(), deps)).toBe('refunded:cancelled-before-payment');
    expect((deps.refund as any).mock.calls[0][2]).toBe(2000);
    expect(deps.state.row?.amount_refunded_cents).toBe(3000);
  });

  it('falls back to client_reference_id when the session id was never stored (not for another session)', async () => {
    const appointmentId = '11111111-2222-4333-8444-555555555555';
    const row = { ...base, id: appointmentId, stripe_checkout_session_id: null };
    const ev = { id: 'evt_x2', type: 'checkout.session.expired', account: 'acct_123', data: { object: { id: 'cs_9', client_reference_id: appointmentId } } };
    expect(await handleConnectEvent(ev, mkDeps(row))).toBe('cancelled:expired');
    expect(await handleConnectEvent(ev, mkDeps({ ...row, stripe_checkout_session_id: 'cs_other' }))).toBe('ignored:no-appointment');
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
    const deps = mkDeps({ ...base, payment_status: 'paid', stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000, paid_at: 'T0' });
    const ev = (amt: number, id: string) => ({ id, type: 'charge.refunded', account: 'acct_123', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount_refunded: amt, amount_captured: 3000 } } });
    expect(await handleConnectEvent(ev(1000, 'e1'), deps)).toBe('refund:recorded');
    expect(deps.setRefunded).toHaveBeenLastCalledWith('appt-1', 1000, 'partially_refunded');
    await handleConnectEvent(ev(3000, 'e2'), deps);
    expect(deps.setRefunded).toHaveBeenLastCalledWith('appt-1', 3000, 'refunded');
  });

  it('account.updated → stripe_charges_enabled', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent({ id: 'a1', type: 'account.updated', account: 'acct_123', data: { object: { id: 'acct_123', charges_enabled: true } } }, deps)).toBe('account:enabled');
    expect(deps.setChargesEnabledForAccount).toHaveBeenCalledWith('acct_123', true);
  });

  it('deauthorized → disconnect (audit + clear); unknown account → no-op', async () => {
    const deps = mkDeps();
    expect(await handleConnectEvent({ id: 'a2', type: 'account.application.deauthorized', account: 'acct_123', data: { object: {} } }, deps)).toBe('account:deauthorized');
    expect(deps.disconnectAccount).toHaveBeenCalledWith('acct_123', 'a2');
    const d2 = mkDeps(base, { disconnectAccount: vi.fn(async () => false) });
    expect(await handleConnectEvent({ id: 'a3', type: 'account.application.deauthorized', account: 'acct_unknown', data: { object: {} } }, d2)).toBe('ignored:unknown-account');
  });

  it('unknown events are acknowledged', async () => {
    expect(await handleConnectEvent({ id: 'u1', type: 'payout.paid', account: 'acct_123', data: { object: {} } }, mkDeps())).toBe('ignored:payout.paid');
  });

  it('a processing failure records nothing, so the Stripe retry is processed', async () => {
    const deps = mkDeps(base, { markPaid: vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue(true) });
    await expect(handleConnectEvent(completed(), deps)).rejects.toThrow('db down');
    expect(deps.recordEvent).not.toHaveBeenCalled();
    expect(await handleConnectEvent(completed(), deps)).toBe('paid:paid');
    expect(deps.recordEvent).toHaveBeenCalledWith('evt_1', 'checkout.session.completed', 'acct_123');
  });
});

describe('refundKey + refundAppointment idempotency option', () => {
  it('reason-scoped keys, used as the Idempotency-Key when given', async () => {
    expect(refundKey.cancel('appt-1', 3000, 0)).toBe('refund-cancel-appt-1-3000-0');
    expect(refundKey.pac('pi_1', 3000, 0)).toBe('refund-pac-pi_1-3000-0');
    expect(refundKey.duplicate('pi_1')).toBe('refund-dup-pi_1');
    const { f, calls } = fakeFetch({ body: { id: 're', amount: 3000, status: 'succeeded' } });
    await refundAppointment(shop, { ...appt, stripe_payment_intent_id: 'pi_1', amount_paid_cents: 3000 }, 3000, { fetch: f, idempotencyKey: refundKey.cancel('appt-1', 3000, 0) });
    expect(calls[0].init.headers['Idempotency-Key']).toBe('refund-cancel-appt-1-3000-0');
  });
});

describe('liveWebhookDeps (query shape)', () => {
  // Minimal recorder for the supabase-js query builder.
  function recorder(result: any = { data: [], error: null }) {
    const calls: Array<[string, any[]]> = [];
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any) => res(result);
        return (...args: any[]) => { calls.push([prop, args]); return chain; };
      },
    });
    return { db: { from: (t: string) => { calls.push(['from', [t]]); return chain; } } as any, calls };
  }

  it('setRefunded never lowers amount_refunded_cents (out-of-order charge.refunded)', async () => {
    const { db, calls } = recorder();
    await liveWebhookDeps(db).setRefunded('appt-1', 1000, 'partially_refunded');
    expect(calls).toContainEqual(['lte', ['amount_refunded_cents', 1000]]);
    expect(calls).toContainEqual(['eq', ['id', 'appt-1']]);
  });

  it('markPaid: live booking, no payment yet, sets paid_at; recordPaidAfterCancel: cancelled, paid_at null; expireHold: booked + awaiting', async () => {
    const { db, calls } = recorder();
    const d = liveWebhookDeps(db);
    await d.markPaid('a', { paymentStatus: 'paid', amountPaidCents: 1, paymentIntentId: 'pi' });
    expect(calls).toContainEqual(['neq', ['status', 'cancelled']]);
    expect(calls).toContainEqual(['is', ['stripe_payment_intent_id', null]]);
    expect(calls.find((c) => c[0] === 'update')?.[1][0]).toMatchObject({ stripe_payment_intent_id: 'pi', paid_at: expect.any(String) });
    calls.length = 0;
    await d.recordPaidAfterCancel('a', { amountPaidCents: 1, paymentIntentId: 'pi' });
    expect(calls.find((c) => c[0] === 'update')?.[1][0]).not.toHaveProperty('paid_at');
    expect(calls).toContainEqual(['eq', ['status', 'cancelled']]);
    expect(calls).toContainEqual(['is', ['paid_at', null]]);
    calls.length = 0;
    await d.expireHold('a', 'now');
    expect(calls).toContainEqual(['eq', ['status', 'booked']]);
    expect(calls).toContainEqual(['eq', ['payment_status', 'awaiting']]);
  });

  it('disconnectAccount: audit row with the old id BEFORE clearing; unknown account → false, nothing written', async () => {
    const results = [{ data: [{ id: 'shop-1' }], error: null }, { error: null }, { error: null }];
    const calls: Array<[string, any[]]> = [];
    const chain: any = new Proxy({}, { get(_t, prop: string) {
      if (prop === 'then') return (res: any) => res(results.shift() ?? { data: null, error: null });
      return (...args: any[]) => { calls.push([prop, args]); return chain; };
    } });
    const db: any = { from: (t: string) => { calls.push(['from', [t]]); return chain; } };
    expect(await liveWebhookDeps(db).disconnectAccount('acct_1', 'evt_d')).toBe(true);
    const insertAt = calls.findIndex((c) => c[0] === 'insert');
    const updateAt = calls.findIndex((c) => c[0] === 'update');
    expect(insertAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(updateAt);
    expect(calls[insertAt][1][0]).toMatchObject({ shop_id: 'shop-1', kind: 'stripe_account_deauthorized', payload: { accountId: 'acct_1', eventId: 'evt_d' } });
    expect(calls[updateAt][1][0]).toEqual({ stripe_account_id: null, stripe_charges_enabled: false });

    const none = recorder({ data: [], error: null });
    expect(await liveWebhookDeps(none.db).disconnectAccount('acct_x', 'evt_e')).toBe(false);
    expect(none.calls.some((c) => c[0] === 'update' || c[0] === 'insert')).toBe(false);
  });
});
