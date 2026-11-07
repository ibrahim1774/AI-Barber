import { describe, it, expect } from 'vitest';
import { CONTINUE_TTL_MS, signContinueToken, signUnsubscribeToken, verifyContinueToken, verifyUnsubscribeToken } from '../../lib/webApp/nudgeToken.js';

const S = 'test-secret-1234567890';
const U = '11111111-2222-3333-4444-555555555555';
const T0 = 1_800_000_000_000;

describe('continue token', () => {
  it('round-trips user, step and expiry', () => {
    const t = signContinueToken(U, 2, T0, S);
    expect(verifyContinueToken(t, { now: T0 + 1000, secret: S })).toEqual({ ok: true, userId: U, step: 2, expiresAt: T0 + CONTINUE_TTL_MS });
  });
  it('is bound to user and step when the caller expects them', () => {
    const t = signContinueToken(U, 1, T0, S);
    expect(verifyContinueToken(t, { now: T0, secret: S, expect: { userId: U, step: 1 } }).ok).toBe(true);
    expect(verifyContinueToken(t, { now: T0, secret: S, expect: { userId: 'other' } })).toEqual({ ok: false, reason: 'wrong_user' });
    expect(verifyContinueToken(t, { now: T0, secret: S, expect: { step: 3 } })).toEqual({ ok: false, reason: 'wrong_step' });
  });
  it('expires at the 7 day mark', () => {
    const t = signContinueToken(U, 3, T0, S);
    expect(verifyContinueToken(t, { now: T0 + CONTINUE_TTL_MS - 1, secret: S }).ok).toBe(true);
    expect(verifyContinueToken(t, { now: T0 + CONTINUE_TTL_MS, secret: S })).toEqual({ ok: false, reason: 'expired' });
  });
  it('rejects tampering with payload (user, step, expiry) or signature', () => {
    const t = signContinueToken(U, 1, T0, S);
    const [p, m] = t.split('.');
    const forged = (patch: object) => `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), ...patch })).toString('base64url')}.${m}`;
    for (const patch of [{ u: 'attacker' }, { s: 3 }, { e: T0 + 10 * CONTINUE_TTL_MS }]) {
      expect(verifyContinueToken(forged(patch), { now: T0, secret: S })).toEqual({ ok: false, reason: 'bad_signature' });
    }
    expect(verifyContinueToken(`${p}.${m.slice(0, -2)}AA`, { now: T0, secret: S })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyContinueToken(`${p}.`, { now: T0, secret: S })).toEqual({ ok: false, reason: 'malformed' });
  });
  it('a different secret never verifies; a missing secret fails closed', () => {
    const t = signContinueToken(U, 1, T0, S);
    expect(verifyContinueToken(t, { now: T0, secret: 'other-secret' })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyContinueToken(t, { now: T0, secret: '' }).ok).toBe(false);
    expect(() => signContinueToken(U, 1, T0, '')).toThrow();
  });
  it('rejects junk input without throwing', () => {
    for (const j of [undefined, null, 5, '', 'abc', 'a.b.c', '.', 'x'.repeat(1000)]) expect(verifyContinueToken(j, { now: T0, secret: S }).ok).toBe(false);
  });
  it('an unsubscribe token is not accepted as a continue token (domain separation)', () => {
    expect(verifyContinueToken(signUnsubscribeToken('a@b.co', S), { now: T0, secret: S }).ok).toBe(false);
  });
  it('tokens differ per call (nonce)', () => {
    expect(signContinueToken(U, 1, T0, S)).not.toBe(signContinueToken(U, 1, T0, S));
  });
});

describe('unsubscribe token', () => {
  it('round-trips and lowercases', () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken('  Jake@Gmail.COM ', S), S)).toBe('jake@gmail.com');
  });
  it('is stable for the same address (no expiry, no nonce)', () => {
    expect(signUnsubscribeToken('a@b.co', S)).toBe(signUnsubscribeToken('A@B.co', S));
  });
  it('rejects tampering, wrong secret and junk', () => {
    const t = signUnsubscribeToken('a@b.co', S);
    const [, m] = t.split('.');
    expect(verifyUnsubscribeToken(`${Buffer.from('c@d.co').toString('base64url')}.${m}`, S)).toBeNull();
    expect(verifyUnsubscribeToken(t, 'nope')).toBeNull();
    expect(verifyUnsubscribeToken(t, '')).toBeNull();
    for (const j of [undefined, null, '', 'x', 'a.b.c']) expect(verifyUnsubscribeToken(j, S)).toBeNull();
  });
  it('a continue token is not accepted as an unsubscribe token', () => {
    expect(verifyUnsubscribeToken(signContinueToken(U, 1, T0, S), S)).toBeNull();
  });
});

describe('token source', () => {
  it('uses timingSafeEqual for the signature compare', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../lib/webApp/nudgeToken.ts', import.meta.url), 'utf8'));
    expect(src).toMatch(/timingSafeEqual\(g, expected\)/);
    expect(src).not.toMatch(/console\./);
  });
});
