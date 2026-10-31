// Web-app lapse job: takes down sites whose web subscription ended and restores them when it is paid again.
// Only web_app_sites rows (published, not removed, this Stripe key's mode) are ever looked at, so old-flow
// Stripe sites and iOS sites are never touched. Stripe is the authority (re-fetched before every takedown).
// Does NOT use sweepIos / liveRemoveDeps, and never writes ios_purchases.
import type { PublishOutcome } from '../publishSite.js';
import { isIndefiniteDeployError } from '../ios/sweep.js';
import { isEntitledStatus, keyMode } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';
import type { WebSiteRow } from './publishFlow.js';

export interface WebSweepDeps {
  /** Published, not removed, not taken down, in this environment; least recently checked first. */
  takedownCandidates(limit: number): Promise<WebSiteRow[]>;
  /** Taken down (not removed), in this environment. */
  restoreCandidates(limit: number): Promise<WebSiteRow[]>;
  /** An iOS purchase owns this slug: not ours to touch. */
  iosOwnsSlug(slug: string): Promise<boolean>;
  /** Any entitled web_app_entitlements row for this user in this environment. */
  hasEntitledRow(userId: string): Promise<boolean>;
  /** The subscription's current Stripe status; throws on an error. */
  subscriptionStatus(subscriptionId: string): Promise<string>;
  stampChecked(slug: string): Promise<void>;
  markTakenDown(slug: string): Promise<void>;
  clearTakenDown(slug: string): Promise<void>;
  deployOffline(slug: string): Promise<void>;
  publish(slug: string, opts: { force: boolean }): Promise<PublishOutcome>;
  now(): number;
}

export interface WebSweepSummary {
  checked: number;
  takenDown: string[];
  takedownFailed: string[];
  takedownUncertain: string[];
  stillActive: string[];
  skipped: string[];
  stripeUnavailable: string[];
  restored: string[];
  restoreFailed: string[];
  deferred: string[];
}

export async function sweepWebApp(deps: WebSweepDeps, opts: { limit?: number; deadlineMs?: number } = {}): Promise<WebSweepSummary> {
  const limit = opts.limit ?? 50;
  const deadline = opts.deadlineMs ?? 120_000;
  const start = deps.now();
  const outOfTime = () => deps.now() - start >= deadline;
  const out: WebSweepSummary = { checked: 0, takenDown: [], takedownFailed: [], takedownUncertain: [], stillActive: [], skipped: [], stripeUnavailable: [], restored: [], restoreFailed: [], deferred: [] };

  // Restore pass first: a re-subscribed owner gets the site back as soon as possible.
  const restores = (await deps.restoreCandidates(limit)).filter((r) => r.published_at && !r.removed_at && r.taken_down_at);
  for (const row of restores) {
    if (outOfTime()) { out.deferred.push(row.slug); continue; }
    try {
      if (await deps.iosOwnsSlug(row.slug)) { out.skipped.push(row.slug); continue; }
      if (!(await deps.hasEntitledRow(row.user_id))) continue;
      const o = await deps.publish(row.slug, { force: true });
      if (o.ok) { await deps.clearTakenDown(row.slug); out.restored.push(row.slug); }
      else { console.error(`[Sweeper:web] RESTORE FAILED ${row.slug}: ${o.reason} ${o.error ?? ''}; flag kept`); out.restoreFailed.push(row.slug); }
    } catch (e: any) {
      console.error(`[Sweeper:web] restore threw for ${row.slug}:`, e?.message || e);
      out.restoreFailed.push(row.slug);
    }
  }

  const rows = (await deps.takedownCandidates(limit)).filter((r) => r.published_at && !r.removed_at && !r.taken_down_at);
  out.checked = rows.length;
  for (const row of rows) {
    if (outOfTime()) { out.deferred.push(row.slug); continue; }
    try {
      if (await deps.iosOwnsSlug(row.slug)) { out.skipped.push(row.slug); continue; }
      if (await deps.hasEntitledRow(row.user_id)) { out.stillActive.push(row.slug); continue; }
      let status: string;
      try {
        status = await deps.subscriptionStatus(row.stripe_subscription_id);
      } catch (e: any) {
        console.warn(`[Sweeper:web] Stripe lookup failed for ${row.slug}; no action:`, e?.message || e);
        await deps.stampChecked(row.slug).catch(() => {});
        out.stripeUnavailable.push(row.slug);
        continue;
      }
      await deps.stampChecked(row.slug).catch(() => {});
      if (isEntitledStatus(status)) { out.stillActive.push(row.slug); continue; }
      // Stamp first: a death mid-deploy leaves the flag set, so a later re-subscribe is restored.
      await deps.markTakenDown(row.slug);
      try {
        await deps.deployOffline(row.slug);
        console.log(`[Sweeper:web] TAKEN DOWN ${row.slug}: subscription ${status}`);
        out.takenDown.push(row.slug);
      } catch (e: any) {
        if (isIndefiniteDeployError(e)) {
          console.error(`[Sweeper:web] takedown of ${row.slug} has an UNKNOWN outcome; flag kept:`, e?.message || e);
          out.takedownUncertain.push(row.slug);
          continue;
        }
        console.error(`[Sweeper:web] takedown failed for ${row.slug}; clearing the flag to retry:`, e?.message || e);
        out.takedownFailed.push(row.slug);
        await deps.clearTakenDown(row.slug).catch((er: any) => console.error(`[Sweeper:web] ALERT ${row.slug}: offline deploy and flag clear both failed:`, er?.message || er));
      }
    } catch (e: any) {
      console.error(`[Sweeper:web] ${row.slug} threw:`, e?.message || e);
      out.takedownFailed.push(row.slug);
    }
  }
  return out;
}

