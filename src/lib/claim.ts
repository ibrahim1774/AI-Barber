import { ApiError, type api } from '@/lib/api';
import { OFFLINE } from '@/lib/auth';
import type { PublishOutcome } from '@/lib/publish';
import type { PlanHint } from '@/lib/publishRequest';
import type { ClaimField, ClaimMode, ClaimValues } from '@/lib/claimValidation';
import { normalizePhone, validateClaim } from '@/lib/claimValidation';
import { CLAIMED_SIGNED_OUT_MESSAGE } from '@/lib/claimCopy';
import { trackRegistration } from '@/lib/analytics';

/** What the locked account step shows while the request cannot reach the server. */
export const WAITING_MESSAGE = 'Waiting for connection. Your payment is safe; we’ll finish publishing as soon as you’re back online.';
export const EMAIL_EXISTS_MESSAGE = 'An account with this email already exists.';
export const RATE_LIMITED_MESSAGE = 'Too many tries. Wait a minute and try again.';
export const SIGNUP_UNAVAILABLE_MESSAGE = 'We couldn’t create your account just now. Try again in a moment.';
export const SESSION_EXPIRED_MESSAGE = 'Your sign-in expired. Sign in again to finish publishing.';
export const SIGNUP_LIMIT_MESSAGE =
  'Too many accounts have been created with this purchase. Sign in to the account you already made, or contact support@davoxa.com.';
export const NO_PURCHASE_MESSAGE = "We couldn't find your purchase yet. Check your connection and try again in a moment.";
export const INACTIVE_MESSAGE =
  "Your payment didn't go through, or it was refunded, so the website can't go live. Subscribe again from the editor to publish it.";

/** The account step's patience: it keeps retrying a transient publish for this long, backing off 2 s -> 10 s. */
export const WAIT_BUDGET_MS = 3 * 60 * 1000;
const BACKOFF_FIRST_MS = 2000;
const BACKOFF_MAX_MS = 10_000;
/** Overridable by tests; the screen uses these defaults. */
export const waitConfig = {
  budgetMs: WAIT_BUDGET_MS,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};
/** Said once the wait ran out: calm, nothing is lost, one button. */
export const STILL_PUBLISHING_MESSAGE =
  'Your site is still being published. This is taking longer than usual. Your payment is safe and your account is ready. Tap Try again in a moment.';

/** How one submit of the account form ended. The form stays on screen for everything but `live` and `moved-on`. */
export type ClaimResult =
  | { kind: 'live'; planHint?: PlanHint }
  /** Nothing left to publish, or an admin edit was adopted: leave for the editor. */
  | { kind: 'moved-on' }
  | { kind: 'invalid'; errors: Partial<Record<ClaimField, string>> }
  /** The server rejected one field (or the account exists): show it under the field. */
  | { kind: 'field'; field: ClaimField; message: string }
  /** Signing up found the email taken: offer "Sign in instead", the email stays. */
  | { kind: 'email-exists'; email: string }
  /** The request could not reach the server; the session (if any) is kept and a retry finishes it. */
  | { kind: 'waiting'; message: string; stage: 'account' | 'publish' }
  /** The server refused the publish (409): the message names the masked owner or the live site. Stays locked. */
  | { kind: 'blocked'; message: string; movable?: boolean }
  | { kind: 'inactive'; message: string }
  /** The publish was still not ready after the whole wait: the session and the pending publish are kept; "Try again" resumes. */
  | { kind: 'stalled'; message: string }
  /** Any other failure: the words to show; the form stays. */
  | { kind: 'error'; message: string };

export interface ClaimDeps {
  signup: typeof api.signup;
  /** The verified purchase's transactionId the pending publish holds (the server's signup requires it). */
  transactionId(): Promise<string | null>;
  /** auth.signIn: also pulls / switches the account's site. Throws an Error with a friendly message. */
  signIn(email: string, password: string): Promise<void>;
  /** resumePendingPublish with the real publish deps: sends the pending publish with the account's Bearer. */
  finish(): Promise<PublishOutcome | null>;
  /** Ends a session the server does not accept. */
  dropSession(): Promise<void>;
  /** The server says the purchase is inactive (402): the pending record is dropped so nothing locks to /claim. */
  parkInactive?(): Promise<void>;
  /** The account step is done (signed in): the screen switches from the form to "Publishing your site". */
  onSession?(): void;
}

/**
 * The account step's engine, one per screen. `submit` creates the account (sign up) or signs in, then sends the
 * pending publish with the new session. Double-tap safe: while one run is in flight, another call returns the same
 * promise. A sign up that succeeded but could not sign in (offline) is remembered, so a retry only signs in: the
 * server would answer 409 email-exists to a second sign up.
 */
