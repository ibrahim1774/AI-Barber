import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSignup, normalizePhone, type SignupDeps } from '../../lib/ios/signup.js';
import { makeRateLimiter, memoryStore } from '../../lib/bookings/rateLimit.js';

const good = { name: ' Sam  Cutter ', email: ' Sam@Example.COM ', phone: '(555) 010-0199', password: 'correct horse' };

function deps(over: Partial<SignupDeps> = {}) {
  const created: any[] = [];
  const d: SignupDeps = {
    allow: async () => true,
    createUser: async (u) => { created.push(u); return { exists: false }; },
    ...over,
  };
  return { d, created };
}
afterEach(() => vi.restoreAllMocks());

describe('POST /api/ios/signup', () => {
  it('success: creates the user via the admin path with normalized fields, returns only { ok, email }', async () => {
    const { d, created } = deps();
    const r = await runSignup(good, '1.2.3.4', d);
    expect(r).toEqual({ status: 200, body: { ok: true, email: 'sam@example.com' } });
    expect(created).toEqual([{ email: 'sam@example.com', password: 'correct horse', metadata: { full_name: 'Sam Cutter', name: 'Sam Cutter', phone: '5550100199' } }]);
  });

  it('no secrets in any response: no password, token, id, key, metadata', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bodies = [
      (await runSignup(good, 'ip', deps().d)).body,
      (await runSignup({ ...good, password: 'short' }, 'ip', deps().d)).body,
      (await runSignup(good, 'ip', deps({ createUser: async () => ({ exists: true }) }).d)).body,
      (await runSignup(good, 'ip', deps({ createUser: async () => { throw new Error('service_role eyJhbGciOi secret'); } }).d)).body,
      (await runSignup(good, 'ip', deps({ allow: async () => false }).d)).body,
    ];
    const wire = JSON.stringify(bodies);
    expect(wire).not.toMatch(/correct horse|eyJ|service_role|secret|access_token|user_metadata|"id"|555/i);
  });

  it('duplicate email: 409 email-exists and nothing else', async () => {
    const r = await runSignup(good, 'ip', deps({ createUser: async () => ({ exists: true }) }).d);
    expect(r).toEqual({ status: 409, body: { error: 'email-exists' } });
  });

  it('weak password (<8) is 400 weak-password and createUser is never called; also >72', async () => {
    const { d, created } = deps();
    expect(await runSignup({ ...good, password: '1234567' }, 'ip', d)).toEqual({ status: 400, body: { error: 'weak-password', minLength: 8 } });
    expect((await runSignup({ ...good, password: 'x'.repeat(73) }, 'ip', d)).status).toBe(400);
    expect((await runSignup({ ...good, password: 12345678 as any }, 'ip', d)).status).toBe(400);
    expect(created).toHaveLength(0);
    expect((await runSignup({ ...good, password: '12345678' }, 'ip', d)).status).toBe(200);
  });

  it('phone is required and validated server-side (E.164 / >= 7 digits)', async () => {
    const { d, created } = deps();
    for (const phone of [undefined, '', '12345', '123456', 'abc1234567', '+0123456789', '+1 555 010 0199 ext 5', '1'.repeat(16), '12+3456789', 5551234567]) {
      expect(await runSignup({ ...good, phone: phone as any }, 'ip', d)).toEqual({ status: 400, body: { error: 'bad-request', field: 'phone' } });
    }
    expect(created).toHaveLength(0);
    expect(normalizePhone('+1 (555) 010-0199')).toBe('+15550100199');
    expect(normalizePhone('555.010.0199')).toBe('5550100199');
    expect(normalizePhone('1234567')).toBe('1234567');
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
  });

  it('name and email are required and validated', async () => {
    const { d } = deps();
    expect(await runSignup({ ...good, name: '  ' }, 'ip', d)).toMatchObject({ status: 400, body: { field: 'name' } });
    expect(await runSignup({ ...good, name: 'x'.repeat(101) }, 'ip', d)).toMatchObject({ status: 400, body: { field: 'name' } });
    for (const email of ['', 'nope', 'a@b', 'a b@c.com', 'a@@c.com', 'a'.repeat(250) + '@x.com', null]) {
      expect(await runSignup({ ...good, email: email as any }, 'ip', d)).toMatchObject({ status: 400, body: { field: 'email' } });
    }
    expect((await runSignup(null, 'ip', d)).status).toBe(400);
  });

  it('rate limit: 429 and nothing created; the limiter is consulted with the IP and the email', async () => {
    const allow = vi.fn(async (_ip: string, _email: string) => false);
    const { d, created } = deps({ allow });
    expect(await runSignup(good, '9.9.9.9', d)).toEqual({ status: 429, body: { error: 'rate-limited' } });
    expect(allow).toHaveBeenCalledWith('9.9.9.9', 'sam@example.com');
    expect(created).toHaveLength(0);
  });

  it('real limiter shape: the 5th attempt for one email in a window is refused, another email is not', async () => {
    const ip = makeRateLimiter(memoryStore(), () => 1, memoryStore(), { read: 10, write: 10 }, 'signup');
    const em = makeRateLimiter(memoryStore(), () => 1, memoryStore(), { read: 4, write: 4 }, 'signupEmail');
    const allow = async (i: string, e: string) => (await ip.allow(i, 'write')) && (await em.allow(e, 'write'));
    const { d } = deps({ allow, createUser: async () => ({ exists: true }) });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await runSignup(good, '1.1.1.1', d)).status);
    expect(statuses).toEqual([409, 409, 409, 409, 429]);
    expect((await runSignup({ ...good, email: 'other@example.com' }, '1.1.1.1', d)).status).toBe(409);
  });

  it('a limiter outage fails open; a Supabase outage is 503 without detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = deps({ allow: async () => { throw new Error('store down'); } });
    expect((await runSignup(good, 'ip', down.d)).status).toBe(200);
    const r = await runSignup(good, 'ip', deps({ createUser: async () => { throw new Error('boom'); } }).d);
    expect(r).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
  });
});

describe('liveSignupDeps (Supabase admin mapping)', () => {
  it('createUser is called with email_confirm:true and metadata; email_exists maps to exists:true', async () => {
    const createUser = vi.fn(async (_a: any): Promise<any> => ({ data: {}, error: null }));
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { admin: { createUser } } }) }));
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srk');
    vi.resetModules();
    const { liveSignupDeps } = await import('../../api/ios/signup.js');
    const d = liveSignupDeps();
    const u = { email: 'a@b.co', password: 'pw123456', metadata: { full_name: 'A', name: 'A', phone: '5550100' } };
    expect(await d.createUser(u)).toEqual({ exists: false });
    expect(createUser).toHaveBeenCalledWith({ email: 'a@b.co', password: 'pw123456', email_confirm: true, user_metadata: u.metadata });
    createUser.mockResolvedValueOnce({ data: null, error: { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' } });
    expect(await d.createUser(u)).toEqual({ exists: true });
    createUser.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'db' } });
    await expect(d.createUser(u)).rejects.toThrow();
    vi.doUnmock('@supabase/supabase-js');
    vi.unstubAllEnvs();
  });
});
