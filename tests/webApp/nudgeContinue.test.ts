import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performContinue, previewContinue, USED_GRACE_MS, type ContinueDeps, type ContinueRow } from '../../lib/webApp/nudgeContinue.js';
import { maskEmail, signContinueToken } from '../../lib/webApp/nudgeToken.js';
import handler from '../../api/web-app/continue.js';

const S = 'continue-secret';
const U = 'user-1';
const NOW = 1_800_000_000_000;
const tok = (step: 1 | 2 | 3 = 1, mode: 'live' | 'test' = 'test', uid = U, at = NOW) => signContinueToken(uid, step, mode, at, S);

function deps(o: { row?: Partial<ContinueRow> | null; email?: string | null | Error; paid?: boolean | Error; notWeb?: boolean | Error; now?: number; gen?: (e: string) => Promise<string>; consume?: any } = {}) {
  const calls: string[] = [];
  const row: ContinueRow | null = o.row === null ? null : { step1_sent_at: '2026-11-10T00:00:00Z', step2_sent_at: null, step3_sent_at: null, links_used: null, ...o.row };
  const d: ContinueDeps = {
    mode: 'test', secret: S, now: () => o.now ?? NOW + 1000,
    row: async () => { calls.push('row'); return row; },
    email: async () => { calls.push('email'); if (o.email instanceof Error) throw o.email; return o.email === undefined ? 'jake@gmail.com' : o.email; },
    isPaid: async () => { calls.push('paid'); if (o.paid instanceof Error) throw o.paid; return !!o.paid; },
    isNotWeb: async () => { calls.push('notweb'); if (o.notWeb instanceof Error) throw o.notWeb; return !!o.notWeb; },
    markPaid: async () => { calls.push('markPaid'); },
    stampLinkUsed: async () => { calls.push('stamp'); },
    generateLink: o.gen ?? (async () => { calls.push('generate'); return 'HASH'; }),
    consume: o.consume ?? (async () => { calls.push('consume'); return { refreshToken: 'RT-secret', userId: U }; }),
  };
  return { d, calls };
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('previewContinue (GET): no DB, no Supabase', () => {
  const p = { mode: 'test' as const, secret: S, now: () => NOW + 1000 };
  it('the masked address signed into the token comes back as the hint (GET stays DB-free); no hint -> null', () => {
    expect(previewContinue(signContinueToken(U, 1, 'test', NOW, S, undefined, maskEmail('jake@gmail.com')), p).hint).toBe('j••e@gmail.com');
    expect(previewContinue(tok(), p).hint).toBeNull();
    expect(maskEmail('a@b.co')).toBe('a•@b.co'); expect(maskEmail('ab@b.co')).toBe('a•@b.co'); expect(maskEmail('abc@b.co')).toBe('a•c@b.co'); expect(maskEmail('nope')).toBe('');
  });
  it('valid token -> form; expired, tampered, junk, other mode -> expired', () => {
    expect(previewContinue(tok(), p).state).toBe('form');
    expect(previewContinue(tok(1, 'test', U, NOW - 8 * 24 * 3600_000), p).state).toBe('expired');
    expect(previewContinue(tok() + 'x', p).state).toBe('expired');
    expect(previewContinue(undefined, p).state).toBe('expired');
    expect(previewContinue(tok(1, 'live'), p).state).toBe('expired');
  });
});

describe('performContinue (POST)', () => {
  it('happy path: mints, consumes server-side, sets only the two cookies, stamps use, redirects to the fixed path', async () => {
    const { d, calls } = deps();
    const out: any = await performContinue(tok(1), d);
    expect(out.kind).toBe('redirect'); expect(out.location).toBe('/app/?from=nudge1');
    expect(out.cookies).toHaveLength(2);
    expect(out.cookies[0]).toMatch(/^pb_rt=RT-secret; HttpOnly; Secure; SameSite=Lax; Path=\/api\/web-app\/session/);
    expect(out.cookies[1]).toMatch(/^pb_has=1; /);
    expect(JSON.stringify(out)).not.toContain('HASH');
    expect(calls).toEqual(['row', 'email', 'notweb', 'paid', 'generate', 'consume', 'stamp']);
  });
  it('a row stopped as paid / not_web / live never auto signs in; other stops still do', async () => {
    for (const stop_reason of ['paid', 'not_web', 'live']) {
      const { d, calls } = deps({ row: { stopped_at: 'x', stop_reason } });
      expect(await performContinue(tok(), d)).toEqual({ kind: 'redirect', location: '/app/sign-in', cookies: [] });
      expect(calls).not.toContain('generate');
    }
    expect(((await performContinue(tok(), deps({ row: { stopped_at: 'x', stop_reason: 'expired' } }).d)) as any).kind).toBe('redirect');
  });
  it('an iOS / App Store / legacy account is sent to sign-in at click time, even when the row finished as done', async () => {
    const { d, calls } = deps({ notWeb: true, row: { step3_sent_at: '2026-11-10T00:00:00Z', stopped_at: 'x', stop_reason: 'done' } });
    expect(await performContinue(tok(3), d)).toEqual({ kind: 'redirect', location: '/app/sign-in', cookies: [] });
    expect(calls).not.toContain('generate'); expect(calls).not.toContain('paid');
  });
  it('an error in the iOS / legacy lookup never signs in', async () => {
    const { d, calls } = deps({ notWeb: new Error('db') });
    expect(await performContinue(tok(), d)).toEqual({ kind: 'page', state: 'unavailable' });
    expect(calls).not.toContain('generate');
  });
  it('a session without a user id is refused', async () => {
    const { d } = deps({ consume: async () => ({ refreshToken: 'RT', userId: null }) });
    expect(await performContinue(tok(), d)).toEqual({ kind: 'page', state: 'unavailable' });
  });
  it('uses the account email from the admin lookup for the magic link', async () => {
    const gen = vi.fn(async (_e: string) => 'H');
    await performContinue(tok(), deps({ gen }).d);
    expect(gen).toHaveBeenCalledWith('jake@gmail.com');
  });
  it('expired / tampered / wrong-mode token: friendly page, nothing read', async () => {
    const { d, calls } = deps({ now: NOW + 8 * 24 * 3600_000 });
    expect(await performContinue(tok(), d)).toEqual({ kind: 'page', state: 'expired' });
    expect(await performContinue(tok(1, 'live'), deps().d)).toEqual({ kind: 'page', state: 'expired' });
    expect(calls).toEqual([]);
  });
  it('no row for (user, mode), or the step was never mailed: expired page, no sign-in', async () => {
    const a = deps({ row: null }); expect(await performContinue(tok(), a.d)).toEqual({ kind: 'page', state: 'expired' }); expect(a.calls).not.toContain('generate');
    const b = deps({ row: { step2_sent_at: null } }); expect(await performContinue(tok(2), b.d)).toEqual({ kind: 'page', state: 'expired' }); expect(b.calls).not.toContain('generate');
  });
  it('step 2 and 3 tokens work once that step was mailed and redirect with their step', async () => {
    const o: any = await performContinue(tok(3), deps({ row: { step3_sent_at: '2026-11-10T00:00:00Z' } }).d);
    expect(o.location).toBe('/app/?from=nudge3');
  });
  it('already used: a second POST within 10 minutes still works and keeps the first stamp; after 10 minutes it is refused', async () => {
    const first = new Date(NOW).toISOString();
    const within = deps({ row: { links_used: { '1': first } }, now: NOW + USED_GRACE_MS - 1000 });
    expect((await performContinue(tok(), within.d) as any).kind).toBe('redirect'); expect(within.calls).not.toContain('stamp');
    const late = deps({ row: { links_used: { '1': first } }, now: NOW + USED_GRACE_MS + 1000 });
    expect(await performContinue(tok(), late.d)).toEqual({ kind: 'page', state: 'used' }); expect(late.calls).not.toContain('generate');
  });
  it('another step used does not block this step', async () => {
    const r = await performContinue(tok(2), deps({ row: { step2_sent_at: '2026-11-10T00:00:00Z', links_used: { '1': new Date(NOW - 5 * 3600_000).toISOString() } } }).d);
    expect((r as any).kind).toBe('redirect');
  });
  it('paid account: plain sign-in redirect, row marked paid, no session minted', async () => {
    const { d, calls } = deps({ paid: true });
    expect(await performContinue(tok(), d)).toEqual({ kind: 'redirect', location: '/app/sign-in', cookies: [] });
    expect(calls).toContain('markPaid'); expect(calls).not.toContain('generate');
  });
  it('deleted account: friendly page; no email: same', async () => {
    expect(await performContinue(tok(), deps({ email: null }).d)).toEqual({ kind: 'page', state: 'gone' });
  });
  it('a lookup or Stripe error never signs in', async () => {
    for (const o of [{ email: new Error('503') }, { paid: new Error('stripe') }]) {
      const { d, calls } = deps(o as any);
      expect(await performContinue(tok(), d)).toEqual({ kind: 'page', state: 'unavailable' });
      expect(calls).not.toContain('generate');
    }
  });
  it('Supabase down at generate or verify: unavailable page, no cookies, link not marked used', async () => {
    const a = deps({ gen: async () => { throw new Error('down'); } });
    expect(await performContinue(tok(), a.d)).toEqual({ kind: 'page', state: 'unavailable' }); expect(a.calls).not.toContain('stamp');
    const b = deps({ consume: async () => { throw new Error('down'); } });
    expect(await performContinue(tok(), b.d)).toEqual({ kind: 'page', state: 'unavailable' }); expect(b.calls).not.toContain('stamp');
  });
  it('a session for a different user is refused', async () => {
    const { d } = deps({ consume: async () => ({ refreshToken: 'RT', userId: 'someone-else' }) });
    expect(await performContinue(tok(), d)).toEqual({ kind: 'page', state: 'unavailable' });
  });
  it('never logs tokens, hashes or session tokens', async () => {
    const t = tok();
    await performContinue(t, deps({ email: new Error(`boom ${'x'}`) }).d);
    await performContinue(t, deps({ consume: async () => { throw new Error('down'); } }).d);
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).not.toContain(t); expect(logged).not.toMatch(/HASH|RT-secret/);
  });
});

