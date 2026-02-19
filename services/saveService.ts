import { SiteInstance } from '../types';
import { saveSite as saveToIDB } from './indexedDBService';
import { upsertSiteToSupabase } from './supabaseDataService';

/**
 * Dual-write: IndexedDB first (instant, always), then Supabase (async, fire-and-forget).
 * Returns as soon as IndexedDB write completes. Supabase errors are logged but never block.
 */
export async function dualWriteSave(
  site: SiteInstance,
  userId: string | null
): Promise<void> {
  const siteToSave = { ...site, lastSaved: Date.now() };

  // Always save to IndexedDB first (instant)
  await saveToIDB(siteToSave);

  // If user is authenticated, fire-and-forget to Supabase
  if (userId) {
    upsertSiteToSupabase(siteToSave, userId).catch(err => {
      console.error('[DualWrite] Supabase save failed (non-blocking):', err);
    });
  }
}
