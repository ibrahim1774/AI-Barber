import { isValidEmail } from '@/lib/recovery';

/** The account step's password rule (the server's /api/ios/signup: 8 to 72 characters). */
export const CLAIM_MIN_PASSWORD = 8;
export const CLAIM_MAX_PASSWORD = 72;

export type ClaimMode = 'signup' | 'signin';
export type ClaimField = 'name' | 'email' | 'phone' | 'password' | 'confirm';
export type ClaimErrors = Partial<Record<ClaimField, string>>;

export interface ClaimValues {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
}

/**
 * The phone as the server (lib/ios/signup.ts normalizePhone) accepts it: digits with an optional leading +,
 * 7 to 15 digits, spaces / dashes / dots / parentheses stripped. null: not a phone number.
 */
export function cleanPhone(raw: string): string | null {
  const t = raw.trim();
  if (t.length > 40 || /[^\d\s\-().+]/.test(t)) return null;
  const plus = t.startsWith('+');
  if (t.slice(1).includes('+')) return null;
  const digits = t.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (plus && digits.startsWith('0')) return null; // E.164 country codes never start with 0
  return (plus ? '+' : '') + digits;
}

/**
 * E.164 for the server: a typed + keeps its country code; a bare US number (10 digits, or 11 starting with 1)
 * gets +1; any other bare number of 11 or more digits is taken to start with its country code. 7 to 9 digits
 * cannot be placed and go as typed (the server stores them normalised, without a +). null: not a phone number.
 */
export function normalizePhone(raw: string): string | null {
  const c = cleanPhone(raw);
  if (!c || c.startsWith('+')) return c;
  if (c.length === 10) return `+1${c}`;
  if (c.length >= 11) return `+${c}`;
  return c;
}

export const NAME_REQUIRED = 'Enter your name.';
export const EMAIL_REQUIRED = 'Enter your email address.';
export const EMAIL_INVALID = 'That email address doesn’t look right. Check it and try again.';
export const PHONE_INVALID = 'Enter a phone number with at least 7 digits.';
export const PASSWORD_REQUIRED = 'Enter your password.';
export const PASSWORD_SHORT = `Use at least ${CLAIM_MIN_PASSWORD} characters.`;
export const PASSWORD_LONG = `Use ${CLAIM_MAX_PASSWORD} characters or fewer.`;
export const CONFIRM_REQUIRED = 'Enter your password again.';
export const CONFIRM_DIFFERENT = 'The passwords don’t match.';

/**
 * Every problem with the account form at once (shown inline under each field), in on-screen order.
 * Sign up needs all four fields (name, email, phone, password + confirmation); sign in only email + password.
 * An empty object means the form is good to send.
 */
export function validateClaim(mode: ClaimMode, v: ClaimValues): ClaimErrors {
  const e: ClaimErrors = {};
  if (mode === 'signup' && !v.name.trim()) e.name = NAME_REQUIRED;
  if (!v.email.trim()) e.email = EMAIL_REQUIRED;
  else if (!isValidEmail(v.email)) e.email = EMAIL_INVALID;
  if (mode === 'signup' && cleanPhone(v.phone) == null) e.phone = PHONE_INVALID;
  if (mode === 'signin') {
    if (!v.password) e.password = PASSWORD_REQUIRED;
  } else if (!v.password) e.password = PASSWORD_REQUIRED;
  else if (v.password.length < CLAIM_MIN_PASSWORD) e.password = PASSWORD_SHORT;
  else if (v.password.length > CLAIM_MAX_PASSWORD) e.password = PASSWORD_LONG;
  if (mode === 'signup' && !e.password) {
    if (!v.confirm) e.confirm = CONFIRM_REQUIRED;
    else if (v.confirm !== v.password) e.confirm = CONFIRM_DIFFERENT;
  }
  return e;
}

/** The first field with a problem, in on-screen order (where focus goes). */
export function firstErrorField(e: ClaimErrors): ClaimField | null {
  return (['name', 'email', 'phone', 'password', 'confirm'] as const).find((f) => e[f]) ?? null;
}
