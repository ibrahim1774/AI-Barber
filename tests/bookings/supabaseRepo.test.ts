import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { supabaseBookingRepo, resetRequireCardProbe, REQUIRE_CARD_MISSING_TTL_MS } from '../../lib/bookings/repo.js';

/** Minimal chainable stand-in for supabase-js: every call is recorded, awaiting resolves `result`. */
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const chain: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return (...args: unknown[]) => { calls.push([prop, args]); return chain; };
    },
  });
  return { client: { from: (t: string) => { calls.push(['from', [t]]); return chain; } } as any, calls };
}

const row = { shop_id: 's', member_id: 'm', service_id: null, start_at: 'a', end_at: 'b', service_name: 'Cut', price_cents: 1,
  duration_min: 30, customer_name: 'n', customer_phone: 'p', customer_email: 'e', note: null, payment_status: 'none' as const,
  payment_method: 'shop' as const, source: 'online' as const };

describe('supabaseBookingRepo', () => {
  it('maps the exclusion constraint (23P01) to overlap on insert and update', async () => {
    const { client } = fakeClient({ data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } });
    const repo = supabaseBookingRepo(client);
    expect(await repo.insertAppointment(row)).toEqual({ ok: false, reason: 'overlap' });
    expect(await repo.updateAppointment('id', { start_at: 'x' })).toEqual({ ok: false, reason: 'overlap' });
  });

  it('other errors throw', async () => {
    const { client } = fakeClient({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(supabaseBookingRepo(client).insertAppointment(row)).rejects.toThrow('permission denied');
  });

  it('a conditional update that matches no row is stale, and filters on status', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    expect(await supabaseBookingRepo(client).updateAppointment('id', { status: 'cancelled' }, 'booked')).toEqual({ ok: false, reason: 'stale' });
    expect(calls).toContainEqual(['eq', ['status', 'booked']]);
  });

  it('guards become filters: start_at, payment status, not-card, method, paid and refunded totals', async () => {
    const { client, calls } = fakeClient({ data: [{ id: 'id' }], error: null });
    await supabaseBookingRepo(client).updateAppointment('id', { payment_status: 'paid' }, {
      status: 'booked', startAt: 's', paymentStatusIn: ['none', 'awaiting'], notCard: true, method: 'venmo', paidCents: 0, refundedLte: 500,
      refundDue: 700, notStuck: true,
    });
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['status', 'booked']],
      ['eq', ['start_at', 's']],
      ['in', ['payment_status', ['none', 'awaiting']]],
      ['or', ['payment_method.is.null,payment_method.neq.card']],
      ['eq', ['payment_method', 'venmo']],
      ['eq', ['amount_paid_cents', 0]],
      ['lte', ['amount_refunded_cents', 500]],
      ['eq', ['refund_due_cents', 700]],
      ['is', ['refund_stuck_at', null]],
    ]));
  });

  it('only deletes a row that never touched Stripe money', async () => {
    let r = fakeClient({ data: [], error: null });
    expect(await supabaseBookingRepo(r.client).deleteUnpaidAppointment('id')).toBe(false);
    expect(r.calls).toEqual(expect.arrayContaining([
      ['delete', []],
      ['is', ['stripe_checkout_session_id', null]],
      ['is', ['stripe_payment_intent_id', null]],
      ['eq', ['amount_paid_cents', 0]],
    ]));
    r = fakeClient({ data: [{ id: 'id' }], error: null });
    expect(await supabaseBookingRepo(r.client).deleteUnpaidAppointment('id')).toBe(true);
  });

  it('stale card holds: booked + card + awaiting + unpaid, created before the cutoff', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await supabaseBookingRepo(client).staleCardHolds('2026-11-02T12:00:00.000Z', 50);
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['status', 'booked']], ['eq', ['payment_method', 'card']], ['eq', ['payment_status', 'awaiting']],
      ['eq', ['amount_paid_cents', 0]], ['lt', ['created_at', '2026-11-02T12:00:00.000Z']], ['limit', [50]],
    ]));
  });

  it('pending refunds: cancelled, refund_pending, with a payment intent, untouched for a while, oldest first', async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await supabaseBookingRepo(client).pendingRefunds('2026-11-02T12:00:00.000Z', 25);
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['status', 'cancelled']], ['eq', ['refund_pending', true]], ['not', ['stripe_payment_intent_id', 'is', null]],
      ['lt', ['updated_at', '2026-11-02T12:00:00.000Z']], ['order', ['updated_at']], ['limit', [25]],
    ]));
  });

  it('maps shop unique violations', async () => {
    let r = fakeClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ab_shops_one_per_owner"' } });
    expect(await supabaseBookingRepo(r.client).insertShop({} as any)).toEqual({ ok: false, reason: 'owner-exists' });
    r = fakeClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ab_shops_slug_key"' } });
    expect(await supabaseBookingRepo(r.client).insertShop({} as any)).toEqual({ ok: false, reason: 'slug-taken' });
    r = fakeClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ab_shops_ios_otid_key"' } });
    expect(await supabaseBookingRepo(r.client).setShopOtid('s', 'o')).toBe('taken');
  });

  it('push tokens upsert on expo_token', async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await supabaseBookingRepo(client).upsertPushToken('u', 'ExponentPushToken[x]', 'ios');
    expect(calls).toContainEqual(['upsert', [{ user_id: 'u', expo_token: 'ExponentPushToken[x]', platform: 'ios' }, { onConflict: 'expo_token' }]]);
  });

  it("a site row of another user is 'foreign'", async () => {
    const { client } = fakeClient({ data: { user_id: 'other', deployed_url: 'https://x.vercel.app' }, error: null });
    expect(await supabaseBookingRepo(client).siteDeployedUrl('site', 'me')).toBe('foreign');
  });
});

