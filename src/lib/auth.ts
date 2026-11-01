import { Platform } from 'react-native';
import { webDraftsEnabled } from './webReliability';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { identifyUser, resetUser, track, trackRegistration } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  UNSAVED_OTHER_ACCOUNT, clearSiteAfterSignOut, pullSiteFromAccount, pushSiteBeforeSignOut, switchAccountSite, syncIfSignedIn,
} from '@/lib/account';
import type { SwitchResult } from '@/lib/account';
import { clearCustomersCache } from '@/lib/bookings/customersCache';
import { unregisterPushToken } from '@/lib/bookings/pushStamp';
import { clearEntitlements } from '@/lib/entitlements';
import { clearResume } from '@/lib/webResume';
import { resetSharedPlan } from '@/lib/plan';
import { resetSubscriptionStatus } from '@/lib/subscriptionStatus';
import { isCodeComplete, isValidEmail, sanitizeCode } from '@/lib/recovery';
import { nextSession, onInstallReset, readSession } from '@/lib/authSession';
import { AUTH_STORAGE_KEY, authStorage, supabase } from '@/lib/supabase';
import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

// Copy from the web's AuthModal where it has one; the rest is ours.
export const PASSWORD_TOO_SHORT = 'Password must be at least 8 characters';
export const OFFLINE = "Couldn't reach Prime Barber — check your connection and try again.";
const ALREADY_REGISTERED = 'An account with this email already exists. Sign in instead.';
const WRONG_PASSWORD = "That email and password don't match. Check them and try again, or tap Forgot password?";
const NOT_CONFIRMED = 'Confirm your email first — open the link we sent you, then sign in.';
const RATE_LIMITED = 'Too many tries. Wait a minute and try again.';
const BAD_EMAIL = 'Enter a valid email address.';
const WEAK_PASSWORD = 'That password is too easy to guess. Try a longer one with letters and numbers.';
const FALLBACK = 'Something went wrong. Please try again.';

/** A Supabase auth error (or a thrown fetch failure) as a sentence for the user. */
export function friendlyAuthError(e: unknown): string {
  const err = (e ?? {}) as { code?: string; status?: number; name?: string; message?: string };
  const code = err.code ?? '';
  const message = typeof err.message === 'string' ? err.message : '';
  if (
    err.name === 'AuthRetryableFetchError' ||
    err.status === 0 ||
    /network request failed|failed to fetch|fetch failed|network error|timed? ?out/i.test(message)
  ) {
    return OFFLINE;
  }
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered/i.test(message)) {
    return ALREADY_REGISTERED;
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return WRONG_PASSWORD;
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) return NOT_CONFIRMED;
  if (code === 'weak_password' || /password should/i.test(message)) {
    return /\d+ characters/.test(message) ? PASSWORD_TOO_SHORT : WEAK_PASSWORD;
  }
  if (code.startsWith('over_') || err.status === 429) return RATE_LIMITED;
  if (code === 'email_address_invalid' || /invalid email|unable to validate email/i.test(message)) return BAD_EMAIL;
  return message || FALLBACK;
}

/** Runs a supabase-js auth call; a returned or thrown error becomes a friendly Error. */
async function call<T extends { error: unknown }>(fn: () => Promise<T>): Promise<T> {
  let res: T;
  try {
    res = await fn();
  } catch (e) {
    throw new Error(friendlyAuthError(e));
  }
  if (res.error) throw new Error(friendlyAuthError(res.error));
  return res;
}

// A reinstall's leftover Keychain session is cleared before anything reads it (authSession.ts); the in-memory
// copies of the old account's data go with it.
onInstallReset(() => {
  clearCustomersCache();
  resetSharedPlan();
  resetSubscriptionStatus();
  clearEntitlements();
});

