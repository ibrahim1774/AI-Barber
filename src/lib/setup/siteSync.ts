import type { WebsiteData } from '@/web/types';
import { syncIfSignedIn } from '@/lib/account';
import { migrateBooking } from '@/lib/bookingChoice';
import { loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';

/**
 * Applies a change to the saved site from outside the Edit tab (the setup
 * screens). The Edit tab reloads the record when it regains focus. Returns the
 * saved record, or null if there is no site.
 */
export async function updateSiteData(
  change: (d: WebsiteData, r: SiteRecord) => WebsiteData,
  changeInputs?: (i: SiteRecord['inputs']) => SiteRecord['inputs'],
): Promise<SiteRecord | null> {
  const cur = await loadSite();
  if (!cur) return null;
  const next: SiteRecord = {
    ...cur,
    data: change(cur.data, cur),
    inputs: changeInputs ? changeInputs(cur.inputs) : cur.inputs,
    updatedAt: Date.now(),
  };
  await saveSite(next);
  void syncIfSignedIn(next);
  return next;
}

/** Like updateSiteData, but the change sees and returns the whole record (data and inputs together). */
export async function updateSiteRecord(change: (r: SiteRecord) => SiteRecord): Promise<SiteRecord | null> {
  const cur = await loadSite();
  if (!cur) return null;
  const next: SiteRecord = { ...change(migrateBooking(cur)), updatedAt: Date.now() };
  await saveSite(next);
  void syncIfSignedIn(next);
  return next;
}
