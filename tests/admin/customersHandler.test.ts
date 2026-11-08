import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/admin/live.js', () => ({ adminSupabase: vi.fn(() => ({})) }));
vi.mock('../../lib/admin/customersLive.js', () => ({ loadCustomerSources: vi.fn() }));

import { makeAdminCustomersHandler, maskEmail } from '../../api/admin/customers.js';
import { ADMIN_EMAIL } from '../../lib/admin/auth.js';
import { buildCustomerRows } from '../../lib/admin/customers.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const UID = '11111111-2222-3333-4444-555555555555';

function make(over: any = {}) {
  let t = 1_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const load = vi.fn(async () => ({ rows: [{ key: 'main:u1', contactEmail: 'a@x.com' }] as any, sources: { auth: 'ok' as const } }));
  const sendReset = vi.fn(async () => ({ ok: true as const, to: 'mike@example.com' }));
  const logs: string[] = [];
  const h = makeAdminCustomersHandler({
    emailOf: () => async (tok: string) => (tok === 'good' ? ADMIN_EMAIL : tok === 'other' ? 'x@y.com' : null),
    load, sendReset, reads: memoryStore(), writes: memoryStore(), now: clock.now, configured: () => true, log: (m) => logs.push(m), ...over,
  });
  const call = async (method: string, opts: { token?: string | null; query?: any; body?: any } = {}) => {
    const r = res();
    const headers = opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? 'good'}` };
    await h({ method, headers, query: opts.query ?? {}, body: opts.body } as any, r);
    return r;
  };
  return { call, load, sendReset, clock, logs };
}

describe('/api/admin/customers', () => {
  it('GET sets degraded when a source errored or is partial', async () => {
    const m = make({ load: async () => ({ rows: [], sources: { auth: 'ok', stripe: 'partial' } }) });
    expect((await m.call('GET')).body.degraded).toBe(true);
  });

  it('401 without a token, 403 for a non-admin, 405 for other methods; no data either way', async () => {
    const m = make();
    const a = await m.call('GET', { token: null });
    expect([a.statusCode, a.body.rows]).toEqual([401, undefined]);
    const b = await m.call('GET', { token: 'other' });
    expect([b.statusCode, b.body.rows]).toEqual([403, undefined]);
    expect((await m.call('GET', { token: 'garbage' })).statusCode).toBe(403);
    expect((await m.call('DELETE')).statusCode).toBe(405);
    expect((await m.call('PUT')).statusCode).toBe(405);
    expect(m.load).not.toHaveBeenCalled();
  });

  it('500 when the server is not configured', async () => {
    const m = make({ configured: () => false });
    expect((await m.call('GET')).statusCode).toBe(500);
  });

  it('GET returns rows and sources; cached for 60 s; ?refresh=1 reloads; expiry reloads', async () => {
    const m = make();
    const first = await m.call('GET');
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({ ok: true, generatedAt: 1_000, rows: [{ key: 'main:u1' }], sources: { auth: 'ok' }, degraded: false });
    expect(first.headers['Cache-Control']).toBe('no-store');
    m.clock.advance(30_000);
    await m.call('GET');
    expect(m.load).toHaveBeenCalledTimes(1);
    await m.call('GET', { query: { refresh: '1' } });
    expect(m.load).toHaveBeenCalledTimes(2);
    m.clock.advance(61_000);
    const later = await m.call('GET');
    expect(m.load).toHaveBeenCalledTimes(3);
    expect(later.body.generatedAt).toBe(92_000);
  });

  it('concurrent GETs share one load', async () => {
    const m = make();
    await Promise.all([m.call('GET'), m.call('GET'), m.call('GET')]);
    expect(m.load).toHaveBeenCalledTimes(1);
  });

  it('a throwing loader is a 500 with no detail leaked', async () => {
    const m = make({ load: async () => { throw new Error('sk_live_SECRET exploded'); } });
    const r = await m.call('GET');
    expect(r.statusCode).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('SECRET');
  });

  it('send-reset sends and answers with a masked address; the log has no full email', async () => {
    const m = make();
    const r = await m.call('POST', { body: { action: 'send-reset', userId: UID } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true, sentTo: 'm***@e***.com' });
    expect(m.sendReset).toHaveBeenCalledWith(UID);
    expect(m.logs.join('\n')).not.toContain('mike@example.com');
    expect(m.logs.join('\n')).toContain('m***@e***.com');
  });

  it('send-reset validation and failure mapping', async () => {
    const m = make();
    expect((await m.call('POST', { body: { action: 'send-reset', userId: 'nope' } })).statusCode).toBe(400);
    expect((await m.call('POST', { body: { action: 'delete-everything', userId: UID } })).statusCode).toBe(400);
    expect((await m.call('POST', { body: undefined })).statusCode).toBe(400);
    expect((await m.call('POST', { body: '{bad json' })).statusCode).toBe(400);
    expect((await m.call('POST', { body: JSON.stringify({ action: 'send-reset', userId: UID }) })).statusCode).toBe(200);
    const nf = make({ sendReset: async () => ({ ok: false, error: 'not-found' }) });
    expect((await nf.call('POST', { body: { action: 'send-reset', userId: UID } })).statusCode).toBe(404);
    const failed = make({ sendReset: async () => ({ ok: false, error: 'failed' }) });
    expect((await failed.call('POST', { body: { action: 'send-reset', userId: UID } })).statusCode).toBe(502);
  });

  it('rate limits: 30 reads per minute, 10 writes per minute', async () => {
    const m = make();
    for (let i = 0; i < 30; i++) expect((await m.call('GET')).statusCode).toBe(200);
    expect((await m.call('GET')).statusCode).toBe(429);
    const w = make();
    for (let i = 0; i < 10; i++) expect((await w.call('POST', { body: { action: 'send-reset', userId: UID } })).statusCode).toBe(200);
    expect((await w.call('POST', { body: { action: 'send-reset', userId: UID } })).statusCode).toBe(429);
    w.clock.advance(61_000);
    expect((await w.call('POST', { body: { action: 'send-reset', userId: UID } })).statusCode).toBe(200);
  });

  it('the payload built from rich source data has no secret-looking fields or values', async () => {
    const rows = await buildCustomerRows({
      now: Date.now(),
      main: {
        users: [{ id: UID, email: 'a@x.com', user_metadata: { portal_password: 'pw-123', phone: '2025550100' }, app_metadata: { provider: 'email' }, identities: [{ provider: 'email', identity_data: { email: 'a@x.com' } }] }],
        webEntitlements: [{ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: UID, site_slug: 'a', tier: 'website', billing_interval: 'month', status: 'active', environment: 'live' }],
        webCustomers: [], webSites: [{ slug: 'a', user_id: UID, removed_at: null }], siteOwners: [], iosPurchases: [], iosDomains: [],
        legacySites: [{ user_id: UID, portal_password: 'pw-456', token: 'tok-789' }], usersProfile: [], contacts: [],
      },
      stripe: { customers: [{ id: 'cus_1', email: 'a@x.com' }], subs: [] },
      siteUrlOf: async (s) => `https://${s}.vercel.app`,
      status: { auth: 'ok' },
    } as any);
    const m = make({ load: async () => ({ rows, sources: { auth: 'ok' } }) });
    const r = await m.call('GET');
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/pw-123|pw-456|tok-789/);
    const keys = new Set<string>();
    const walk = (v: any) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(r.body);
    for (const k of keys) expect(k).not.toMatch(/pass|token|secret|api_?key|service_?role|portal|authorization/i);
  });

  it('maskEmail keeps first letters and the TLD only', () => {
    expect(maskEmail('ibrahim@davoxa.com')).toBe('i***@d***.com');
  });
});
