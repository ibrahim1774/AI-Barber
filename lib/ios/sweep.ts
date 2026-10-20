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
  /** Rows not started because the time budget ran out; picked up next sweep. */
  deferred: string[];
}

export async function sweepIos(
  deps: { repo: PurchasesRepo; publish(slug: string): Promise<PublishOutcome> },
  limit = 50,
  opts: { deadlineMs?: number; now?: () => number } = {},
): Promise<IosSweepSummary> {
  const rows = await deps.repo.unpublishedBound(limit);
  const out: IosSweepSummary = { checked: rows.length, published: [], failed: [], missing: [], deferred: [] };
  const now = opts.now ?? Date.now;
  // One publishSite can take ~150 s and the function is capped at 300 s, so stop
  // starting new rows after 140 s.
  const deadlineMs = opts.deadlineMs ?? 140_000;
  const start = now();

  // Sequential on purpose: deploys are heavy.
  for (const row of rows) {
    const slug = row.site_slug as string;
    // Stop STARTING rows once the budget is spent, so the function returns before Vercel kills it.
    if (now() - start >= deadlineMs) {
      out.deferred.push(slug);
      continue;
    }
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
