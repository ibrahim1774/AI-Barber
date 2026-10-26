// POST /api/ios/signup { name, email, phone, password } (pay-then-sign-up, owner ruling Q4: NO email
// verification). The paying customer is mid-flow with a purchase in hand, so the account is created
// already confirmed through the Supabase admin API (service role, server only), then the app signs in
// with email + password. Nothing in the dashboard auth settings is touched: the project is shared with
// the web app, whose own sign-up still sends its confirmation mail.
//
// - name / phone go to user_metadata ({ full_name, name, phone }), the same keys the web sign-up
//   writes, so api/sync-auth-phone.ts and the admin dashboard read them unchanged.
// - rate limited per IP and per email (handler); weak passwords (< 8) and bad phones rejected here.
// - an existing email answers 409 { error: 'email-exists' }; nothing else about existing accounts leaks.
// - H3 (pay-then-sign-up review): the body must carry the purchase's transactionId. It is verified
//   with Apple, must be active and not linked / bound to a site (the claim-start check), and each
//   originalTransactionId can create at most MAX_SIGNUPS_PER_PURCHASE accounts. The limiters fail
//   CLOSED (503) so nobody gets an unproven confirmed account when the limit store is down.
// - responses never carry a token, id, password, key or any user_metadata.

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72; // bcrypt truncates past 72 bytes; refuse rather than silently weaken
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

import { VerifyFailure, isActive, type VerifiedTx } from './appleVerify.js';
import type { PurchaseRow } from './purchases.js';

export const MAX_SIGNUPS_PER_PURCHASE = 3;

export interface SignupInput { transactionId?: unknown; name?: unknown; email?: unknown; phone?: unknown; password?: unknown }

export type SignupResult =
  | { status: 200; body: { ok: true; email: string } }
  | { status: 400; body: { error: 'bad-request'; field: 'name' | 'email' | 'phone' | 'password' } }
  | { status: 400; body: { error: 'weak-password'; minLength: number } }
  | { status: 400 | 402 | 404 | 409 | 503; body: { error: string; reason?: string } }
  | { status: 409; body: { error: 'email-exists' } }
  | { status: 429; body: { error: 'rate-limited' } }
  | { status: 503; body: { error: 'temporarily-unavailable' } };

export interface SignupDeps {
  /** Supabase admin createUser with email_confirm:true. Resolves { exists:true } for a taken email. */
  createUser(u: { email: string; password: string; metadata: { full_name: string; name: string; phone: string } }): Promise<{ exists: boolean }>;
  /** Both limits must pass: the caller's IP and the email. Throws -> fail CLOSED (503). */
  allow(ip: string, emailKey: string): Promise<boolean>;
  /** Apple verification of the purchase the account is being created for. */
  verify(transactionId: string): Promise<VerifiedTx>;
  /** The stored purchase row (null when claim-start never recorded it). Throws -> 503. */
  getPurchase(originalTransactionId: string): Promise<PurchaseRow | null>;
  /** Count one account creation against this purchase; false once MAX_SIGNUPS_PER_PURCHASE is used. Throws -> fail CLOSED (503). */
  allowForPurchase(originalTransactionId: string): Promise<boolean>;
  now(): number;
}

/** Digits with an optional leading +, 7 to 15 digits (E.164 max). Spaces, dashes, dots, parentheses are stripped. */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = v.trim();
  if (/[^\d\s\-().+]/.test(t)) return null;
  const plus = t.startsWith('+');
  if (t.slice(1).includes('+')) return null;
  const digits = t.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (plus && digits.startsWith('0')) return null; // E.164 country codes never start with 0
  return (plus ? '+' : '') + digits;
}

export async function runSignup(input: SignupInput | null, ip: string, deps: SignupDeps): Promise<SignupResult> {
  const b = (input && typeof input === 'object' ? input : {}) as SignupInput;
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 100) return { status: 400, body: { error: 'bad-request', field: 'name' } };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return { status: 400, body: { error: 'bad-request', field: 'email' } };
  const phone = normalizePhone(b.phone);
  if (!phone) return { status: 400, body: { error: 'bad-request', field: 'phone' } };
  const password = typeof b.password === 'string' ? b.password : '';
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
    return { status: 400, body: { error: 'weak-password', minLength: MIN_PASSWORD } };
  }

  // Validation first (free), then the IP/email limiter, then proof of payment, then the per-purchase cap.
  const transactionId = typeof b.transactionId === 'string' ? b.transactionId.trim() : '';
  if (!transactionId || transactionId.length > 64) return { status: 400, body: { error: 'bad-request' } };

  // Per-IP / per-email limit before Apple is asked. A limiter error refuses (fail closed).
  try {
    if (!(await deps.allow(ip, email))) return { status: 429, body: { error: 'rate-limited' } };
  } catch (e: any) {
    console.error('[ios/signup] rate limiter failed, refusing (fail closed):', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }

  let otid: string;
  try {
    const tx = await deps.verify(transactionId);
    if (tx.revoked) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };
    if (!isActive(tx, deps.now())) return { status: 402, body: { error: 'subscription-inactive' } };
    otid = tx.originalTransactionId;
  } catch (e: any) {
    if (e instanceof VerifyFailure) {
      const status = ({ 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const)[e.code];
      return { status, body: { error: e.code } };
    }
    console.error('[ios/signup] verify threw unexpectedly:', e?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  try {
    const row = await deps.getPurchase(otid);
    if (row?.revoked_at) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };
    if (row?.user_id) return { status: 409, body: { error: 'purchase-claimed' } };
    if (row?.site_slug) return { status: 409, body: { error: 'purchase-has-site' } };
  } catch (e: any) {
    console.error(`[ios/signup] ${otid}: purchase read failed:`, e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }

  try {
    if (!(await deps.allowForPurchase(otid))) return { status: 429, body: { error: 'rate-limited' } };
  } catch (e: any) {
    console.error('[ios/signup] purchase cap check failed, refusing (fail closed):', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }

  try {
    const r = await deps.createUser({ email, password, metadata: { full_name: name, name, phone } });
    if (r.exists) return { status: 409, body: { error: 'email-exists' } };
    return { status: 200, body: { ok: true, email } };
  } catch (e: any) {
    console.error('[ios/signup] createUser failed:', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}
