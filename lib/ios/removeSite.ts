// Removing a customer's published site for good (App Store 5.1.1(v): account deletion must
// include user-generated content shared with others). Shared by in-app account deletion
// (deleteAccount.ts) and the no-account "take my website offline" endpoint (takeOffline.ts).
//
// Ordering is the contract, and every step is idempotent so a retry after a partial failure is
// safe:
//   0. removed   : stamp removed_at FIRST (migration 017). This is the durable "the owner removed
//                  this" mark: the sweep's restore pass, pass 1 and admin republish all refuse it, so
//                  a partly failed removal can never be undone by a still-billing subscription. Only
//                  an explicit owner publish from the app clears it.
//   1. takedown  : stamp taken_down_at (closes Bookings/Store gates, same flag the lapse sweep
//                  uses), then replace the live site with the offline page.
//   2. release   : detach any custom domain from the site's Vercel project.
//   3. delete    : the stored copy and the photos.
// A failure at any step throws and later steps do not run. The takedown comes first so the
// public site is gone even if a later step fails. The lapse sweep cannot bring the site back:
// it skips every row with removed_at set, whether or not step 3 finished.
import type { PurchaseRow } from './purchases.js';

export type RemovableSite = Pick<PurchaseRow, 'original_transaction_id' | 'site_slug' | 'environment' | 'published_at'>;

export interface RemoveSiteDeps {
  /** Stamp ios_purchases.removed_at (idempotent; throws when it cannot, so nothing else runs). */
  markRemoved(otid: string, at: number): Promise<void>;
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
export async function takeDown(site: RemovableSite, deps: Pick<RemoveSiteDeps, 'markRemoved' | 'markTakenDown' | 'deployOffline' | 'now'>): Promise<void> {
  if (!site.site_slug) return;
  await deps.markRemoved(site.original_transaction_id, deps.now());
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