// The signed-in user for code outside React (publish deps).
let userId: string | null = null;
supabase.auth.onAuthStateChange((event, session) => {
  if (session) userId = session.user?.id ?? null;
  else if (event === 'SIGNED_OUT') {
    userId = null;
    // The server rejected the refresh token (or this is our own sign-out): the old account's in-memory plan,
    // entitlements and customers must not outlive the session. The site on the phone is kept (it may hold
    // unsaved edits); only the explicit Sign out / account deletion removes it.
    clearCustomersCache();
    resetSharedPlan();
    resetSubscriptionStatus();
    clearEntitlements();
  }
  // Any other event without a session (offline, token not refreshable yet) says nothing about being signed out.
});
readSession(supabase.auth, authStorage, AUTH_STORAGE_KEY)
  .then((session) => {
    userId = session?.user?.id ?? userId;
  })
  .catch(() => {});

export function currentUserId(): string | null {
  return userId;
}

/** The current session; `ready` once the stored one has been read. */
export function useSession(): { session: Session | null; ready: boolean } {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: false });
  useEffect(() => {
    let alive = true;
    readSession(supabase.auth, authStorage, AUTH_STORAGE_KEY)
      .then((session) => alive && setState((s) => ({ session: session ?? s.session, ready: true })))
      .catch(() => alive && setState((s) => ({ session: s.session, ready: true })));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (alive) setState((s) => ({ session: nextSession(s.session, event, session), ready: true }));
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

/**
 * The web's AuthContext.signUp: metadata { full_name, phone }, then
 * /api/sync-auth-phone (fire and forget). With a session the local site is
 * pushed to the account. `signedIn: false` means the project wants the email
 * confirmed first.
 */
export async function signUp(
  email: string,
  password: string,
  fullName: string,
  phone: string,
): Promise<{ signedIn: boolean }> {
  const { data } = await call(() =>
    supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName || '', phone: phone || '' } },
    }),
  );
  // With confirmations on, an existing email "succeeds" with no identities.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(ALREADY_REGISTERED);
  }
  if (phone && data.user?.id) api.syncAuthPhone(data.user.id).catch(() => {});
  trackRegistration('email');
  if (!data.session) return { signedIn: false };
  // Same as a sign-in: a site left on the phone by another account is swapped out first, never shown to,
  // or silently failed to save for, the new account.
  await afterSession(data.session.user.id);
  return { signedIn: true };
}

/** Email + password sign-in, then the local site is pushed to the account. */
export async function signIn(email: string, password: string): Promise<void> {
  const { data } = await call(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));
  await afterSession(data.session?.user?.id);
}

/**
 * What every sign-in does once a session exists (password sign-in, a
 * completed password reset): PostHog identify with the user id, load the
 * account's copy of the site if it is newer (or there is no local one), then
 * push the local site to the account. Pull first, so an older local copy
 * never overwrites a newer web edit.
 */
let switchGen = 0;

export async function afterSession(id: string | null | undefined): Promise<void> {
  userId = id ?? userId;
  if (id) {
    const gen = ++switchGen;
    identifyUser(id);
    // A site on the phone that belongs to another account is swapped for this account's own first, and
    // nothing is synced until it is: account A's site must never be shown to, or written under, account B.
    let switched: SwitchResult;
    try {
      switched = await withTimeout(switchAccountSite(id, () => gen === switchGen), LOOKUP_TIMEOUT_MS);
    } catch (e) {
      console.warn('[auth] could not load the account site after sign-in:', e);
      switchGen++; // the lookup may still be running: it must not write anything now
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      userId = null;
      resetUser();
      throw new Error(e instanceof Error && e.message === UNSAVED_OTHER_ACCOUNT ? UNSAVED_OTHER_ACCOUNT : SWITCH_FAILED);
    }
    if (switched === 'cleared') {
      const email = (await supabase.auth.getSession().catch(() => null))?.data.session?.user?.email ?? '';
      emptyAccount = { email };
    } else if (switched === 'same') {
      // Capped: a stalled network must not hold a sign-in that already succeeded.
      await withTimeout(pullSiteFromAccount(id), LOOKUP_TIMEOUT_MS).catch(() => null);
    } else {
      return; // 'replaced': the phone now holds a copy of the account's own row; nothing to push
    }
  }
  // Web signup/sign-in completes after account adoption; background autosave handles the draft copy.
  // Checkout performs its own strict acknowledgement, so a slow save cannot hold signup open.
  if (Platform.OS === 'web' && webDraftsEnabled()) void syncIfSignedIn();
  else await syncIfSignedIn();
}

