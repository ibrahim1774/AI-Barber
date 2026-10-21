import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { identifyUser, resetUser, track, trackRegistration } from '@/lib/analytics';
import { api } from '@/lib/api';
import { syncIfSignedIn } from '@/lib/account';
import { isValidEmail, RESET_REDIRECT } from '@/lib/recovery';
import { supabase } from '@/lib/supabase';

// Copy from the web's AuthModal where it has one; the rest is ours.
export const PASSWORD_TOO_SHORT = 'Password must be at least 6 characters';
const OFFLINE = "Couldn't reach AI Barber — check your connection and try again.";
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
    return /6 characters/.test(message) ? PASSWORD_TOO_SHORT : WEAK_PASSWORD;
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

// The signed-in user for code outside React (publish deps).
let userId: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  userId = session?.user?.id ?? null;
});
supabase.auth
  .getSession()
  .then(({ data }) => {
    userId = data.session?.user?.id ?? userId;
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
    supabase.auth
      .getSession()
      .then(({ data }) => alive && setState({ session: data.session, ready: true }))
      .catch(() => alive && setState({ session: null, ready: true }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ session, ready: true });
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
  userId = data.session.user.id;
  identifyUser(userId);
  await syncIfSignedIn();
  return { signedIn: true };
}

/** Email + password sign-in, then the local site is pushed to the account. */
export async function signIn(email: string, password: string): Promise<void> {
  const { data } = await call(() => supabase.auth.signInWithPassword({ email: email.trim(), password }));
  await afterSession(data.session?.user?.id);
}

/**
 * What every sign-in does once a session exists (password sign-in, a
 * completed password reset): PostHog identify with the user id, then push
 * the local site to the account.
 */
async function afterSession(id: string | null | undefined): Promise<void> {
  userId = id ?? userId;
  if (id) identifyUser(id);
  await syncIfSignedIn();
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  // Offline: the refresh token can't be revoked, but this phone still signs out.
  if (error) await supabase.auth.signOut({ scope: 'local' });
  userId = null;
  resetUser();
}

// /forgot-password and /reset-password copy.
export const RESET_BAD_EMAIL = BAD_EMAIL;
export const RESET_RATE_LIMITED = 'Too many requests. Please wait a minute and try again.';
export const RESET_FALLBACK = FALLBACK;
export const PASSWORDS_DIFFER = "The passwords don't match.";
export const MIN_PASSWORD = 6;

/** A reset-email failure as a sentence: offline, rate limited, bad email, or generic. */
export function friendlyResetError(e: unknown): string {
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
  if (err.status === 429 || code.startsWith('over_') || /rate limit|too many/i.test(message)) return RESET_RATE_LIMITED;
  if (code === 'email_address_invalid' || code === 'validation_failed' || /invalid email|unable to validate email/i.test(message)) {
    return RESET_BAD_EMAIL;
  }
  return RESET_FALLBACK;
}

/**
 * "Forgot password?": Supabase emails a link that opens /reset-password in
 * this app. Succeeds the same way whether or not the account exists. The
 * email is never sent to analytics.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const address = email.trim();
  if (!isValidEmail(address)) throw new Error(RESET_BAD_EMAIL);
  let res: { error: unknown };
  try {
    res = await supabase.auth.resetPasswordForEmail(address, { redirectTo: RESET_REDIRECT });
  } catch (e) {
    throw new Error(friendlyResetError(e));
  }
  if (res.error) throw new Error(friendlyResetError(res.error));
  track('password_reset_requested');
}

/**
 * Opens the recovery session from the link's tokens. The refresh token is
 * rotated straight away (best effort), so the one that travelled in the
 * link stops working.
 */
export async function startRecoverySession(accessToken: string, refreshToken: string): Promise<void> {
  const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error || !data.session) throw new Error('This reset link has expired or was already used.');
  userId = data.session.user?.id ?? userId;
  try {
    await supabase.auth.refreshSession();
  } catch {
    // Offline: the session still works; the link's refresh token just isn't rotated yet.
  }
}

/** Client-side check before updateUser: null when the pair is acceptable. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return PASSWORD_TOO_SHORT;
  if (password !== confirm) return PASSWORDS_DIFFER;
  return null;
}

/**
 * Sets the new password on the recovery session, then does what a sign-in
 * does (identify, push the local site). The server's own reason is shown
 * when it rejects the password.
 */
export async function setNewPassword(password: string): Promise<void> {
  let res: Awaited<ReturnType<typeof supabase.auth.updateUser>>;
  try {
    res = await supabase.auth.updateUser({ password });
  } catch (e) {
    throw new Error(friendlyAuthError(e));
  }
  if (res.error) {
    const err = res.error as { name?: string; status?: number; message?: string };
    const offline = friendlyAuthError(res.error) === OFFLINE;
    throw new Error(offline ? OFFLINE : err.message?.trim() || FALLBACK);
  }
  track('password_reset_completed');
  await afterSession(res.data.user?.id);
}
