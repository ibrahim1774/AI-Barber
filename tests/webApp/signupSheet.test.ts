import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bestPhone, buildPayload, isInternalTest, liveSignupSheetDeps, sweepSignupSheet, type SheetDetails, type SheetRow, type SignupSheetDeps } from '../../lib/webApp/signupSheet.js';

vi.mock('../../lib/ios/siteUrlFor.js', () => ({ stampedSiteUrl: async (slug: string) => `https://${slug}.example.app` }));

const NOW = Date.parse('2026-11-10T12:00:00Z');
const ENV = { MAKE_SIGNUP_WEBHOOK_URL: 'https://hook.make.test/abc', MAKE_SIGNUP_SINCE: '2026-11-01T00:00:00Z' };
const det = (o: Partial<SheetDetails> = {}): SheetDetails => ({ email: 'jake@gmail.com', companyName: "Jake's Cuts", location: 'Austin, TX', phone: '+15125550100', bookingLink: '', priceGroup: 'base', ...o });
const row = (id: string, o: Partial<SheetRow> = {}): SheetRow => ({ user_id: id, email: `${id}@gmail.com`, signup_at: '2026-11-10T10:00:00.000Z', ...o });

function make(rows: SheetRow[], o: { status?: number | Error; claimLost?: string[]; details?: Record<string, SheetDetails | null | Error>; signal?: boolean | Error } = {}) {
  const sent = new Map<string, string>(); const claimed = new Set<string>(); const posts: { url: string; payload: any }[] = []; const calls: string[] = [];
  const deps: SignupSheetDeps = {
    pending: async () => rows.filter((r) => !sent.has(r.user_id)),
    claim: async (id) => { calls.push('claim:' + id); if (o.claimLost?.includes(id) || claimed.has(id) || sent.has(id)) return false; claimed.add(id); return true; },
    release: async (id) => { calls.push('release:' + id); claimed.delete(id); },
    markSent: async (id, at) => { calls.push('markSent:' + id); sent.set(id, at); claimed.delete(id); },
    details: async (id) => { calls.push('details:' + id); const d = o.details?.[id]; if (d instanceof Error) throw d; return d === undefined ? det({ email: `${id}@gmail.com` }) : d; },
    hasWebSignal: async (id) => { calls.push('signal:' + id); if (o.signal instanceof Error) throw o.signal; return o.signal ?? true; },
    post: async (url, payload) => { calls.push('post'); posts.push({ url, payload }); if (o.status instanceof Error) throw o.status; return o.status ?? 200; },
    now: () => NOW,
  };
  return { deps, sent, claimed, posts, calls };
}
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('gates', () => {
  it.each([
    ['off', { ...ENV, MAKE_SIGNUP_WEBHOOK_URL: '' }],
    ['bad_url', { ...ENV, MAKE_SIGNUP_WEBHOOK_URL: 'http://hook.make.test/x' }],
    ['no_since', { ...ENV, MAKE_SIGNUP_SINCE: '' }],
    ['no_since', { ...ENV, MAKE_SIGNUP_SINCE: 'junk' }],
  ])('%s: nothing is read or posted', async (reason, env) => {
    const m = make([row('u1')]);
    expect((await sweepSignupSheet(m.deps, { env })).skippedReason).toBe(reason);
    expect(m.calls).toEqual([]);
  });
  it('missing columns (PostgREST 400) or table (404): skipped as no_columns, never thrown', async () => {
    for (const status of [400, 404]) {
      const m = make([]); m.deps.pending = async () => { throw Object.assign(new Error('x'), { status }); };
      expect((await sweepSignupSheet(m.deps, { env: ENV })).skippedReason).toBe('no_columns');
    }
  });
  it('other read errors propagate (the cron reports them)', async () => {
    const m = make([]); m.deps.pending = async () => { throw Object.assign(new Error('x'), { status: 500 }); };
    await expect(sweepSignupSheet(m.deps, { env: ENV })).rejects.toThrow();
  });
});

