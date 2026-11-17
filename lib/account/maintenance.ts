// Once-a-day clean-ups run from the 10-minute lapse cron (/api/web-app/lapse; there is no daily cron). A task claims its row in
// maintenance_runs (migration 041) before it runs, so overlapping cron runs and the 144 runs a day do it once a day. Never throws.
// Missing table (041 not applied): the task is skipped. Lane C3 adds its kept-copies clean-up the same way (runDaily with another name).
import { sbRest } from '../webApp/webAppServer.js';
import { liveKeptStore, type KeptStore } from './keptCopy.js';
import { cleanupUnpublished, guardMode, tableMissing, type SitesDeps } from './sites.js';

export const DAY_MS = 24 * 3600_000;

export interface MaintenanceDeps {
  /** True for the one caller that may run `name` now: no row yet (inserted), or last_run_at older than a day (moved to now). */
  claim(name: string, nowIso: string, olderThanIso: string): Promise<boolean>;
  /** Give the claim back after a failed run (last_run_at back to `previousIso`, or the row removed when there was none). */
  release?(name: string, nowIso: string): Promise<void>;
}

export type DailyResult = { ran: false; reason: 'not-due' | 'no-table' | 'error' } | { ran: true; result: unknown };

export async function runDaily(name: string, task: () => Promise<unknown>, now: number, deps: MaintenanceDeps = liveMaintenanceDeps()): Promise<DailyResult> {
  const nowIso = new Date(now).toISOString();
  try {
    if (!(await deps.claim(name, nowIso, new Date(now - DAY_MS).toISOString()))) return { ran: false, reason: 'not-due' };
  } catch (e: any) {
    if (tableMissing(e)) return { ran: false, reason: 'no-table' };
    console.error(`[maintenance] ${name}: claim failed:`, e?.status ?? e?.message ?? e);
    return { ran: false, reason: 'error' };
  }
  try {
    return { ran: true, result: await task() };
  } catch (e: any) {
    // A failed run is retried by the next cron tick (the claim is given back), not tomorrow.
    console.error(`[maintenance] ${name}: failed:`, e?.status ?? e?.message ?? e);
    await deps.release?.(name, nowIso).catch(() => {});
    return { ran: false, reason: 'error' };
  }
}

/** The account clean-ups. With the guard off nothing runs and nothing is read. */
export async function runAccountMaintenance(now: number = Date.now(), opts: { mode?: ReturnType<typeof guardMode>; sites?: SitesDeps; maintenance?: MaintenanceDeps; kept?: KeptStore } = {}): Promise<Record<string, DailyResult> | null> {
  // Kept copies expire whatever the guard says (the endpoint has its own gate); the address clean-up needs the guard on.
  const out: Record<string, DailyResult> = {};
  if ((opts.mode ?? guardMode()) !== 'off') out.unpublishedAddresses = await runDaily('account_sites_unpublished', () => cleanupUnpublished(now, opts.sites), now, opts.maintenance);
  out.expiredKeptCopies = await runDaily('site_kept_copies_expired', () => (opts.kept ?? liveKeptStore()).expire(new Date(now).toISOString()), now, opts.maintenance);
  return out;
}

const enc = encodeURIComponent;
export function liveMaintenanceDeps(): MaintenanceDeps {
  return {
    async claim(name, nowIso, olderThanIso) {
      const made = await sbRest('maintenance_runs?on_conflict=name', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: { name, last_run_at: nowIso } });
      if (Array.isArray(made) && made.length > 0) return true;
      const got = await sbRest(`maintenance_runs?name=eq.${enc(name)}&last_run_at=lt.${enc(olderThanIso)}`, { method: 'PATCH', prefer: 'return=representation', body: { last_run_at: nowIso } });
      return Array.isArray(got) && got.length > 0;
    },
    async release(name, nowIso) {
      // Back to "due": an old stamp. Only while the stamp is still ours.
      await sbRest(`maintenance_runs?name=eq.${enc(name)}&last_run_at=eq.${enc(nowIso)}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_run_at: new Date(0).toISOString() } });
    },
  };
}
