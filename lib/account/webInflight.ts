// Is a web publish in progress for this account and environment? (one-account plan, C1 B1 race.) An Apple first publish may release the account's own UNPUBLISHED
// web address row only when no web publish could still finish and claim it. In progress means any of, read from the real tables:
//   - a web_app_publish_intents row with status queued or running (lib/webApp/publishJobs.ts runJob / claim),
//   - a failed intent with attempts below MAX_JOB_ATTEMPTS (it will be retried; at the limit it is cancelled and the row is released),
//   - a live lease on the draft (web_app_drafts.publish_lease with lease_until in the future; lib/webApp/reliability.ts).
// A failed lookup counts as in progress (the safe answer: nothing is released).
import { MAX_JOB_ATTEMPTS } from '../webApp/publishJobs.js';
import { sbRest } from '../webApp/webAppServer.js';
import type { KindEnv } from './kind.js';

export interface InflightDeps {
  intents(uid: string, mode: 'live' | 'test', filter: string): Promise<{ id: string }[]>;
  lease(uid: string, mode: 'live' | 'test'): Promise<{ publish_lease: string | null; lease_until: string | null } | null>;
  now(): number;
}

export async function webPublishInProgress(uid: string, env: KindEnv, deps: InflightDeps = liveInflightDeps()): Promise<boolean> {
  const mode = env === 'Production' ? 'live' : 'test';
  try {
    if ((await deps.intents(uid, mode, 'status=in.(queued,running)')).length) return true;
    if ((await deps.intents(uid, mode, `status=eq.failed&attempts=lt.${MAX_JOB_ATTEMPTS}`)).length) return true;
    const d = await deps.lease(uid, mode);
    return !!d?.publish_lease && Date.parse(d.lease_until ?? '') > deps.now();
  } catch (e: any) {
    if (e?.status === 404) return false; // the reliability tables do not exist: no web job can be running
    console.error('[one-site] web publish lookup failed (treated as in progress):', e?.status ?? e?.message ?? e);
    return true;
  }
}

const enc = encodeURIComponent;
export function liveInflightDeps(): InflightDeps {
  return {
    async intents(uid, mode, filter) { return ((await sbRest(`web_app_publish_intents?user_id=eq.${enc(uid)}&environment=eq.${mode}&${filter}&select=id&limit=1`)) ?? []) as { id: string }[]; },
    async lease(uid, mode) { return (((await sbRest(`web_app_drafts?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=publish_lease,lease_until&limit=1`)) ?? []) as any[])[0] ?? null; },
    now: () => Date.now(),
  };
}
