// iOS sweep, three passes sharing one time budget:
//
// 1. Publish paid iOS purchases that are bound to a slug but never got
//    published (the app's publish call died after binding, or the deploy
//    failed). Revoked rows are excluded by unpublishedBound. A row that looks
//    lapsed (lapse.ts prefilter) is only published if Apple says it is active.
// 2. Restore: a taken-down site whose row looks active again (or is revoked,
//    in case the customer resubscribed after a refund) is force-redeployed
//    from its pending file, on the same slug, if Apple confirms it is active.
// 3. Takedown: a published site whose row looks lapsed is replaced with the
//    offline page, if Apple confirms it is inactive (expired, billing retry,
//    revoked). Billing grace counts as active. Only the live deployment
//    changes: the pending file, the sites table and published_at are untouched,
//    so the content survives. Sandbox rows are watched like Production ones
//    (asked about, refreshed from Apple), but an inactive one only gets its
//    taken_down_at stamped, which closes the Bookings/Store gates, and its
//    website is left up unless takedownSandbox (env IOS_TAKEDOWN_SANDBOX=1),
//    so App Review's sandbox site never vanishes.
//
// Apple is the authority for every takedown and restore; the row rules only
// pick which rows to ask about. If Apple can't be asked (error or timeout),
// that row is left alone this sweep and asked again later. Never act on a
// guess. Every candidate Apple is asked about gets lapse_checked_at stamped,
// and candidates come oldest-checked first, so rows Apple can't resolve or
// that sit in billing grace rotate to the back instead of starving the rest.
import type { PurchasesRepo, PurchaseRow } from './purchases.js';
import { casPending, type PendingIO, type PendingSite, type PublishOutcome } from '../publishSite.js';
import type { VerifiedTx } from './appleVerify.js';
import { isActive } from './txStatus.js';
import { isLapsed } from './lapse.js';
import { withTimeout } from './timeout.js';
import { stripLapsedLinks } from './tiers.js';

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
  /** Takedowns that definitely failed (flag cleared again); retried next sweep. */
  takedownFailed: string[];
  /** Takedowns whose deploy outcome is unknown (e.g. timed out after Vercel accepted it); flag kept. */
  takedownUncertain: string[];
  /** Takedown candidates Apple says are still active (e.g. billing grace); left up. */
  stillActive: string[];
  /** Sandbox purchases Apple says are inactive: taken_down_at stamped (gates closed), website left up. */
  sandboxGatesClosed: string[];
  /** Rows left alone because Apple was unreachable or slow; retried next sweep. */
  appleUnavailable: string[];
  /** Rows Apple can't resolve (not-found, bad-product, bad-bundle); left alone, rotated to the back. */
  appleUnresolvable: string[];
  appleUnavailableCount: number;
  appleUnresolvableCount: number;
}

export interface IosSweepDeps {
  repo: PurchasesRepo;
  publish(slug: string, opts?: { force: boolean }): Promise<PublishOutcome>;
  /**
   * Deploy the offline placeholder page to this slug's project. Throw an error
   * with `indefinite: true` when it is unknown whether the deploy happened.
   */
  deployOffline(slug: string): Promise<void>;
  /** Apple's live state for a purchase (appleVerify makeVerifier), keyed by originalTransactionId. */
  verify(originalTransactionId: string): Promise<VerifiedTx>;
  /**
   * Deploy the offline page for inactive Sandbox purchases too (env IOS_TAKEDOWN_SANDBOX=1).
   * Default false: their gates still close (taken_down_at), the website stays up.
   */
  takedownSandbox?: boolean;
  /**
   * Before a restore: drop the Book/Shop links the purchase's CURRENT product (Apple's latest)
   * doesn't cover from the slug's pending file (makeStripPending). Never adds links: they come
   * back with the app's next publish. Best effort; absent = skipped.
   */
  stripPending?(slug: string, productId: string): Promise<boolean | void>;
}

