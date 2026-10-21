import { describe, it, expect } from 'vitest';
import { supabaseBookingRepo } from '../../lib/bookings/repo.js';

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