// ---------- handler ----------
const ORIGIN = 'https://www.primebarber.org';
function res() {
  const r: any = { code: 0, body: undefined, headers: {} as Record<string, any> };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k: string, v: any) => { r.headers[k] = v; };
  return r;
}
let n = 0;
const call = async (req: any) => { const r = res(); await handler({ headers: { 'x-real-ip': `10.1.0.${n}` }, query: {}, ...req }, r); return r; };
const json = (status: number, b: any) => new Response(JSON.stringify(b), { status });

function stubFetch(over: Record<string, any> = {}) {
  const f = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    const hit = Object.entries(over).find(([k]) => u.includes(k));
    if (hit) return typeof hit[1] === 'function' ? hit[1](u, init) : hit[1];
    if (u.includes('web_app_signup_nudges') && (init?.method ?? 'GET') === 'GET') return json(200, [{ step1_sent_at: '2026-11-10T00:00:00Z', step2_sent_at: null, step3_sent_at: null, links_used: null }]);
    if (u.includes('web_app_signup_nudges')) return json(200, null);
    if (u.includes('/auth/v1/admin/users/')) return json(200, { id: U, email: 'jake@gmail.com', created_at: '2026-11-09T00:00:00Z', email_confirmed_at: '2026-11-09T00:00:00Z' });
    if (u.includes('ab_shops') || u.includes('ios_purchases') || u.includes('/rest/v1/sites?')) return json(200, []);
    if (u.includes('web_app_entitlements')) return json(200, []);
    if (u.includes('web_app_customers')) return json(200, []);
    if (u.includes('checkout/sessions')) return json(200, { data: [] });
    if (u.includes('/auth/v1/admin/generate_link')) return json(200, { hashed_token: 'HASHED' });
    if (u.includes('/auth/v1/verify')) return json(200, { access_token: 'AT', refresh_token: 'RT-live', user: { id: U } });
    return json(404, {});
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('/api/web-app/continue handler', () => {
  beforeEach(() => {
    n += 1;
    vi.stubEnv('WEB_APP_NUDGE_SECRET', S); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc'); vi.stubEnv('SUPABASE_ANON_KEY', 'anon');
  });
  const live = () => signContinueToken(U, 1, 'test', Date.now(), S);

  it('GET renders the Continue form and makes no network call at all', async () => {
    const f = stubFetch();
    const t = live();
    const r = await call({ method: 'GET', query: { t } });
    expect(r.code).toBe(200); expect(f).not.toHaveBeenCalled();
    expect(r.body).toContain('<form method="POST" action="/api/web-app/continue"'); expect(r.body).toContain(`value="${t}"`);
    expect(r.headers['Cache-Control']).toBe('no-store'); expect(r.headers['X-Robots-Tag']).toBe('noindex'); expect(r.headers['Referrer-Policy']).toBe('same-origin');
  });
  it('GET shows who it signs in (masked) and a Not you link', async () => {
    stubFetch();
    const t = signContinueToken(U, 1, 'test', Date.now(), S, undefined, maskEmail('jake@gmail.com'));
    const r = await call({ method: 'GET', query: { t } });
    expect(r.body).toContain('Continue as j••e@gmail.com'); expect(r.body).toContain('Not you? Sign in'); expect(r.body).toContain('href="/app/sign-in"');
    expect(r.body).not.toContain('jake@gmail.com');
  });
  it('GET with a bad token says the link expired, still no network', async () => {
    const f = stubFetch();
    const r = await call({ method: 'GET', query: { t: 'junk' } });
    expect(r.body).toContain('This link has expired'); expect(r.body).not.toContain('<form method="POST" action="/api/web-app/continue"'); expect(f).not.toHaveBeenCalled();
  });
  it('POST signs in on the server: generate_link with the auth email, verify with the hash, cookies, 303 to the fixed path', async () => {
    const f = stubFetch();
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } });
    expect(r.code).toBe(303); expect(r.headers.Location).toBe('/app/?from=nudge1');
    const sc: string[] = r.headers['Set-Cookie'];
    expect(sc[0]).toMatch(/^pb_rt=RT-live; HttpOnly; Secure; SameSite=Lax; Path=\/api\/web-app\/session; Max-Age=/); expect(sc[1]).toMatch(/^pb_has=1;/);
    const gen = f.mock.calls.find((c) => String(c[0]).includes('generate_link'))!;
    expect(JSON.parse((gen[1] as any).body)).toEqual({ type: 'magiclink', email: 'jake@gmail.com' });
    const ver = f.mock.calls.find((c) => String(c[0]).endsWith('/auth/v1/verify'))!;
    expect(JSON.parse((ver[1] as any).body)).toEqual({ type: 'magiclink', token_hash: 'HASHED' });
    expect(JSON.stringify(r.body ?? '')).not.toMatch(/AT|HASHED|RT-live/);
    expect(JSON.stringify([...(console.error as any).mock.calls])).not.toMatch(/HASHED|RT-live|"AT"/);
  });
  it('POST accepts a url-encoded string body', async () => {
    stubFetch();
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: `t=${encodeURIComponent(live())}` });
    expect(r.code).toBe(303);
  });
  it('POST from a foreign Origin or Sec-Fetch-Site is 403 with no network call', async () => {
    const f = stubFetch();
    expect((await call({ method: 'POST', headers: { origin: 'https://evil.example', 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } })).code).toBe(403);
    expect((await call({ method: 'POST', headers: { 'sec-fetch-site': 'cross-site', 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } })).code).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });
  it('Origin: null is accepted only with Sec-Fetch-Site same-origin; cross-site is always refused', async () => {
    stubFetch();
    const post = (h: any) => call({ method: 'POST', headers: { 'x-real-ip': `10.1.0.${n}`, ...h }, body: { t: live() } });
    expect((await post({ origin: 'null', 'sec-fetch-site': 'same-origin' })).code).toBe(303);
    expect((await post({ origin: 'null' })).code).toBe(403);
    expect((await post({ origin: 'null', 'sec-fetch-site': 'cross-site' })).code).toBe(403);
    expect((await post({ origin: ORIGIN, 'sec-fetch-site': 'cross-site' })).code).toBe(403);
    expect((await post({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' })).code).toBe(403);
  });
  it('POST is rate limited per IP (429 after 10)', async () => {
    stubFetch();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: 'junk' } })).code;
    expect(last).toBe(429);
  });
  it('POST for a paid account redirects to sign-in and never calls generate_link', async () => {
    const f = stubFetch({ web_app_entitlements: json(200, [{ status: 'active' }]) });
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } });
    expect(r.code).toBe(303); expect(r.headers.Location).toBe('/app/sign-in'); expect(r.headers['Set-Cookie']).toBeUndefined();
    expect(f.mock.calls.some((c) => String(c[0]).includes('generate_link'))).toBe(false);
  });
  it('POST for an iOS purchaser goes to sign-in, never generate_link', async () => {
    const f = stubFetch({ ios_purchases: json(200, [{ original_transaction_id: 'x', environment: 'Production' }]) });
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } });
    expect(r.code).toBe(303); expect(r.headers.Location).toBe('/app/sign-in'); expect(r.headers['Set-Cookie']).toBeUndefined();
    expect(f.mock.calls.some((c) => String(c[0]).includes('generate_link'))).toBe(false);
  });
  it('POST for a deleted account (admin 404) shows the page, no cookies', async () => {
    stubFetch({ '/auth/v1/admin/users/': json(404, {}) });
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } });
    expect(r.code).toBe(200); expect(r.body).toContain('could not find'); expect(r.headers['Set-Cookie']).toBeUndefined();
  });
  it('POST when the row is missing: expired page, no generate_link', async () => {
    const f = stubFetch({ web_app_signup_nudges: json(200, []) });
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } });
    expect(r.body).toContain('expired'); expect(f.mock.calls.some((c) => String(c[0]).includes('generate_link'))).toBe(false);
  });
  it('no secret configured: expired page, no network', async () => {
    vi.stubEnv('WEB_APP_NUDGE_SECRET', '');
    const f = stubFetch();
    const r = await call({ method: 'POST', headers: { origin: ORIGIN, 'x-real-ip': `10.1.0.${n}` }, body: { t: live() } });
    expect(r.body).toContain('expired'); expect(f).not.toHaveBeenCalled();
  });
  it('other methods are 405', async () => { expect((await call({ method: 'DELETE' })).code).toBe(405); });
});
