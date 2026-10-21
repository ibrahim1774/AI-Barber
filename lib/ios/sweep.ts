// iOS sweep, three passes sharing one time budget:
//
// 1. Publish paid iOS purchases that are bound to a slug but never got
//    published (the app's publish call died after binding, or the deploy
//    failed). Revoked rows are excluded by unpublishedBound; rows already
//    lapsed (lapse.ts) are skipped, since their site would only be taken down
//    again. If they resubscribe, the row is active again and gets picked up.
// 2. Restore: a taken-down site whose purchase is active again (renewal or
//    resubscribe) is force-redeployed from its pending file, on the same slug.
// 3. Takedown: a published site whose purchase has lapsed is replaced with the
//    offline page. Only the live deployment changes: the pending file, the
//    sites table and published_at are untouched, so the content survives.
import type { PurchasesRepo } from './purchases.js';
import type { PublishOutcome } from '../publishSite.js';
import { isLapsed } from './lapse.js';

export interface IosSweepSummary {
  checked: number;
  published: string[];
  failed: string[];
  /** Bound rows whose pending file is missing; the app retries with its own content. */
  missing: string[];
  /** Rows not started because the time budget ran out; picked up next sweep. */
  deferred: string[];
  /** Unpublished bound rows not published because the subscription has lapsed. */
  skippedLapsed: string[];
  /** Sites restored from their pending file (taken_down_at cleared). */
  restored: string[];
  /** Restores that failed (incl. a missing pending file); the flag stays set and they retry next sweep. */
  restoreFailed: string[];
  /** Sites replaced with the offline page. */
  takenDown: string[];
  /** Takedowns that failed; retried next sweep. */
  takedownFailed: string[];
}

export interface IosSweepDeps {
  repo: PurchasesRepo;
  publish(slug: string, opts?: { force: boolean }): Promise<PublishOutcome>;
  /** Deploy the offline placeholder page to this slug's project. */
  deployOffline(slug: string): Promise<void>;
}

export async function sweepIos(
  deps: IosSweepDeps,
  limit = 50,
  opts: { deadlineMs?: number; now?: () => number } = {},
): Promise<IosSweepSummary> {
  const now = opts.now ?? Date.now;
  // One publishSite can take ~150 s and the function is capped at 300 s, so stop
  // starting new rows after 140 s. One budget across all three passes.
  const deadlineMs = opts.deadlineMs ?? 140_000;
  const start = now();
  const outOfTime = () => now() - start >= deadlineMs;

  const rows = await deps.repo.unpublishedBound(limit);
  const out: IosSweepSummary = {
    checked: rows.length, published: [], failed: [], missing: [], deferred: [],
    skippedLapsed: [], restored: [], restoreFailed: [], takenDown: [], takedownFailed: [],
  };

  // Pass 1. Sequential on purpose: deploys are heavy.
  for (const row of rows) {
    const slug = row.site_slug as string;
    // Stop STARTING rows once the budget is spent, so the function returns before Vercel kills it.
    if (outOfTime()) {
      out.deferred.push(slug);
      continue;
    }
    const otid = row.original_transaction_id;
    if (isLapsed(row, now())) {
      out.skippedLapsed.push(slug);
      continue;
    }
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

  // Pass 2: restores. Fetched now, not up front, so a renewal that landed during pass 1 counts.
  // Once the budget is spent the remaining passes are not even queried; next sweep picks them up.
  const restores = outOfTime() ? [] : await deps.repo.restoreCandidates(limit, now());
  for (const row of restores) {
    const slug = row.site_slug as string;
    if (outOfTime()) {
      out.deferred.push(slug);
      continue;
    }
    const otid = row.original_transaction_id;
    try {
      const outcome = await deps.publish(slug, { force: true });
      if (outcome.ok) {
        await deps.repo.clearTakenDown(otid);
        out.restored.push(slug);
      } else {
        console.error(`[Sweeper:iOS] RESTORE FAILED ${slug} (${otid}): ${outcome.reason} ${outcome.error ?? ''}; flag kept, retried next sweep`);
        out.restoreFailed.push(slug);
      }
    } catch (err: any) {
      console.error(`[Sweeper:iOS] restore threw for ${slug} (${otid}):`, err?.message || err);
      out.restoreFailed.push(slug);
    }
  }

  // Pass 3: takedowns.
  const takedowns = outOfTime() ? [] : await deps.repo.takedownCandidates(limit, now());
  for (const row of takedowns) {
    const slug = row.site_slug as string;
    if (outOfTime()) {
      out.deferred.push(slug);
      continue;
    }
    const otid = row.original_transaction_id;
    try {
      await deps.deployOffline(slug);
      await deps.repo.markTakenDown(otid, now());
      console.log(`[Sweeper:iOS] TAKEN DOWN ${slug} (${otid}): subscription lapsed`);
      out.takenDown.push(slug);
    } catch (err: any) {
      console.error(`[Sweeper:iOS] takedown failed for ${slug} (${otid}):`, err?.message || err);
      out.takedownFailed.push(slug);
    }
  }

  return out;
}
