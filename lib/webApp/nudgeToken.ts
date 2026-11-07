// Signed tokens for the sign-up reminder emails. HMAC-SHA256 with WEB_APP_NUDGE_SECRET, domain-separated per use
// so a continue token can never be replayed as an unsubscribe token (or the other way round).
//   continue : base64url(JSON{v,u,s,n,e}) + '.' + base64url(HMAC)   bound to user + step + expiry
//   unsub    : base64url(lowercased email) + '.' + base64url(HMAC)   no expiry (an unsubscribe link must keep working)
// Verification compares MACs with timingSafeEqual. Tokens are never logged: callers log user id + step only.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONTINUE_TTL_MS = 7 * 24 * 3600_000;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const secretOf = (secret?: string) => secret ?? process.env.WEB_APP_NUDGE_SECRET ?? '';
const mac = (domain: string, payload: string, secret: string) => createHmac('sha256', secret).update(`${domain}:${payload}`).digest();

/** Constant-time compare of a presented base64url MAC against the expected one. */
function macOk(given: string, expected: Buffer): boolean {
  const g = Buffer.from(given, 'base64url');
  if (g.length !== expected.length) {
    timingSafeEqual(expected, expected); // keep the work comparable on a length mismatch
    return false;
  }
  return timingSafeEqual(g, expected);
}

export type ContinueFail = 'malformed' | 'bad_signature' | 'expired' | 'wrong_user' | 'wrong_step' | 'wrong_mode' | 'no_secret';
export type ContinueResult = { ok: true; userId: string; step: 1 | 2 | 3; expiresAt: number } | { ok: false; reason: ContinueFail };

export function signContinueToken(userId: string, step: 1 | 2 | 3, mode: 'live' | 'test', now = Date.now(), secret?: string, ttlMs = CONTINUE_TTL_MS): string {
  const s = secretOf(secret);
  if (!s) throw new Error('WEB_APP_NUDGE_SECRET missing');
  const payload = b64(JSON.stringify({ v: 1, u: userId, s: step, m: mode, n: randomBytes(8).toString('hex'), e: now + ttlMs }));
  return `${payload}.${b64(mac('continue', payload, s))}`;
}

/** Verifies signature first, then expiry; `expect` additionally binds the token to a user and/or step. */
export function verifyContinueToken(token: unknown, opts: { now?: number; secret?: string; /** The verifier's Stripe mode: a token minted under the other mode is refused (staging and production share Supabase). */ mode: 'live' | 'test'; expect?: { userId?: string; step?: number } }): ContinueResult {
  const s = secretOf(opts.secret);
  if (!s) return { ok: false, reason: 'no_secret' };
  if (typeof token !== 'string' || token.length > 600) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  if (!macOk(parts[1], mac('continue', parts[0], s))) return { ok: false, reason: 'bad_signature' };
  let p: any;
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!p || p.v !== 1 || typeof p.u !== 'string' || !p.u || ![1, 2, 3].includes(p.s) || typeof p.e !== 'number' || (p.m !== 'live' && p.m !== 'test')) return { ok: false, reason: 'malformed' };
  if ((opts.now ?? Date.now()) >= p.e) return { ok: false, reason: 'expired' };
  if (p.m !== opts.mode) return { ok: false, reason: 'wrong_mode' };
  if (opts.expect?.userId !== undefined && opts.expect.userId !== p.u) return { ok: false, reason: 'wrong_user' };
  if (opts.expect?.step !== undefined && opts.expect.step !== p.s) return { ok: false, reason: 'wrong_step' };
  return { ok: true, userId: p.u, step: p.s, expiresAt: p.e };
}

const normEmail = (e: string) => e.trim().toLowerCase();

export function signUnsubscribeToken(email: string, secret?: string): string {
  const s = secretOf(secret);
  if (!s) throw new Error('WEB_APP_NUDGE_SECRET missing');
  const payload = b64(normEmail(email));
  return `${payload}.${b64(mac('unsub', payload, s))}`;
}

/** The lowercased email when the token is genuine, else null. */
export function verifyUnsubscribeToken(token: unknown, secret?: string): string | null {
  const s = secretOf(secret);
  if (!s || typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!macOk(parts[1], mac('unsub', parts[0], s))) return null;
  const email = Buffer.from(parts[0], 'base64url').toString('utf8');
  return email && email === normEmail(email) ? email : null;
}
