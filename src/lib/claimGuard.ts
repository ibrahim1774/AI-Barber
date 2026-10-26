import { supabase } from '@/lib/supabase';
import type { PendingPublish } from '@/lib/siteStore';
import { loadPendingPublish, savePendingPublish } from '@/lib/siteStore';

/**
 * Whether the app must show the locked account step instead of anything else. A paid publish waits (any record
 * with a payer behind it) and either there is no session (nobody to publish for), or the server refused it
 * (state 'conflict': another account / an existing site, so only a different account can continue).
 * With a session and an unclaimed / claiming record the step resumes the publish by itself.
 */
export function shouldLockToClaim(pending: PendingPublish | null, hasSession: boolean): boolean {
  if (!pending) return false;
  return pending.state === 'conflict' || !hasSession;
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

/** Routes that may be open while the claim is locked: the publish overlay (it is the flow), the claim step, password reset. */
export const CLAIM_ALLOWED_PATHS: readonly string[] = ['/claim', '/publishing', '/forgot-password', '/reset-password'];
