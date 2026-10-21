/**
 * Password recovery helpers with no app dependencies (Jest-tested): reading
 * Supabase's recovery link, the Resend cooldown, and scrubbing URLs before
 * they reach analytics. The link carries live tokens in its fragment, so
 * nothing here ever logs a URL.
 */

/** Where Supabase sends the recovery link (must be on the project's Redirect URLs allow-list). */
export const RESET_REDIRECT = 'aibarber://reset-password';

/** Seconds between two reset emails from /forgot-password. */
export const RESEND_COOLDOWN_S = 60;

export type RecoveryLink =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

const DEFAULT_ERROR = 'This reset link has expired or was already used.';

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

function params(part: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = decode(eq < 0 ? pair : pair.slice(0, eq));
    const value = eq < 0 ? '' : decode(pair.slice(eq + 1));
    if (key && !out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * The recovery link Supabase's implicit flow opens:
 *   aibarber://reset-password#access_token=…&refresh_token=…&type=recovery
 *   aibarber://reset-password#error=…&error_code=otp_expired&error_description=…
 * Anything else (no fragment, a malformed URL, a non-recovery session) is
 * 'none'. An error in the query string counts too (some GoTrue errors use it).
 */
export function parseRecoveryUrl(url: string | null | undefined): RecoveryLink {
  if (typeof url !== 'string' || !url) return { kind: 'none' };
  const hash = url.indexOf('#');
  const fragment = hash < 0 ? '' : url.slice(hash + 1);
  const beforeHash = hash < 0 ? url : url.slice(0, hash);
  const q = beforeHash.indexOf('?');
  const query = q < 0 ? '' : beforeHash.slice(q + 1);
  const f = params(fragment);
  const qs = params(query);

  const error = f.get('error') ?? f.get('error_code') ?? qs.get('error') ?? qs.get('error_code');
  if (error !== undefined) {
    const description = f.get('error_description') ?? qs.get('error_description');
    return { kind: 'error', message: description?.trim() || DEFAULT_ERROR };
  }

  const accessToken = f.get('access_token');
  const refreshToken = f.get('refresh_token');
  const type = f.get('type');
  if (accessToken && refreshToken && (type === undefined || type === 'recovery')) {
    return { kind: 'session', accessToken, refreshToken };
  }
  return { kind: 'none' };
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