const SWITCH_FAILED = "Couldn't load your account's website. Check your connection and sign in again.";

let emptyAccount: { email: string } | null = null;

/**
 * Set when a sign-in swapped a different account's site off this phone and the new account has none:
 * the screen says so (once) and goes to the start. The email is shown, never tracked.
 */
export function takeEmptyAccountNotice(): { email: string } | null {
  const v = emptyAccount;
  emptyAccount = null;
  return v;
}

export async function signOut(): Promise<void> {
  switchGen++; // an unfinished sign-in switch must not write after this
  // The site goes into the account first; it leaves the phone only if that worked, so the next person to
  // sign in here never sees it, and nothing unsaved is lost.
  const pushed = await withTimeout(pushSiteBeforeSignOut(), LOOKUP_TIMEOUT_MS).catch(() => false);
  // While the session still exists: this phone stops getting the account's booking / order pushes.
  const leaving = (await supabase.auth.getSession().catch(() => null))?.data.session?.user?.id ?? null;
  await withTimeout(unregisterPushToken(leaving), LOOKUP_TIMEOUT_MS).catch(() => {});
  const { error } = await supabase.auth.signOut();
  // Offline: the refresh token can't be revoked, but this phone still signs out.
  if (error) await supabase.auth.signOut({ scope: 'local' });
  userId = null;
  clearResume(); // web: a publish waiting on Stripe belongs to the account that left (a no-op on the phone)
  clearCustomersCache();
  resetSharedPlan(); // the next account must not read this one's tier, entitlements or team cap
  resetSubscriptionStatus();
  clearEntitlements();
  if (pushed) await clearSiteAfterSignOut().catch((e) => console.warn('[auth] could not clear the site:', e));
  resetUser();
}

// /forgot-password copy.
export const RESET_BAD_EMAIL = BAD_EMAIL;
export const RESET_RATE_LIMITED = 'Too many requests. Please wait a minute and try again.';
export const RESET_FALLBACK = FALLBACK;
export const RESET_WRONG_CODE = 'That code is wrong or has expired. Check the email or send a new code.';
export const RESET_CODE_INCOMPLETE = 'Enter the code from the email.';
export const PASSWORDS_DIFFER = "The passwords don't match.";
export const MIN_PASSWORD = 8;

type AuthErr = { code?: string; status?: number; name?: string; message?: string };

function isOffline(err: AuthErr): boolean {
  const message = typeof err.message === 'string' ? err.message : '';
  return (
    err.name === 'AuthRetryableFetchError' ||
    err.status === 0 ||
    /network request failed|failed to fetch|fetch failed|network error|timed? ?out/i.test(message)
  );
}

function isRateLimited(err: AuthErr): boolean {
  return err.status === 429 || (err.code ?? '').startsWith('over_') || /rate limit|too many/i.test(err.message ?? '');
}

/** A reset-email failure as a sentence: offline, rate limited, bad email, or generic. */
export function friendlyResetError(e: unknown): string {
  const err = (e ?? {}) as AuthErr;
  const code = err.code ?? '';
  const message = typeof err.message === 'string' ? err.message : '';
  if (isOffline(err)) return OFFLINE;
  if (isRateLimited(err)) return RESET_RATE_LIMITED;
  if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid email|unable to validate email/i.test(message)) {
    return RESET_BAD_EMAIL;
  }
  return RESET_FALLBACK;
}

/** A verifyOtp failure as a sentence: offline, rate limited, wrong/expired code, or generic. */
export function friendlyCodeError(e: unknown): string {
  const err = (e ?? {}) as AuthErr;
  const code = err.code ?? '';
  if (isOffline(err)) return OFFLINE;
  if (isRateLimited(err)) return RESET_RATE_LIMITED;
  if (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    err.status === 401 ||
    err.status === 403 ||
    /expired|invalid|token/i.test(err.message ?? '')
  ) {
    return RESET_WRONG_CODE;
  }
  return RESET_FALLBACK;
}

