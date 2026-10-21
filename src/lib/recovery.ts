/**
 * Password recovery helpers with no app dependencies (Jest-tested): the
 * emailed code, the Resend cooldown, email checks, and scrubbing URLs before
 * they reach analytics. Recovery is a code typed into the app, never a link
 * into it, so no session token ever travels in a URL the app opens.
 */

/** Seconds between two reset emails from /forgot-password. */
export const RESEND_COOLDOWN_S = 60;

/** Supabase's email OTP length is configurable from 6 to 10 digits. */
export const CODE_MIN = 6;
export const CODE_MAX = 10;

/** What the code field keeps of what was typed or pasted: digits only, at most 10. */
export function sanitizeCode(input: string): string {
  return input.replace(/\D+/g, '').slice(0, CODE_MAX);
}

/** A code with an acceptable length (after sanitizeCode). */
export function isCodeComplete(code: string): boolean {
  return /^\d+$/.test(code) && code.length >= CODE_MIN && code.length <= CODE_MAX;
}

/** Whole seconds left before Resend is allowed again (0 = now). */
export function cooldownLeft(sentAt: number | null, now: number, cooldownS = RESEND_COOLDOWN_S): number {
  if (sentAt == null || !Number.isFinite(sentAt)) return 0;
  const left = Math.ceil((sentAt + cooldownS * 1000 - now) / 1000);
  return Math.max(0, Math.min(cooldownS, left));
}

/** A plausible email address (the server has the final say). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** A URL with its query and fragment removed (where tokens live). Non-URLs pass through. */
export function scrubUrl(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return value.replace(/[?#][\s\S]*$/, '');
}

type AnyEvent = { properties?: Record<string, unknown> } & Record<string, unknown>;

/**
 * PostHog before_send: every URL-looking string property loses its query
 * and fragment. PostHog's own "Application Opened" carries the launch URL,
 * which for a recovery link would hold the session tokens.
 */
export function scrubEventUrls<E extends AnyEvent | null>(event: E): E {
  if (!event || !event.properties) return event;
  let changed = false;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event.properties)) {
    const clean = typeof v === 'string' ? scrubUrl(v) : v;
    if (clean !== v) changed = true;
    props[k] = clean;
  }
  return changed ? ({ ...event, properties: props } as E) : event;
}

// The email typed on /sign-in, handed to /forgot-password in memory (never in a route URL).
let prefill = '';
export function setPrefillEmail(email: string): void {
  prefill = email.trim();
}
/** Returns the handed-over email once, then forgets it. */
export function takePrefillEmail(): string {
  const e = prefill;
  prefill = '';
  return e;
}
