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
// - responses never carry a token, id, password, key or any user_metadata.

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72; // bcrypt truncates past 72 bytes; refuse rather than silently weaken
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export interface SignupInput { name?: unknown; email?: unknown; phone?: unknown; password?: unknown }

export type SignupResult =
  | { status: 200; body: { ok: true; email: string } }
  | { status: 400; body: { error: 'bad-request'; field: 'name' | 'email' | 'phone' | 'password' } }
  | { status: 400; body: { error: 'weak-password'; minLength: number } }
  | { status: 409; body: { error: 'email-exists' } }
  | { status: 429; body: { error: 'rate-limited' } }
  | { status: 503; body: { error: 'temporarily-unavailable' } };

export interface SignupDeps {
  /** Supabase admin createUser with email_confirm:true. Resolves { exists:true } for a taken email. */
  createUser(u: { email: string; password: string; metadata: { full_name: string; name: string; phone: string } }): Promise<{ exists: boolean }>;
  /** Both limits must pass: the caller's IP and the email. Throws -> fail open (handler logs). */
  allow(ip: string, emailKey: string): Promise<boolean>;
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

  // Validation first (free), then the limiter, then the one expensive call.
  let allowed = true;
  try {
    allowed = await deps.allow(ip, email);
  } catch (e: any) {
    console.error('[ios/signup] rate limiter failed, allowing:', e?.message || e);
  }
  if (!allowed) return { status: 429, body: { error: 'rate-limited' } };

  try {
    const r = await deps.createUser({ email, password, metadata: { full_name: name, name, phone } });
    if (r.exists) return { status: 409, body: { error: 'email-exists' } };
    return { status: 200, body: { ok: true, email } };
  } catch (e: any) {
    console.error('[ios/signup] createUser failed:', e?.message || e);
    return { status: 503, body: { error: 'temporarily-unavailable' } };
  }
}