/**
 * stripPending over the pending-file store: rewrites it only when a link is removed, and
 * returns whether it did. Compare-and-set (e2e I1): a publish landing between the read and the
 * write is never overwritten by the older copy; the strip is re-applied to the fresh copy.
 */
export function makeStripPending(deps: PendingIO): (slug: string, productId: string) => Promise<boolean> {
  return async (slug, productId) => {
    const r = await casPending<boolean>(slug, deps, (pending) => {
      if (!pending?.siteData) return { stop: false };
      const siteData = stripLapsedLinks(pending.siteData, productId);
      if (Object.keys(siteData).length === Object.keys(pending.siteData).length) return { stop: false };
      return { write: { ...pending, siteData }, result: true };
    });
    if (r.exhausted) throw new Error('the stored copy kept changing; strip not applied');
    return r.result === true;
  };
}

/** Errors meaning Apple will never resolve this purchase as-is. */
const PERMANENT_VERIFY_CODES = new Set(['not-found', 'bad-product', 'bad-bundle']);

/** An offline deploy that may have happened anyway: no HTTP response (timeout/network) from Vercel. */
export function isIndefiniteDeployError(e: any): boolean {
  return !!e && (e.indefinite === true || (e.isAxiosError === true && !e.response));
}

export async function sweepIos(
  deps: IosSweepDeps,
  limit = 50,
  opts: { deadlineMs?: number; lateDeadlineMs?: number; appleTimeoutMs?: number; now?: () => number } = {},
): Promise<IosSweepSummary> {
  const now = opts.now ?? Date.now;
  // One publishSite can take ~150 s and the function is capped at 300 s, so stop
  // starting new rows after 140 s. One budget across all three passes; restore
  // and takedown rows also make Apple calls first, so they stop starting at 120 s.
  const deadlineMs = opts.deadlineMs ?? 140_000;
  const lateDeadlineMs = opts.lateDeadlineMs ?? Math.min(120_000, deadlineMs);
  const appleTimeoutMs = opts.appleTimeoutMs ?? 5_000;
  const start = now();
  const outOfTime = () => now() - start >= deadlineMs;
  const outOfLateTime = () => now() - start >= lateDeadlineMs;

  const rows = await deps.repo.unpublishedBound(limit);
  const out: IosSweepSummary = {
    checked: rows.length, published: [], failed: [], missing: [], deferred: [],
    skippedLapsed: [], restored: [], restoreFailed: [], notRestored: [],
    takenDown: [], takedownFailed: [], takedownUncertain: [], stillActive: [], sandboxGatesClosed: [],
    appleUnavailable: [], appleUnresolvable: [], appleUnavailableCount: 0, appleUnresolvableCount: 0,
  };

  /**
   * Apple's verdict for this row: true active, false inactive, null couldn't ask
   * (the row is skipped). `stamp` records lapse_checked_at whatever the outcome.
   */
  async function appleSaysActive(row: PurchaseRow, slug: string, stamp: boolean): Promise<{ active: boolean; tx: VerifiedTx } | null> {
    const otid = row.original_transaction_id;
    const checkedAt = now();
    let tx: VerifiedTx | null = null;
    try {
      tx = await withTimeout(deps.verify(otid), appleTimeoutMs, 'Apple verify');
    } catch (err: any) {
      if (PERMANENT_VERIFY_CODES.has(err?.code)) {
        console.error(`[Sweeper:iOS] Apple can't resolve ${slug} (${otid}): ${err.code}; no action, rotated to the back`);
        out.appleUnresolvable.push(slug);
      } else {
        console.error(`[Sweeper:iOS] Apple lookup failed for ${slug} (${otid}); no action this sweep:`, err?.code || err?.message || err);
        out.appleUnavailable.push(slug);
      }
    }
    if (stamp) {
      await deps.repo.markLapseChecked(otid, checkedAt).catch((e: any) =>
        console.warn(`[Sweeper:iOS] ${slug} (${otid}): stamping lapse_checked_at failed (ignored):`, e?.message || e));
    }
    if (!tx) return null;
    // Record what Apple said (expires_at never moves backwards; a revocation
    // older than this check is cleared if Apple says active). Best effort.
    await deps.repo.upsertVerified(tx, { checkedAt }).catch((e: any) =>
      console.warn(`[Sweeper:iOS] ${slug} (${otid}): refreshing the row from Apple failed (ignored):`, e?.message || e));
    return { active: isActive(tx, now()), tx };
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
      const answer = await appleSaysActive(row, slug, false);
      if (answer === null) continue;
      if (!answer.active) {
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
  const restores = outOfLateTime() ? [] : await deps.repo.restoreCandidates(limit, now());
  for (const row of restores) {
    const slug = row.site_slug as string;
    if (outOfLateTime()) {
      out.deferred.push(slug);
      continue;
    }
    const otid = row.original_transaction_id;
    const answer = await appleSaysActive(row, slug, true);
    if (answer === null) continue;
    if (!answer.active) {
      out.notRestored.push(slug);
      continue;
    }
    if (deps.stripPending) {
      // The pending copy may carry links from an older, higher tier (a downgrade, then a
      // lapse and a resubscribe). Strip by what Apple says now; the gates stay authoritative.
      await deps.stripPending(slug, answer.tx.productId).catch((e: any) =>
        console.error(`[Sweeper:iOS] ${slug} (${otid}): stripping links before the restore failed (restoring anyway):`, e?.message || e));
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
  const takedowns = outOfLateTime()
    ? []
    // Sandbox rows too: asking Apple keeps a renewing App Review / TestFlight purchase's stored
    // expiry fresh, and an inactive one closes its Bookings/Store gates (below).
    : await deps.repo.takedownCandidates(limit, now(), { includeSandbox: true });
  for (const row of takedowns) {
    const slug = row.site_slug as string;
    if (outOfLateTime()) {
      out.deferred.push(slug);
      continue;
    }
    const otid = row.original_transaction_id;
    const answer = await appleSaysActive(row, slug, true);
    if (answer === null) continue;
    if (answer.active) {
      out.stillActive.push(slug);
      continue;
    }
    // Stamp first: if we die mid-deploy, or the deploy lands but its outcome is
    // unknown, the flag is set and a later resubscribe is restored.
    try {
      await deps.repo.markTakenDown(otid, now());
    } catch (err: any) {
      console.error(`[Sweeper:iOS] takedown not started for ${slug} (${otid}): stamping failed:`, err?.message || err);
      out.takedownFailed.push(slug);
      continue;
    }
    if (row.environment === 'Sandbox' && deps.takedownSandbox !== true) {
      // Gates closed (they read taken_down_at); the website stays up for App Review. A
      // resubscribe is restored like any other (a forced republish of the same content).
      console.log(`[Sweeper:iOS] SANDBOX ${slug} (${otid}): inactive per Apple; Bookings/Store closed, website left up`);
      out.sandboxGatesClosed.push(slug);
      continue;
    }
    try {
      await deps.deployOffline(slug);
      console.log(`[Sweeper:iOS] TAKEN DOWN ${slug} (${otid}): subscription inactive per Apple`);
      out.takenDown.push(slug);
    } catch (err: any) {
      if (isIndefiniteDeployError(err)) {
        console.error(`[Sweeper:iOS] takedown of ${slug} (${otid}) has an UNKNOWN outcome; flag kept:`, err?.message || err);
        out.takedownUncertain.push(slug);
        continue;
      }
      console.error(`[Sweeper:iOS] takedown failed for ${slug} (${otid}); clearing the flag to retry:`, err?.message || err);
      out.takedownFailed.push(slug);
      await deps.repo.clearTakenDown(otid).catch((e: any) =>
        console.error(`[Sweeper:iOS] ALERT ${slug} (${otid}): offline deploy failed AND clearing taken_down_at failed; site is live but flagged:`, e?.message || e));
    }
  }

  out.appleUnavailableCount = out.appleUnavailable.length;
  out.appleUnresolvableCount = out.appleUnresolvable.length;
  return out;
}