// ---- live wiring ----
const enc = encodeURIComponent;
const COLS = 'slug,stripe_subscription_id,user_id,environment,published_at,taken_down_at,removed_at';

export async function liveWebSweepDeps(): Promise<WebSweepDeps> {
  const env = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!env) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing or unrecognised');
  const { publishSite } = await import('../publishSite.js');
  const { deployRenderedSite } = await import('../deploySite.js');
  const { offlineHtml } = await import('../ios/offlinePage.js');
  const { findShopForSite } = await import('../siteSubpages.js');
  const patch = (slug: string, body: Record<string, unknown>) => sbRest(`web_app_sites?slug=eq.${enc(slug)}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } });
  return {
    takedownCandidates: async (limit) => (await sbRest(`web_app_sites?environment=eq.${env}&published_at=not.is.null&removed_at=is.null&taken_down_at=is.null&select=${COLS}&order=lapse_checked_at.asc.nullsfirst&limit=${limit}`)) ?? [],
    restoreCandidates: async (limit) => (await sbRest(`web_app_sites?environment=eq.${env}&published_at=not.is.null&removed_at=is.null&taken_down_at=not.is.null&select=${COLS}&order=lapse_checked_at.asc.nullsfirst&limit=${limit}`)) ?? [],
    iosOwnsSlug: async (slug) => ((await sbRest(`ios_purchases?site_slug=eq.${enc(slug)}&select=original_transaction_id&limit=1`)) ?? []).length > 0,
    hasEntitledRow: async (uid) => ((await sbRest(`web_app_entitlements?user_id=eq.${enc(uid)}&environment=eq.${env}&status=in.(active,trialing,past_due)&select=stripe_subscription_id&limit=1`)) ?? []).length > 0,
    subscriptionStatus: async (id) => String((await stripeCall(`subscriptions/${enc(id)}`, null, 'GET')).status),
    stampChecked: (slug) => patch(slug, { lapse_checked_at: new Date().toISOString() }).then(() => {}),
    markTakenDown: (slug) => patch(slug, { taken_down_at: new Date().toISOString() }).then(() => {}),
    clearTakenDown: (slug) => patch(slug, { taken_down_at: null }).then(() => {}),
    deployOffline: async (slug) => {
      const shop = await findShopForSite(slug); // a failed lookup throws: retried next sweep
      await deployRenderedSite({ siteId: slug, html: offlineHtml(), subpages: shop ? { mode: 'manage-only' } : null });
    },
    publish: (slug, opts) => publishSite(slug, opts),
    now: () => Date.now(),
  };
}