/**
 * "Forgot password?": Supabase emails a code (the project's Reset password
 * template includes {{ .Token }}). No redirectTo: the email's link still goes
 * to aibarber.org for web users; the app never opens a link with tokens.
 * Succeeds the same way whether or not the account exists. The email is
 * never sent to analytics.
 */
export async function requestPasswordReset(email: string, redirectTo?: string): Promise<void> {
  const address = email.trim();
  if (!isValidEmail(address)) throw new Error(RESET_BAD_EMAIL);
  let res: { error: unknown };
  try {
    // `redirectTo` is only ever given by the browser (the link in the email returns to that page); the phone calls it without.
    res = redirectTo ? await supabase.auth.resetPasswordForEmail(address, { redirectTo }) : await supabase.auth.resetPasswordForEmail(address);
  } catch (e) {
    throw new Error(friendlyResetError(e));
  }
  if (res.error) throw new Error(friendlyResetError(res.error));
  track('password_reset_requested');
}

/** Client-side check before updateUser: null when the pair is acceptable. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return PASSWORD_TOO_SHORT;
  if (password !== confirm) return PASSWORDS_DIFFER;
  return null;
}

/** Exchanges the emailed code for a recovery session (signs the user in). */
export async function verifyResetCode(
  email: string,
  code: string,
  { deferSwitch = false }: { deferSwitch?: boolean } = {},
): Promise<string | undefined> {
  let res: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
  try {
    res = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'recovery' });
  } catch (e) {
    track('password_reset_code_entered', { ok: false });
    throw new Error(friendlyCodeError(e));
  }
  if (res.error || !res.data.session) {
    track('password_reset_code_entered', { ok: false });
    throw new Error(res.error ? friendlyCodeError(res.error) : RESET_WRONG_CODE);
  }
  track('password_reset_code_entered', { ok: true });
  // A verified code is a full sign-in, even if the new password is never saved.
  const uid = res.data.session.user?.id;
  if (deferSwitch) {
    if (uid) identifyUser(uid);
  } else {
    await afterSession(uid);
  }
  return uid;
}

/**
 * Sets the new password on the (recovery) session; verifyResetCode already
 * did what a sign-in does. The server's own reason is shown when it rejects
 * the password.
 */
export async function setNewPassword(password: string): Promise<void> {
  let res: Awaited<ReturnType<typeof supabase.auth.updateUser>>;
  try {
    res = await supabase.auth.updateUser({ password });
  } catch (e) {
    throw new Error(friendlyAuthError(e));
  }
  if (res.error) {
    const err = res.error as AuthErr;
    throw new Error(isOffline(err) ? OFFLINE : err.message?.trim() || FALLBACK);
  }
  track('password_reset_completed');
}

/**
 * The code step's "Reset password": checks the code and the new password,
 * verifyOtp, then updateUser. `alreadyVerified` (a previous attempt verified
 * the code but the password was rejected) skips verifyOtp, since a code
 * works only once; `onVerified` tells the screen that happened.
 */
export async function resetPasswordWithCode(
  email: string,
  rawCode: string,
  password: string,
  confirm: string,
  { alreadyVerified = false, onVerified }: { alreadyVerified?: boolean; onVerified?: () => void } = {},
): Promise<void> {
  const code = sanitizeCode(rawCode);
  if (!alreadyVerified && !isCodeComplete(code)) throw new Error(RESET_CODE_INCOMPLETE);
  const problem = newPasswordProblem(password, confirm);
  if (problem) throw new Error(problem);
  // The account switch runs last: a failed switch signs out and would burn the one-time code before the
  // password was set.
  let uid: string | undefined;
  if (!alreadyVerified) {
    uid = await verifyResetCode(email, code, { deferSwitch: true });
    onVerified?.();
  }
  await setNewPassword(password);
  uid ??= (await supabase.auth.getSession().catch(() => null))?.data.session?.user?.id;
  await afterSession(uid);
}
