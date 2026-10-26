// Removing a customer's published site for good (App Store 5.1.1(v): account deletion must
// include user-generated content shared with others). Shared by in-app account deletion
// (deleteAccount.ts) and the no-account "take my website offline" endpoint (takeOffline.ts).
//
// Ordering is the contract, and every step is idempotent so a retry after a partial failure is
// safe:
//   1. takedown  : stamp taken_down_at (closes Bookings/Store gates, same flag the lapse sweep
//                  uses), then replace the live site with the offline page.
//   2. release   : detach any custom domain from the site's Vercel project.
//   3. delete    : the stored copy and the photos.
// A failure at any step throws and later steps do not run. The takedown comes first so the
// public site is gone even if a later step fails. The lapse sweep cannot bring the site back:
// its restore path needs the stored copy that step 3 deletes.
import type { PurchaseRow } from './purchases.js';

export type RemovableSite = Pick<PurchaseRow, 'original_transaction_id' | 'site_slug' | 'environment' | 'published_at'>;

export interface RemoveSiteDeps {
  /** Stamp ios_purchases.taken_down_at (idempotent). */
  markTakenDown(otid: string, at: number): Promise<void>;
  /** Deploy the offline page to the slug's Vercel project (idempotent). Throws on any failure. */
  deployOffline(slug: string): Promise<void>;
  /** Detach every custom domain from the slug's project (idempotent; absent = fine). */
  releaseDomains(slug: string): Promise<void>;
  /** Delete the stored copy, its history and its photos (idempotent). */
  deleteContent(slug: string): Promise<void>;
  now(): number;
}

/** Step 1. Never deploys for a site that was never published (it would create a Vercel project). */
export async function takeDown(site: RemovableSite, deps: Pick<RemoveSiteDeps, 'markTakenDown' | 'deployOffline' | 'now'>): Promise<void> {
  if (!site.site_slug) return;
  await deps.markTakenDown(site.original_transaction_id, deps.now());
  if (site.published_at != null) await deps.deployOffline(site.site_slug);
}

/** Steps 2 and 3. Only call after takeDown succeeded for this site. */
export async function purge(site: RemovableSite, deps: Pick<RemoveSiteDeps, 'releaseDomains' | 'deleteContent'>): Promise<void> {
  if (!site.site_slug) return;
  await deps.releaseDomains(site.site_slug);
  await deps.deleteContent(site.site_slug);
}

export async function removeSite(site: RemovableSite, deps: RemoveSiteDeps): Promise<void> {
  await takeDown(site, deps);
  await purge(site, deps);
}