describe('shop reads and the require_card column (migration 042)', () => {
  beforeEach(() => { resetRequireCardProbe(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('remembers "column missing" for 60 seconds, then probes again and picks the column up', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
    const missingErr = { code: '42703', message: 'column ab_shops.require_card does not exist' };
    const m = shopClient('require_card', missingErr);
    const repo = supabaseBookingRepo(m.client);
    await repo.shopById('a');                      // probe fails, retried without
    expect(m.selects).toHaveLength(2);
    await repo.shopById('a'); await repo.shopBySlug('s');
    expect(m.selects).toHaveLength(4);             // cached: one query each, none naming require_card
    expect(m.selects.slice(2).every((c) => !c.includes('require_card'))).toBe(true);
    vi.setSystemTime(new Date(Date.now() + REQUIRE_CARD_MISSING_TTL_MS - 1));
    await repo.shopById('a');
    expect(m.selects).toHaveLength(5);             // still cached just before the minute
    vi.setSystemTime(new Date(Date.now() + 2));
    const ok = shopClient(null, null);             // 042 applied now
    const row = await supabaseBookingRepo(ok.client).shopById('a');
    expect(ok.selects[0]).toContain('require_card'); // probes again after the minute
    expect(row).toMatchObject({ require_card: true });
  });

  /** A client whose select() fails with the given error while the column list names `bad`, else returns the row. */
  function shopClient(bad: string | null, error: unknown) {
    const selects: string[] = [];
    let cols = '';
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return undefined;
        if (prop === 'select') return (c: string) => { selects.push(c); cols = c; return chain; };
        if (prop === 'maybeSingle') return () => Promise.resolve(bad && cols.includes(bad) ? { data: null, error } : { data: { id: 'shop-1', ...(cols.includes('require_card') ? { require_card: true } : {}) }, error: null });
        return () => chain;
      },
    });
    return { client: { from: () => chain } as any, selects };
  }
  const missing = (code: string) => ({ code, message: code === 'PGRST204' ? "Could not find the 'require_card' column of 'ab_shops' in the schema cache" : 'column ab_shops.require_card does not exist' });

  it('reads require_card when the column exists', async () => {
    const { client, selects } = shopClient(null, null);
    expect(await supabaseBookingRepo(client).shopBySlug('x')).toEqual({ id: 'shop-1', require_card: true });
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('require_card');
  });
  for (const code of ['42703', 'PGRST204']) {
    it(`reads the shop without it when the column is missing (${code}): require_card is absent, i.e. false`, async () => {
      const { client, selects } = shopClient('require_card', missing(code));
      const row = await supabaseBookingRepo(client).shopById('id');
      expect(row).toEqual({ id: 'shop-1' });
      expect(selects).toHaveLength(2);
      expect(selects[1]).not.toContain('require_card');
      expect(selects[1]).toContain('site_look'); // the 011 fallback still applies
    });
  }
  it('either 042 column missing counts as "not applied" (fallback and cache)', async () => {
    const { client, selects } = shopClient('card_checkout_failed_at', { code: '42703', message: 'column ab_shops.card_checkout_failed_at does not exist' });
    expect(await supabaseBookingRepo(client).shopBySlug('x')).toEqual({ id: 'shop-1' });
    expect(selects[0]).toContain('card_checkout_failed_at');
    expect(selects[1]).not.toContain('card_checkout_failed_at');
    expect(selects[1]).not.toContain('require_card');
  });

  it('markCardCheckoutFailed updates only that shop and throws on error', async () => {
    const ok = fakeClient({ data: null, error: null });
    await supabaseBookingRepo(ok.client).markCardCheckoutFailed!('shop-1', '2026-11-02T12:00:00.000Z');
    expect(ok.calls).toEqual(expect.arrayContaining([['update', [{ card_checkout_failed_at: '2026-11-02T12:00:00.000Z' }]], ['eq', ['id', 'shop-1']]]));
    const bad = fakeClient({ data: null, error: { code: '42703', message: 'column does not exist' } });
    await expect(supabaseBookingRepo(bad.client).markCardCheckoutFailed!('s', 'x')).rejects.toThrow('column does not exist');
  });

  it('an unrelated error still throws (no silent retry)', async () => {
    const { client, selects } = shopClient('require_card', { code: '42501', message: 'permission denied for table ab_shops' });
    await expect(supabaseBookingRepo(client).shopByOwner('u')).rejects.toThrow('permission denied');
    expect(selects).toHaveLength(1);
  });
});
