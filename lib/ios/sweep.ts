// iOS branch of the publish sweeper: paid iOS purchases that are bound to a slug
// but never got published (the app's publish call died after binding, or the
// deploy failed). Expired-but-paid rows are still published (the customer paid;
// web never unpublishes); revoked rows are excluded by unpublishedBound.
import type { PurchasesRepo } from './purchases.js';
import type { PublishOutcome } from '../publishSite.js';

export interface IosSweepSummary {
  checked: number;
  published: string[];
  failed: string[];
  /** Bound rows whose pending file is missing; the app retries with its own content. */
  missing: string[];
}

export async function sweepIos(
  deps: { repo: PurchasesRepo; publish(slug: string): Promise<PublishOutcome> },
  limit = 50,
): Promise<IosSweepSummary> {
  const rows = await deps.repo.unpublishedBound(limit);
  const out: IosSweepSummary = { checked: rows.length, published: [], failed: [], missing: [] };

  // Sequential on purpose: deploys are heavy.
  for (const row of rows) {
    const slug = row.site_slug as string;
    const otid = row.original_transaction_id;
    try {
      const outcome = await deps.publish(slug);
      if (outcome.ok) {
        await deps.repo.markPublished(otid);
        out.published.push(slug);
      } else if (outcome.reason === 'no-backup') {
        console.error(`[Sweeper:iOS] MISSING pending file for paid purchase ${otid} (slug ${slug}); re-checked next sweep`);
        out.missing.push(slug);
      } else {
        console.error(`[Sweeper:iOS] FAILED ${slug} (${otid}): ${outcome.reason} ${outcome.error ?? ''}`);
        out.failed.push(slug);
      }
    } catch (err: any) {
      console.error(`[Sweeper:iOS] threw for ${slug} (${otid}):`, err?.message || err);
      out.failed.push(slug);
    }
  }
  return out;
}
