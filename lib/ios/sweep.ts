// iOS sweep, three passes sharing one time budget:
//
// 1. Publish paid iOS purchases that are bound to a slug but never got
//    published (the app's publish call died after binding, or the deploy
//    failed). Revoked rows are excluded by unpublishedBound. A row that looks
//    lapsed (lapse.ts prefilter) is only published if Apple says it is active.
// 2. Restore: a taken-down site whose row looks active again is force-redeployed
//    from its pending file, on the same slug, if Apple confirms it is active.
// 3. Takedown: a published site whose row looks lapsed is replaced with the
//    offline page, if Apple confirms it is inactive (expired, billing retry,
//    revoked). Billing grace counts as active. Only the live deployment
//    changes: the pending file, the sites table and published_at are untouched,
//    so the content survives.
//
// Apple is the authority for every takedown and restore; the row rules only
// pick which rows to ask about. If Apple can't be asked, that row is left alone
// this sweep (appleUnavailable) and asked again next time. Never act on a guess.
import type { PurchasesRepo, PurchaseRow } from './purchases.js';
import type { PublishOutcome } from '../publishSite.js';
import { isActive, type VerifiedTx } from './appleVerify.js';
import { isLapsed } from './lapse.js';

export interface IosSweepSummary {
  checked: number;
  published: string[];
  failed: string[];
  /** Bound rows whose pending file is missing; the app retries with its own content. */
  missing: string[];
  /** Rows not started because the time budget ran out; picked up next sweep. */
  deferred: string[];
  /** Unpublished bound rows not published because Apple says the subscription is inactive. */
  skippedLapsed: string[];
  /** Sites restored from their pending file (taken_down_at cleared). */
  restored: string[];
  /** Restores that failed (incl. a missing pending file); the flag stays set and they retry next sweep. */
  restoreFailed: string[];
  /** Restore candidates Apple says are not active; left taken down. */
  notRestored: string[];
  /** Sites replaced with the offline page. */
  takenDown: string[];
  /** Takedowns that failed; retried next sweep. */
  takedownFailed: string[];
  /** Takedown candidates Apple says are still active (e.g. billing grace); left up. */
  stillActive: string[];
  /** Rows left alone because Apple could not be asked; retried next sweep. */
  appleUnavailable: string[];
}

export interface IosSweepDeps {
  repo: PurchasesRepo;
  publish(slug: string, opts?: { force: boolean }): Promise<PublishOutcome>;
  /** Deploy the offline placeholder page to this slug's project. */
  deployOffline(slug: string): Promise<void>;
  /** Apple's live state for a purchase (appleVerify makeVerifier), keyed by originalTransactionId. */
  verify(originalTransactionId: string): Promise<VerifiedTx>;
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
    skippedLapsed: [], restored: [], restoreFailed: [], notRestored: [],
    takenDown: [], takedownFailed: [], stillActive: [], appleUnavailable: [],
  };

  /** Apple's verdict for this row: true active, false inactive, null couldn't ask (row is skipped). */
  async function appleSaysActive(row: PurchaseRow, slug: string): Promise<boolean | null> {
    const otid = row.original_transaction_id;
    let tx: VerifiedTx;
    try {
      tx = await deps.verify(otid);
    } catch (err: any) {
      console.error(`[Sweeper:iOS] Apple lookup failed for ${slug} (${otid}); no action this sweep:`, err?.code || err?.message || err);
      out.appleUnavailable.push(slug);
      return null;
    }
    // Record what Apple said (expires_at never moves backwards). Best effort.
    await deps.repo.upsertVerified(tx).catch((e: any) =>
      console.warn(`[Sweeper:iOS] ${slug} (${otid}): refreshing the row from Apple failed (ignored):`, e?.message || e));
    return isActive(tx, now());
  }

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
      const active = await appleSaysActive(row, slug);
      if (active === null) continue;
      if (!active) {
        out.skippedLapsed.push(slug);
        continue;
      }
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
    const active = await appleSaysActive(row, slug);
    if (active === null) continue;
    if (!active) {
      out.notRestored.push(slug);
      continue;
    }
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
    const active = await appleSaysActive(row, slug);
    if (active === null) continue;
    if (active) {
      out.stillActive.push(slug);
      continue;
    }
    try {
      await deps.deployOffline(slug);
      await deps.repo.markTakenDown(otid, now());
      console.log(`[Sweeper:iOS] TAKEN DOWN ${slug} (${otid}): subscription inactive per Apple`);
      out.takenDown.push(slug);
    } catch (err: any) {
      console.error(`[Sweeper:iOS] takedown failed for ${slug} (${otid}):`, err?.message || err);
      out.takedownFailed.push(slug);
    }
  }

  return out;
}
