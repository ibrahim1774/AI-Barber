// Is the account's web site offline (web_app_sites.removed_at or taken_down_at set)? Used for NATIVE callers only (X-PB-Build), so that a stale draft `deployed_url` (the
// keep-content take offline could not clear it, for example the draft engine was off) is never reported as live and a republish is not answered from the old live record.
// A failed lookup counts as "not offline" (nothing is hidden on a guess). The web (no header) never asks.
import { modeOf } from '../webApp/reliability.js';
import { sbRest } from '../webApp/webAppServer.js';

export async function webSiteOffline(uid: string): Promise<boolean> {
  try {
    const rows = ((await sbRest(`web_app_sites?user_id=eq.${encodeURIComponent(uid)}&environment=eq.${modeOf()}&select=removed_at,taken_down_at&order=created_at.desc&limit=1`)) ?? []) as { removed_at: string | null; taken_down_at: string | null }[];
    return !!(rows[0]?.removed_at || rows[0]?.taken_down_at);
  } catch (e: any) {
    console.error('[site offline] lookup failed (treated as not offline):', e?.status ?? e?.message ?? e);
    return false;
  }
}