describe('sending', () => {
  it('claims, then posts the mapped JSON once, then marks sent', async () => {
    const m = make([row('u1')]);
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(m.calls).toEqual(['signal:u1', 'claim:u1', 'details:u1', 'post', 'markSent:u1']);
    expect(m.posts[0].url).toBe(ENV.MAKE_SIGNUP_WEBHOOK_URL);
    expect(m.posts[0].payload).toEqual({
      companyName: "Jake's Cuts", location: 'Austin, TX', phone: '+15125550100', bookingLink: '', timestamp: '2026-11-10T10:00:00.000Z',
      email: 'u1@gmail.com', source: 'primebarber.org', priceGroup: 'base', industry: 'barber',
    });
  });
  it('a second run posts nothing for a user already marked sent (never repeats)', async () => {
    const m = make([row('u1')]);
    await sweepSignupSheet(m.deps, { env: ENV }); const again = await sweepSignupSheet(m.deps, { env: ENV });
    expect(m.posts).toHaveLength(1); expect(again.sent).toBe(0);
  });
  it('two overlapping runs post once (the claim is taken before the send)', async () => {
    const m = make([row('u1')]);
    m.deps.pending = async () => [row('u1')]; // both runs saw the row as pending
    const [a, b] = await Promise.all([sweepSignupSheet(m.deps, { env: ENV }), sweepSignupSheet(m.deps, { env: ENV })]);
    expect(m.posts).toHaveLength(1); expect(a.sent + b.sent).toBe(1); expect(a.skipped + b.skipped).toBe(1);
  });
  it('a lost claim posts nothing', async () => {
    const m = make([row('u1')], { claimLost: ['u1'] });
    expect((await sweepSignupSheet(m.deps, { env: ENV })).skipped).toBe(1); expect(m.posts).toEqual([]);
  });
  it.each([400, 404, 429, 500, 503])('Make answering %i: not marked sent, claim released, retried next run', async (status) => {
    const m = make([row('u1')], { status });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.failed).toBe(1); expect(m.sent.size).toBe(0); expect(m.claimed.size).toBe(0);
    m.posts.length = 0; (m as any).deps.post = async (u: string, p: any) => { m.posts.push({ url: u, payload: p }); return 200; };
    expect((await sweepSignupSheet(m.deps, { env: ENV })).sent).toBe(1); expect(m.sent.has('u1')).toBe(true);
  });
  it('a network error or timeout is a failure too (not marked sent, claim released)', async () => {
    const m = make([row('u1')], { status: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.failed).toBe(1); expect(m.sent.size).toBe(0); expect(m.claimed.size).toBe(0);
  });
  it('a details error releases the claim and nothing is posted', async () => {
    const m = make([row('u1')], { details: { u1: new Error('admin lookup 503') } });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.failed).toBe(1); expect(m.posts).toEqual([]); expect(m.claimed.size).toBe(0);
  });
  it('a deleted account (details null) is skipped and left unclaimed', async () => {
    const m = make([row('u1')], { details: { u1: null } });
    expect((await sweepSignupSheet(m.deps, { env: ENV })).skipped).toBe(1); expect(m.posts).toEqual([]); expect(m.claimed.size).toBe(0);
  });
  it('ibrahim3709+ test accounts are never posted', async () => {
    const m = make([row('t1', { email: 'ibrahim3709+qa1@gmail.com' }), row('u2')]);
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.sent).toBe(1); expect(m.posts.map((p) => p.payload.email)).toEqual(['u2@gmail.com']);
    expect(m.calls).not.toContain('claim:t1');
    expect(isInternalTest('ibrahim3709+x@gmail.com')).toBe(true); expect(isInternalTest('ibrahim3709@gmail.com')).toBe(false); expect(isInternalTest(null)).toBe(false);
  });
  it('the live auth email decides too: a row without an email whose account is a test account is closed without a post', async () => {
    const m = make([row('t2', { email: null })], { details: { t2: det({ email: 'ibrahim3709+z@gmail.com' }) } });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(m.posts).toEqual([]); expect(out.skipped).toBe(1); expect(m.sent.has('t2')).toBe(true);
  });
  it('stops after 5 failures in a row (Make is down) instead of hammering it', async () => {
    const m = make(Array.from({ length: 12 }, (_, i) => row('u' + i)), { status: 503 });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.failed).toBe(5); expect(m.posts).toHaveLength(5);
  });
  it('caps the sends per run', async () => {
    const m = make(Array.from({ length: 10 }, (_, i) => row('u' + i)));
    expect((await sweepSignupSheet(m.deps, { env: ENV, maxSends: 4 })).sent).toBe(4);
  });
  it('does not depend on any nudge state: a paid / live / iOS user is still posted (the deps have no stop-rule hook)', async () => {
    const m = make([row('paid')]);
    expect(Object.keys(m.deps).sort()).toEqual(['claim', 'details', 'hasWebSignal', 'markSent', 'now', 'pending', 'post', 'release']);
    expect((await sweepSignupSheet(m.deps, { env: ENV })).sent).toBe(1);
  });
  it('logs never carry the webhook URL, address, phone or payload', async () => {
    const m = make([row('u1'), row('u2')], { status: 500 });
    await sweepSignupSheet(m.deps, { env: ENV });
    const logged = JSON.stringify([...(console.error as any).mock.calls, ...(console.info as any).mock.calls]);
    expect(logged).not.toMatch(/hook\.make|gmail|\+1512|Jake/);
  });
});

