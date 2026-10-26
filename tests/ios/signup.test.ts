import { describe, it, expect, vi, afterEach } from 'vitest';
import { runSignup, normalizePhone, MAX_SIGNUPS_PER_PURCHASE, type SignupDeps } from '../../lib/ios/signup.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import type { PurchaseRow } from '../../lib/ios/purchases.js';
import { makeRateLimiter, memoryStore } from '../../lib/bookings/rateLimit.js';

const NOW = 1_800_000_000_000;
const TX: VerifiedTx = { originalTransactionId: '2000000123', transactionId: '2000000555', productId: 'com.ibrahim1774.aibarber.store.monthly', environment: 'Production', expiresAt: NOW + 86_400_000, revoked: false, status: 1, productPurchasedAt: NOW - 1000 };
const row = (over: Partial<PurchaseRow> = {}): PurchaseRow => ({ original_transaction_id: '2000000123', product_id: TX.productId, environment: 'Production', site_slug: null, user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null, lapse_checked_at: null, ...over });
const good = { transactionId: '2000000555', name: ' Sam  Cutter ', email: ' Sam@Example.COM ', phone: '(555) 010-0199', password: 'correct horse' };

function deps(over: Partial<SignupDeps> = {}) {
  const created: any[] = [];
  const d: SignupDeps = {
    allow: async () => true,
    verify: async () => TX,
    getPurchase: async () => null,
    allowForPurchase: async () => true,
    now: () => NOW,
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

  it('H3: a limiter outage fails CLOSED (503, nothing created); a Supabase outage is 503 without detail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const down = deps({ allow: async () => { throw new Error('store down'); } });
    expect(await runSignup(good, 'ip', down.d)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
    expect(down.created).toHaveLength(0);
    const capDown = deps({ allowForPurchase: async () => { throw new Error('store down'); } });
    expect((await runSignup(good, 'ip', capDown.d)).status).toBe(503);
    expect(capDown.created).toHaveLength(0);
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

  describe('H3: proof of payment', () => {
    it('a missing / blank / oversized transactionId is 400 and Apple is never asked', async () => {
      const verify = vi.fn(async () => TX);
      const { d, created } = deps({ verify });
      for (const transactionId of [undefined, '', '   ', 5, 'x'.repeat(65)]) {
        expect(await runSignup({ ...good, transactionId: transactionId as any }, 'ip', d)).toEqual({ status: 400, body: { error: 'bad-request' } });
      }
      expect(verify).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    });

    it('Apple says unknown / wrong app / unavailable: 404 / 400 / 503, nothing created', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      for (const [code, status] of [['not-found', 404], ['bad-bundle', 400], ['bad-product', 400], ['apple-unavailable', 503]] as const) {
        const { d, created } = deps({ verify: async () => { throw new VerifyFailure(code); } });
        expect((await runSignup(good, 'ip', d)).status).toBe(status);
        expect(created).toHaveLength(0);
      }
    });

    it('an inactive (expired) or revoked purchase is 402 and creates nothing', async () => {
      const expired = deps({ verify: async () => ({ ...TX, expiresAt: NOW - 1000, status: 2 }) });
      expect(await runSignup(good, 'ip', expired.d)).toEqual({ status: 402, body: { error: 'subscription-inactive' } });
      const revoked = deps({ verify: async () => ({ ...TX, revoked: true }) });
      expect((await runSignup(good, 'ip', revoked.d)).status).toBe(402);
      const stored = deps({ getPurchase: async () => row({ revoked_at: '2026-10-01T00:00:00Z' }) });
      expect((await runSignup(good, 'ip', stored.d)).status).toBe(402);
      expect(expired.created.length + revoked.created.length + stored.created.length).toBe(0);
    });

    it('a purchase linked to ANOTHER account no longer blocks the new account (it moves via /api/ios/transfer); a legacy unlinked purchase with a site is still 409', async () => {
      const linked = deps({ getPurchase: async () => row({ user_id: '11111111-1111-4111-8111-111111111111', site_slug: 'fade-lab' }) });
      expect(await runSignup(good, 'ip', linked.d)).toEqual({ status: 200, body: { ok: true, email: 'sam@example.com' } });
      expect(linked.created).toHaveLength(1);
      const bound = deps({ getPurchase: async () => row({ site_slug: 'fade-lab' }) });
      expect(await runSignup(good, 'ip', bound.d)).toEqual({ status: 409, body: { error: 'purchase-has-site' } });
      expect(bound.created).toHaveLength(0);
    });

    it('an active unlinked purchase (row present or not yet recorded) creates the account', async () => {
      expect((await runSignup(good, 'ip', deps({ getPurchase: async () => row() }).d)).status).toBe(200);
      expect((await runSignup(good, 'ip', deps().d)).status).toBe(200);
    });

    it('the cap is keyed on originalTransactionId (not the transactionId sent) and is 3 per purchase', async () => {
      expect(MAX_SIGNUPS_PER_PURCHASE).toBe(3);
      const store = memoryStore();
      const seen: string[] = [];
      const allowForPurchase = async (otid: string) => { seen.push(otid); return store.hit(`tx:${otid}`, MAX_SIGNUPS_PER_PURCHASE, 1000, 1) as boolean; };
      const { d, created } = deps({ allowForPurchase });
      const statuses = [];
      for (let i = 0; i < 5; i++) statuses.push((await runSignup({ ...good, email: `u${i}@example.com`, transactionId: `99${i}` }, 'ip', d)).status);
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      expect(new Set(seen)).toEqual(new Set([TX.originalTransactionId]));
      expect(created).toHaveLength(3);
    });
  });
});