export function createClaimRunner(deps: ClaimDeps) {
  let inflight: Promise<ClaimResult> | null = null;
  let created: { email: string; password: string } | null = null;
  let stopped = false;

  const once = (fn: () => Promise<ClaimResult>): Promise<ClaimResult> => {
    if (inflight) return inflight;
    stopped = false;
    const p = fn().finally(() => {
      inflight = null;
    });
    inflight = p;
    return p;
  };

  /**
   * Sends the pending publish and, while the answer is a transient one (still deploying, Apple catching up, server
   * busy, a timeout), tries again by itself with a growing pause, for up to the wait budget. One attempt at a time
   * (finish is serial and this whole run is deduplicated), so retries never overlap or publish twice.
   */
  async function publish(): Promise<ClaimResult> {
    const started = waitConfig.now();
    let delay = BACKOFF_FIRST_MS;
    // Once the screen is gone (stop), nothing more is sent or settled: a late answer must not steer navigation.
    const gone: ClaimResult = { kind: 'stalled', message: STILL_PUBLISHING_MESSAGE };
    for (;;) {
      let out: PublishOutcome | null;
      try {
        out = await deps.finish();
      } catch {
        return stopped ? gone : { kind: 'error', message: 'Something went wrong publishing your site. Please try again.' };
      }
      if (stopped) return gone;
      const transient = out?.kind === 'pending' && (out.transient === true || out.offline === true);
      if (!transient) return settle(out);
      // The budget is real elapsed time (attempts included, on the injected clock), not just the pauses.
      if (waitConfig.now() - started + delay > waitConfig.budgetMs) return settle(out, true);
      await waitConfig.sleep(delay);
      if (stopped) return gone;
      delay = Math.min(delay * 2, BACKOFF_MAX_MS);
    }
  }

  async function settle(out: PublishOutcome | null, exhausted = false): Promise<ClaimResult> {
    if (!out) return { kind: 'moved-on' };
    switch (out.kind) {
      case 'live': return { kind: 'live', ...(out.planHint ? { planHint: out.planHint } : {}) };
      case 'site-updated': return { kind: 'moved-on' };
      case 'blocked': return { kind: 'blocked', message: out.message, ...(out.movable ? { movable: true } : {}) };
      case 'inactive': return { kind: 'inactive', message: INACTIVE_MESSAGE };
      case 'pending':
        if (out.offline) return { kind: 'waiting', message: WAITING_MESSAGE, stage: 'publish' };
        return exhausted || out.transient ? { kind: 'stalled', message: STILL_PUBLISHING_MESSAGE } : { kind: 'error', message: out.message };
      case 'claim-required':
        // The server refused the session: sign out of it so the form takes a fresh sign-in.
        await deps.dropSession().catch(() => {});
        return { kind: 'error', message: SESSION_EXPIRED_MESSAGE };
      default:
        return { kind: 'error', message: 'Something went wrong. Please try again.' };
    }
  }

  async function account(mode: ClaimMode, v: ClaimValues): Promise<ClaimResult> {
    const errors = validateClaim(mode, v);
    if (Object.keys(errors).length) return { kind: 'invalid', errors };
    const email = v.email.trim();
    let signInEmail = email;
    if (mode === 'signup') {
      if (created && created.email.toLowerCase() === email.toLowerCase() && created.password === v.password) {
        signInEmail = created.email;
      } else {
        let transactionId: string | null = null;
        try {
          transactionId = await deps.transactionId();
        } catch {
          transactionId = null;
        }
        if (!transactionId) return { kind: 'waiting', message: NO_PURCHASE_MESSAGE, stage: 'account' };
        try {
          const r = await deps.signup({ name: v.name.trim(), email, phone: normalizePhone(v.phone)!, password: v.password, transactionId });
          created = { email: r.email || email, password: v.password };
          signInEmail = created.email;
          trackRegistration('email');
        } catch (e) {
          const failure = signupFailure(e, email);
          if (failure.kind === 'inactive') await deps.parkInactive?.().catch(() => {});
          return failure;
        }
      }
    }
    try {
      await deps.signIn(signInEmail, v.password);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong. Please try again.';
      if (message === OFFLINE) return { kind: 'waiting', message: WAITING_MESSAGE, stage: 'account' };
      return { kind: 'error', message };
    }
    deps.onSession?.();
    return publish();
  }

  return {
    /** Stops waiting between retries (the screen went away). */
    stop: () => { stopped = true; },
    /** Sign up or sign in, then publish. */
    submit: (mode: ClaimMode, v: ClaimValues) => once(() => account(mode, v)),
    /** Signed in already (a relaunch, a password reset, a retry after "waiting"): just send the pending publish. */
    finish: () => once(() => { deps.onSession?.(); return publish(); }),
  };
}

function signupFailure(e: unknown, email: string): ClaimResult {
  if (!(e instanceof ApiError)) return { kind: 'error', message: SIGNUP_UNAVAILABLE_MESSAGE };
  if (e.status === 0) return { kind: 'waiting', message: WAITING_MESSAGE, stage: 'account' };
  if (e.status === 409 && e.code === 'email-exists') return { kind: 'email-exists', email };
  // The purchase is refunded / expired / revoked: no account is made for it.
  if (e.status === 402) return { kind: 'inactive', message: INACTIVE_MESSAGE };
  // The purchase already belongs to an account: only that account can finish it.
  if (e.status === 409 && (e.code === 'purchase-in-use' || e.code === 'purchase-claimed' || e.code === 'purchase-has-site' || e.code === 'purchase-other-account')) {
    return { kind: 'blocked', message: CLAIMED_SIGNED_OUT_MESSAGE };
  }
  if (e.code === 'signup-limit' || e.code === 'signup-limit-reached') return { kind: 'error', message: SIGNUP_LIMIT_MESSAGE };
  if (e.status === 429) return { kind: 'error', message: RATE_LIMITED_MESSAGE };
  if (e.code === 'weak-password') return { kind: 'field', field: 'password', message: `Use at least ${e.body?.minLength ?? 8} characters.` };
  if (e.status === 400 && e.code === 'bad-request') {
    const field = e.body?.field;
    if (field === 'name') return { kind: 'field', field: 'name', message: 'Enter your name.' };
    if (field === 'email') return { kind: 'field', field: 'email', message: 'That email address doesn’t look right. Check it and try again.' };
    if (field === 'phone') return { kind: 'field', field: 'phone', message: 'Enter a phone number with at least 7 digits.' };
  }
  return { kind: 'error', message: SIGNUP_UNAVAILABLE_MESSAGE };
}
