import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/web-app/unsubscribe.js';
import { signUnsubscribeToken } from '../../lib/webApp/nudgeToken.js';

const S = 'unsub-secret';
function res() {
  const r: any = { code: 0, body: undefined, headers: {} as Record<string, any> };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.send = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: any) => { r.headers[k] = v; };
  return r;
}
const call = async (req: any) => { const r = res(); await handler({ headers: {}, query: {}, ...req }, r); return r; };
const stub = (status = 200) => { const f = vi.fn(async (..._a: any[]) => new Response('null', { status })); vi.stubGlobal('fetch', f); return f; };
const bodyOf = (f: any, i = 0) => JSON.parse(f.mock.calls[i][1].body);

beforeEach(() => { vi.stubEnv('WEB_APP_NUDGE_SECRET', S); vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('/api/web-app/unsubscribe', () => {
  const t = () => signUnsubscribeToken('Jake@Gmail.com', S);
  it('GET shows a confirm page and never writes', async () => {
    const f = stub();
    const r = await call({ method: 'GET', query: { t: t() } });
    expect(r.code).toBe(200); expect(r.body).toContain('Unsubscribe'); expect(r.body).toContain('<form method="POST"'); expect(f).not.toHaveBeenCalled();
    expect(r.headers['Cache-Control']).toBe('no-store');
  });
  it('GET with a bad token shows an invalid page and never writes', async () => {
    const f = stub();
    const r = await call({ method: 'GET', query: { t: 'junk' } });
    expect(r.body).toContain('not valid'); expect(f).not.toHaveBeenCalled();
  });
  it('one-click POST (token in the URL, RFC 8058 body) inserts the lowercased address and answers 200 text', async () => {
    const f = stub();
    const r = await call({ method: 'POST', query: { t: t() }, body: 'List-Unsubscribe=One-Click' });
    expect(r.code).toBe(200); expect(r.body).toBe('unsubscribed');
    expect(String(f.mock.calls[0][0])).toContain('web_app_email_suppressions');
    expect(bodyOf(f)).toEqual({ email: 'jake@gmail.com', reason: 'unsubscribe', source: 'one-click' });
  });
  it('a repeat is idempotent (ignore-duplicates, still 200)', async () => {
    const f = stub();
    await call({ method: 'POST', query: { t: t() }, body: '' });
    const r = await call({ method: 'POST', query: { t: t() }, body: '' });
    expect(r.code).toBe(200); expect((f.mock.calls[1][1] as any).headers.Prefer).toContain('ignore-duplicates');
  });
  it('the confirm page POST (token in the form) shows the unsubscribed page with source "page"', async () => {
    const f = stub();
    const r = await call({ method: 'POST', body: { t: t(), page: '1' } });
    expect(r.code).toBe(200); expect(r.body).toContain("You're unsubscribed"); expect(bodyOf(f).source).toBe('page');
  });
  it('a bad or missing token is 400 and writes nothing', async () => {
    const f = stub();
    expect((await call({ method: 'POST', query: { t: 'junk' }, body: '' })).code).toBe(400);
    expect((await call({ method: 'POST', body: '' })).code).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it('a continue-style or wrong-secret token is rejected', async () => {
    const f = stub();
    vi.stubEnv('WEB_APP_NUDGE_SECRET', 'other');
    expect((await call({ method: 'POST', query: { t: t() }, body: '' })).code).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it('never claims "unsubscribed" when the table is missing or the database fails', async () => {
    stub(404);
    const a = await call({ method: 'POST', body: { t: t(), page: '1' } });
    expect(a.code).toBe(503); expect(a.body).not.toContain("You're unsubscribed");
    const b = await call({ method: 'POST', query: { t: t() }, body: '' });
    expect(b.code).toBe(503);
    stub(500);
    expect((await call({ method: 'POST', query: { t: t() }, body: '' })).code).toBe(503);
  });
  it('does not log the address or token', async () => {
    stub(500);
    await call({ method: 'POST', query: { t: t() }, body: '' });
    expect(JSON.stringify((console.error as any).mock.calls)).not.toMatch(/jake@|gmail\.com/i);
  });
});
