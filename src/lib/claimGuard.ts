import { supabase } from '@/lib/supabase';
import type { PendingPublish } from '@/lib/siteStore';
import { loadPendingPublish, savePendingPublish } from '@/lib/siteStore';

/**
 * Whether the app must show the locked account step instead of anything else. A paid publish waits (any record
 * with a payer behind it) and either there is no session (nobody to publish for), or the server refused it
 * (state 'conflict': another account / an existing site, so only a different account can continue).
 * With a session and an unclaimed / claiming record the step resumes the publish by itself, and a claiming record stays locked.
 */
export function shouldLockToClaim(pending: PendingPublish | null, hasSession: boolean): boolean {
  if (!pending) return false;
  // A paused claim (the user went back to the editor) never locks; the editor is free until Publish is tapped again.
  if (pending.state === 'paused') return false;
  // 'claiming' stays locked until the server confirms the publish (live clears the record) or says it cannot proceed
  // (a refusal, a 402 or a bad request clears or marks it): the lock never lifts on a guess.
  return pending.state === 'conflict' || pending.state === 'claiming' || !hasSession;
}

/** The same decision from the phone's disk and session. A read that fails says no lock (never trap on an error). */
export async function claimLocked(): Promise<boolean> {
  try {
    const pending = await loadPendingPublish();
    if (!pending) return false;
    const hasSession = !!(await supabase.auth.getSession()).data.session;
    return shouldLockToClaim(pending, hasSession);
  } catch {
    return false;
  }
}

/** "Use a different account": the conflict is cleared and the record waits for another account to claim it. */
export async function reopenClaim(): Promise<void> {
  const pending = await loadPendingPublish();
  if (!pending) return;
  const { conflict: _drop, ...rest } = pending;
  await savePendingPublish({ ...rest, state: 'unclaimed' });
}

/** "Back" from the account step: the payment and its transaction id are kept, the app is no longer locked. */
export async function pauseClaim(): Promise<void> {
  const pending = await loadPendingPublish();
  if (!pending || pending.state === 'conflict') return;
  await savePendingPublish({ ...pending, state: 'paused' });
}

/** After a successful move: the conflict is cleared and the record goes back to 'claiming', so the publish resumes. */
export async function resumeAfterMove(): Promise<void> {
  const pending = await loadPendingPublish();
  if (!pending) return;
  const { conflict: _drop, ...rest } = pending;
  await savePendingPublish({ ...rest, state: 'claiming' });
}

/** Routes that may be open while the claim is locked: the publish overlay (it is the flow), the claim step, password reset. */
export const CLAIM_ALLOWED_PATHS: readonly string[] = ['/claim', '/publishing', '/forgot-password', '/reset-password'];
