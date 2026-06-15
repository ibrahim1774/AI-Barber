import { SiteInstance } from '../types';
import { saveSite as saveToIDB } from './indexedDBService';
import { upsertSiteToSupabase } from './supabaseDataService';

/**
 * Dual-write: IndexedDB first (instant, always), then Supabase (async, fire-and-forget).
 * Returns as soon as IndexedDB write completes. Supabase errors are logged but never block.
 *
 * Pass `skipIndexedDB: true` for /admin-generate so the operator's
 * local IndexedDB never accumulates sites belonging to OTHER users —
 * which would otherwise be picked up + auto-attached to whatever
 * customer logs in on this browser later (see ManagementDashboard
 * sync-from-local logic).
 */
export async function dualWriteSave(
  site: SiteInstance,
  userId: string | null,
  opts: { skipIndexedDB?: boolean } = {}
): Promise<void> {
  const siteToSave = { ...site, lastSaved: Date.now() };

  if (!opts.skipIndexedDB) {
    await saveToIDB(siteToSave);
  }

  if (userId) {
    upsertSiteToSupabase(siteToSave, userId).catch(err => {
      console.error('[DualWrite] Supabase save failed (non-blocking):', err);
    });
  }
}