describe('payload and phone', () => {
  it('buildPayload fixes source/industry and ISO timestamp; empty strings for unknowns', () => {
    const p = buildPayload(row('u1', { signup_at: '2026-11-10T10:00:00+00:00' }), det({ companyName: '', location: '', phone: '', bookingLink: 'https://x.vercel.app', priceGroup: 'g20' }));
    expect(p).toMatchObject({ companyName: '', location: '', phone: '', bookingLink: 'https://x.vercel.app', priceGroup: 'g20', source: 'primebarber.org', industry: 'barber', timestamp: '2026-11-10T10:00:00.000Z' });
  });
  it('bestPhone follows the order given and skips junk; auth phones without + are fixed', () => {
    expect(bestPhone([null, 'n/a', '447911123456', '+15125550100'])).toBe('+447911123456');
    expect(bestPhone(['(512) 555-0100'])).toBe('+15125550100');
    expect(bestPhone(['n/a', 'call me', undefined, '123'])).toBe('');
  });
});

describe('live deps', () => {
  it('pending reads this mode, unsent rows since the gate, oldest first, with the test-account filter encoded', async () => {
    const rest = vi.fn(async () => [{ user_id: 'u1' }]);
    await liveSignupSheetDeps('live', rest as any).pending('2026-11-01T00:00:00.000Z', 100);
    const path = (rest.mock.calls[0] as any[])[0] as string;
    expect(path).toContain('environment=eq.live'); expect(path).toContain('sheet_sent_at=is.null'); expect(path).toContain('signup_at=gte.2026-11-01T00%3A00%3A00.000Z');
    expect(path).toContain('order=signup_at.asc'); expect(path).toContain('email.not.ilike.ibrahim3709%2B*'); expect(path).toContain('email.is.null');
  });
  it('claim is one conditional PATCH (unsent, no fresh claim) and reports whether a row came back', async () => {
    const rest = vi.fn(async () => [{ user_id: 'u1' }]);
    expect(await liveSignupSheetDeps('test', rest as any).claim('u1', '2026-11-10T12:00:00.000Z', '2026-11-10T11:30:00.000Z')).toBe(true);
    const [path, init] = rest.mock.calls[0] as any[];
    expect(path).toContain('user_id=eq.u1'); expect(path).toContain('environment=eq.test'); expect(path).toContain('sheet_sent_at=is.null');
    expect(path).toContain('sheet_claimed_at.is.null'); expect(path).toContain('sheet_claimed_at.lt.');
    expect(init).toMatchObject({ method: 'PATCH', prefer: 'return=representation', body: { sheet_claimed_at: '2026-11-10T12:00:00.000Z' } });
    expect(await liveSignupSheetDeps('test', (async () => []) as any).claim('u1', 'a', 'b')).toBe(false);
  });
  it('release matches only OUR claim stamp; markSent sets sheet_sent_at and clears the claim', async () => {
    const rest = vi.fn(async () => null); const d = liveSignupSheetDeps('test', rest as any);
    await d.release('u1', '2026-11-10T12:00:00.000Z'); await d.markSent('u1', '2026-11-10T12:00:01.000Z');
    expect((rest.mock.calls[0] as any[])[0]).toContain('sheet_claimed_at=eq.2026-11-10T12%3A00%3A00.000Z');
    expect((rest.mock.calls[1] as any[])[1].body).toEqual({ sheet_sent_at: '2026-11-10T12:00:01.000Z', sheet_claimed_at: null });
  });
  it('post sends JSON with a 10 s timeout and returns the status', async () => {
    const f = vi.fn(async () => ({ status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    expect(await liveSignupSheetDeps('test', vi.fn() as any, f as any).post('https://hook.make.test/abc', { a: 1 } as any)).toBe(200);
    expect(spy).toHaveBeenCalledWith(10_000);
    const [, init] = f.mock.calls[0] as any[]; expect(init.method).toBe('POST'); expect(init.headers['Content-Type']).toBe('application/json'); expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });
  it('details gathers shop, address, phone priority (contact > auth > metadata > site > legacy > draft), site url and price group', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    const user = { id: 'u1', email: 'Jake@Gmail.com', phone: '15125550111', user_metadata: { phone: '+15125550122' } };
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => user }));
    const tables: Record<string, any> = {
      customer_contacts: [], web_app_sites: [{ slug: 'jakes-cuts', contact_phone: '+15125550133', published_at: '2026-11-10T11:00:00Z', taken_down_at: null }],
      web_app_drafts: [{ shop: "Jake's Cuts", address: 'Austin, TX', phone: '5125550144' }], sites: [], web_app_price_groups: [{ price_group: 'g10' }],
    };
    const rest = vi.fn(async (p: string) => tables[p.split('?')[0]]);
    const d = await liveSignupSheetDeps('live', rest as any, f as any).details('u1');
    expect(d).toEqual({ email: 'Jake@Gmail.com', companyName: "Jake's Cuts", location: 'Austin, TX', phone: '+15125550111', bookingLink: 'https://jakes-cuts.example.app', priceGroup: 'g10' });
    vi.unstubAllEnvs();
  });
  it('details is fail-soft per table (a missing table leaves blanks, price group base) and null for a deleted account', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    const ok = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'u1', email: 'a@b.co' }) }));
    const rest = vi.fn(async () => { throw Object.assign(new Error('supabase 404'), { status: 404 }); });
    expect(await liveSignupSheetDeps('test', rest as any, ok as any).details('u1')).toEqual({ email: 'a@b.co', companyName: '', location: '', phone: '', bookingLink: '', priceGroup: 'base' });
    const gone = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    expect(await liveSignupSheetDeps('test', rest as any, gone as any).details('u1')).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('web signal and settle time (iOS-app accounts are not sign-ups for this sheet)', () => {
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  it('a sign-up younger than 15 minutes is left alone (the web client may not have posted yet)', async () => {
    const m = make([row('u1', { signup_at: at(5 * 60_000) })]);
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.skipped).toBe(1); expect(m.calls).toEqual([]);
  });
  it('no web signal yet: skipped and left pending (not marked) while under 24 h', async () => {
    const m = make([row('u1', { signup_at: at(3 * 3600_000) })], { signal: false });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.skipped).toBe(1); expect(m.posts).toEqual([]); expect(m.sent.size).toBe(0); expect(m.calls).not.toContain('claim:u1');
  });
  it('no web signal after 24 h: closed without a post (sheet_sent_at = handled)', async () => {
    const m = make([row('u1', { signup_at: at(25 * 3600_000) })], { signal: false });
    await sweepSignupSheet(m.deps, { env: ENV });
    expect(m.posts).toEqual([]); expect(m.sent.has('u1')).toBe(true);
  });
  it('a signal that appears later is posted on the next run', async () => {
    const m = make([row('u1', { signup_at: at(3 * 3600_000) })], { signal: false });
    await sweepSignupSheet(m.deps, { env: ENV });
    (m.deps as any).hasWebSignal = async () => true;
    expect((await sweepSignupSheet(m.deps, { env: ENV })).sent).toBe(1);
  });
  it('a signal lookup error counts as a failure and posts nothing', async () => {
    const m = make([row('u1')], { signal: new Error('db') });
    const out = await sweepSignupSheet(m.deps, { env: ENV });
    expect(out.failed).toBe(1); expect(m.posts).toEqual([]); expect(m.sent.size).toBe(0);
  });
  it('live hasWebSignal checks the four web tables', async () => {
    const rest = vi.fn(async () => []);
    expect(await liveSignupSheetDeps('live', rest as any).hasWebSignal('u1')).toBe(false);
    expect(rest.mock.calls.map((c: any[]) => String(c[0]).split('?')[0])).toEqual(['web_app_price_groups', 'web_app_drafts', 'web_app_customers', 'web_app_checkout_sessions']);
  });
  it('the admin fetch has a 10 s timeout', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'u1', email: 'a@b.co' }) }));
    await liveSignupSheetDeps('test', (async () => []) as any, f as any).details('u1');
    expect((f.mock.calls[0] as any[])[1].signal).toBeDefined(); vi.unstubAllEnvs();
  });
});
