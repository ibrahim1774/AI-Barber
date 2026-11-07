import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import handler from '../../api/web-app/email-events.js';
import { handleResendEvent, verifySvix } from '../../lib/webApp/resendWebhook.js';

const KEY = Buffer.from('super-secret-key-bytes-1234567890');
const SECRET = `whsec_${KEY.toString('base64')}`;
const sign = (id: string, ts: number | string, body: string, key = KEY) => `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
const nowSec = () => Math.floor(Date.now() / 1000);

describe('verifySvix', () => {
  const body = '{"type":"email.bounced"}';
  const now = 1_800_000_000;
  const h = (o: any = {}) => ({ id: 'msg_1', timestamp: String(now), signature: sign('msg_1', now, body), ...o });
  it('accepts a valid signature, also among several and with the secret prefix', () => {
    expect(verifySvix(body, h(), SECRET, now)).toBe(true);
    expect(verifySvix(body, h({ signature: `v1,AAAA ${sign('msg_1', now, body)}` }), SECRET, now)).toBe(true);
    expect(verifySvix(body, h(), KEY.toString('base64'), now)).toBe(true);
  });
  it('rejects a wrong key, tampered body, wrong id, junk, missing headers or missing secret', () => {
    expect(verifySvix(body, h({ signature: sign('msg_1', now, body, Buffer.from('other')) }), SECRET, now)).toBe(false);
    expect(verifySvix(body + ' ', h(), SECRET, now)).toBe(false);
    expect(verifySvix(body, h({ id: 'msg_2' }), SECRET, now)).toBe(false);
    expect(verifySvix(body, h({ signature: 'v1,' }), SECRET, now)).toBe(false);
    expect(verifySvix(body, h({ signature: 'v2,xx' }), SECRET, now)).toBe(false);
    expect(verifySvix(body, h({ id: undefined }), SECRET, now)).toBe(false);
    expect(verifySvix(body, h(), '', now)).toBe(false);
  });
  it('enforces the 5 minute tolerance in both directions', () => {
    expect(verifySvix(body, h(), SECRET, now + 299)).toBe(true);
    expect(verifySvix(body, h(), SECRET, now + 301)).toBe(false);
    expect(verifySvix(body, h(), SECRET, now - 301)).toBe(false);
    expect(verifySvix(body, h({ timestamp: 'abc' }), SECRET, now)).toBe(false);
  });
});

describe('handleResendEvent', () => {
  const sup = () => vi.fn(async (..._a: any[]) => true);
  it('permanent bounce -> bounce suppression for each recipient, lowercased by suppress()', async () => {
    const s = sup();
    const out = await handleResendEvent({ type: 'email.bounced', data: { to: ['A@b.co', 'Jake <j@x.co>'], bounce: { type: 'Permanent', subType: 'General' } } }, s as any);
    expect(out).toEqual({ handled: true, suppressed: 2 });
    expect(s.mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([['A@b.co', 'bounce', 'resend:email.bounced'], ['j@x.co', 'bounce', 'resend:email.bounced']]);
  });
  it('soft (transient / undetermined) bounce -> nothing', async () => {
    const s = sup();
    for (const type of ['Transient', 'Undetermined', undefined]) expect((await handleResendEvent({ type: 'email.bounced', data: { to: ['a@b.co'], bounce: { type } } }, s as any)).handled).toBe(false);
    expect(s).not.toHaveBeenCalled();
  });
  it('complaint -> complaint suppression', async () => {
    const s = sup();
    await handleResendEvent({ type: 'email.complained', data: { to: ['a@b.co'] } }, s as any);
    expect(s).toHaveBeenCalledWith('a@b.co', 'complaint', 'resend:email.complained');
  });
  it('delivered and unknown events do nothing', async () => {
    const s = sup();
    for (const type of ['email.delivered', 'email.sent', 'weird', undefined]) expect((await handleResendEvent({ type, data: { to: ['a@b.co'] } }, s as any)).handled).toBe(false);
    expect(await handleResendEvent(null, s as any)).toEqual({ handled: false, suppressed: 0 });
    expect(s).not.toHaveBeenCalled();
  });
  it('ignores non-string and non-address recipients; reports a missing table', async () => {
    const s = sup();
    expect((await handleResendEvent({ type: 'email.complained', data: { to: [5, 'nope', 'a@b.co'] } }, s as any)).suppressed).toBe(1);
    const missing = vi.fn(async (..._a: any[]) => false);
    expect(await handleResendEvent({ type: 'email.complained', data: { to: ['a@b.co'] } }, missing as any)).toMatchObject({ tableMissing: true });
  });
});

function res() {
  const r: any = { code: 0, body: undefined };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
const call = async (raw: string, headers: Record<string, string>, method = 'POST') => {
  const req: any = Readable.from([Buffer.from(raw)]); req.method = method; req.headers = headers;
  const r = res(); await handler(req, r); return r;
};

describe('/api/web-app/email-events', () => {
  beforeEach(() => { vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET); vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const signed = (body: string) => { const ts = nowSec(); return { 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_1', ts, body) }; };
  const stub = (status = 200) => { const f = vi.fn(async () => new Response('null', { status })); vi.stubGlobal('fetch', f); return f; };
  const bounce = JSON.stringify({ type: 'email.bounced', data: { to: ['Bad@x.co'], bounce: { type: 'Permanent' } } });

  it('missing secret -> 503, nothing written', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', ''); const f = stub();
    expect((await call(bounce, signed(bounce))).code).toBe(503); expect(f).not.toHaveBeenCalled();
  });
  it('bad signature -> 400, nothing written', async () => {
    const f = stub();
    expect((await call(bounce, { ...signed(bounce), 'svix-signature': 'v1,AAAA' })).code).toBe(400);
    expect((await call(bounce, {})).code).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
  it('valid hard bounce -> suppression row written, 200', async () => {
    const f = stub();
    const r = await call(bounce, signed(bounce));
    expect(r.code).toBe(200);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ email: 'bad@x.co', reason: 'bounce', source: 'resend:email.bounced' });
  });
  it('valid unknown event -> 200, nothing written', async () => {
    const f = stub(); const body = JSON.stringify({ type: 'email.delivered', data: { to: ['a@b.co'] } });
    expect((await call(body, signed(body))).code).toBe(200); expect(f).not.toHaveBeenCalled();
  });
  it('signed but not JSON -> 400; database failure -> 500 (Resend retries); missing table -> 503', async () => {
    stub(); const junk = 'not json';
    expect((await call(junk, signed(junk))).code).toBe(400);
    stub(500); expect((await call(bounce, signed(bounce))).code).toBe(500);
    stub(404); expect((await call(bounce, signed(bounce))).code).toBe(503);
  });
  it('wrong method is 405; failures never log the body or addresses', async () => {
    expect((await call(bounce, signed(bounce), 'GET')).code).toBe(405);
    stub(500); await call(bounce, signed(bounce));
    expect(JSON.stringify((console.error as any).mock.calls)).not.toMatch(/bad@x\.co|Permanent/i);
  });
});
