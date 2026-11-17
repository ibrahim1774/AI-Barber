// Web-app lapse job: takes down sites whose web subscription ended and restores them when it is paid again.
// Only web_app_sites rows (published, not removed, this Stripe key's mode) are ever looked at, so old-flow
// Stripe sites and iOS sites are never touched. Stripe is the authority (re-fetched before every takedown).
// Does NOT use sweepIos / liveRemoveDeps, and never writes ios_purchases.
import type { PublishOutcome } from '../publishSite.js';
import { isIndefiniteDeployError } from '../ios/sweep.js';
import { isEntitledStatus, keyMode } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';
import { isFree } from './priceGroup.js';
import type { WebSiteRow } from './publishFlow.js';
import { appStoreStateOf, type AppStoreState } from './appStoreGuard.js';
import { alertOwner, iosOverlapEmail, sendMail } from './emails.js';
import { contactFor } from './dunning.js';
import { stampedSiteUrl } from '../ios/siteUrlFor.js';
import { purchaseLive } from '../ios/lapse.js';

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
  /** Is any tagged subscription of this site's Stripe customer entitled right now (a re-subscribe whose webhook is late)? Throws on an error. */
  customerHasActive(subscriptionId: string): Promise<boolean>;
  stampChecked(slug: string): Promise<void>;
  markTakenDown(slug: string): Promise<void>;
  clearTakenDown(slug: string): Promise<void>;
  deployOffline(slug: string): Promise<void>;
  publish(slug: string, opts: { force: boolean }): Promise<PublishOutcome>;
  /** Best effort, never throws: the plan has ended, so the site's domain stops renewing (lib/webApp/domainPlanEnd.ts). */
  planEnded?(row: WebSiteRow): Promise<void>;
  /** Best effort, never throws: a restored (re-subscribed) site's domain renews again where the plan ending turned it off. */
  planResumed?(row: WebSiteRow): Promise<void>;
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
    // Stamp every visited row so the oldest-checked ordering rotates (more than `limit` rows must not starve).
    await deps.stampChecked(row.slug).catch(() => {});
    try {
      if (await deps.iosOwnsSlug(row.slug)) { out.skipped.push(row.slug); continue; }
      if (!(await deps.hasEntitledRow(row.user_id))) continue;
      const o = await deps.publish(row.slug, { force: true });
      if (o.ok) {
        await deps.clearTakenDown(row.slug); out.restored.push(row.slug);
        await deps.planResumed?.(row).catch((e: any) => console.error(`[Sweeper:web] domain renewal resume for ${row.slug}:`, e?.message || e));
      }
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
    await deps.stampChecked(row.slug).catch(() => {});
    try {
      if (await deps.iosOwnsSlug(row.slug)) { out.skipped.push(row.slug); continue; }
      if (await deps.hasEntitledRow(row.user_id)) { out.stillActive.push(row.slug); continue; }
      let status: string;
      try {
        status = await deps.subscriptionStatus(row.stripe_subscription_id);
        // The old subscription ended: a newer one for the same customer (webhook still on its way) keeps the site up.
        if (!isEntitledStatus(status) && (await deps.customerHasActive(row.stripe_subscription_id))) { out.stillActive.push(row.slug); continue; }
      } catch (e: any) {
        console.warn(`[Sweeper:web] Stripe lookup failed for ${row.slug}; no action:`, e?.message || e);
        out.stripeUnavailable.push(row.slug);
        continue;
      }
      if (isEntitledStatus(status)) { out.stillActive.push(row.slug); continue; }
      await deps.planEnded?.(row).catch((e: any) => console.error(`[Sweeper:web] domain renewal for ${row.slug}:`, e?.message || e));
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
    takedownCandidates: async (limit) => (await sbRest(`web_app_sites?environment=eq.${env}&published_at=not.is.null&removed_at=is.null&taken_down_at=is.null&stripe_subscription_id=not.like.free:*&select=${COLS}&order=lapse_checked_at.asc.nullsfirst&limit=${limit}`)) ?? [],
    restoreCandidates: async (limit) => (await sbRest(`web_app_sites?environment=eq.${env}&published_at=not.is.null&removed_at=is.null&taken_down_at=not.is.null&select=${COLS}&order=lapse_checked_at.asc.nullsfirst&limit=${limit}`)) ?? [],
    iosOwnsSlug: async (slug) => ((await sbRest(`ios_purchases?site_slug=eq.${enc(slug)}&select=original_transaction_id&limit=1`)) ?? []).length > 0,
    hasEntitledRow: async (uid) => ((await sbRest(`web_app_entitlements?user_id=eq.${enc(uid)}&environment=eq.${env}&status=in.(active,trialing,past_due)&select=stripe_subscription_id&limit=1`)) ?? []).length > 0 || (await isFree(uid)),
    subscriptionStatus: async (id) => {
      const st = (await stripeCall(`subscriptions/${enc(id)}`, null, 'GET')).status;
      if (typeof st !== 'string' || !st) throw new Error('stripe returned no status');
      return st;
    },
    customerHasActive: async (id) => {
      const sub = await stripeCall(`subscriptions/${enc(id)}`, null, 'GET');
      const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
      if (!customer) throw new Error('stripe returned no customer');
      const list = await stripeCall(`subscriptions?customer=${enc(customer)}&status=all&limit=20`, null, 'GET');
      return (list?.data ?? []).some((x: any) => x?.metadata?.app === 'aibarber-app' && isEntitledStatus(String(x.status)));
    },
    stampChecked: (slug) => patch(slug, { lapse_checked_at: new Date().toISOString() }).then(() => {}),
    markTakenDown: (slug) => patch(slug, { taken_down_at: new Date().toISOString() }).then(() => {}),
    clearTakenDown: (slug) => patch(slug, { taken_down_at: null }).then(() => {}),
    deployOffline: async (slug) => {
      const shop = await findShopForSite(slug); // a failed lookup throws: retried next sweep
      await deployRenderedSite({ siteId: slug, html: offlineHtml(), gone: true, subpages: shop ? { mode: 'manage-only' } : null });
    },
    publish: (slug, opts) => publishSite(slug, opts),
    planEnded: async (row) => {
      const { livePlanEndDeps, onPlanEnded } = await import('./domainPlanEnd.js');
      await onPlanEnded(row.slug, row.user_id ?? null, await livePlanEndDeps(env));
    },
    planResumed: async (row) => {
      const { livePlanEndDeps, onPlanResumed } = await import('./domainPlanEnd.js');
      await onPlanResumed(row.slug, await livePlanEndDeps(env));
    },
    now: () => Date.now(),
  };
}

// ---- web subscriber who later bought on iOS: ALERT ONLY, once per subscription ----
export interface OverlapRow { stripe_subscription_id: string; stripe_customer_id: string; user_id: string | null; tier: string; site_slug: string | null }
export interface IosOverlapDeps {
  /** Entitled rows in this mode that were never notified; least recently checked first (never-checked first); at most `limit`. */
  candidates(limit: number): Promise<OverlapRow[]>;
  /** Stamp ios_overlap_checked_at so the ordering rotates (more than `limit` rows must not starve). */
  stampChecked(subId: string): Promise<void>;
  appStoreState(userId: string): Promise<AppStoreState>;
  /** Atomic once-only claim (ios_overlap_notified_at is null -> now). */
  claim(subId: string): Promise<boolean>;
  release(subId: string): Promise<void>;
  /** Email the customer. False = the account has no email address. Throws on a send failure. */
  mailCustomer(row: OverlapRow): Promise<boolean>;
  /** Best effort. `note` says what happened to the customer email; `extra` (STRIPE_REFUND_ALERTS only) names the account email, both subscription ids and whether a site address exists. */
  mailOwner(row: OverlapRow, state: AppStoreState, note: string, extra?: string[]): Promise<void>;
  /**
   * STRIPE_REFUND_ALERTS only: facts for the owner alert of a web account that also has a live Apple purchase (no site address needed): the account email, the
   * live Apple subscription ids, whether a web site address exists, and whether the blocked-purchase ledger already alerted for this account (then no second alert).
   */
  accountFacts?(userId: string): Promise<{ email: string | null; appleSubs: string[]; hasSite: boolean; ledgerAlerted: boolean }>;
  /** STRIPE_REFUND_ALERTS only: does the account hold an Apple address (ios_purchases.user_id = account, site_slug not null)? */
  holdsAppleAddress?(userId: string): Promise<boolean>;
  /** STRIPE_REFUND_ALERTS only: how many live Apple purchases are tied to the account. */
  liveApplePurchases?(userId: string): Promise<number>;
  /** STRIPE_REFUND_ALERTS only: operator alert for the two cases above. */
  alert?(subject: string, lines: string[]): Promise<void>;
}
export interface IosOverlapSummary { checked: number; notified: string[]; lookupFailed: number; mailFailed: string[]; noEmail: string[]; ownerOnly: string[] }

/**
 * Never cancels or refunds anything.
 *  - 'active' iOS plan: tell the customer they pay twice (once), then tell the owner (best effort).
 *  - 'linked' (the iOS plan has LAPSED): the customer is NOT told to cancel (their web plan may be all they have); owner only.
 * The claim is final after the customer mail; a failed owner mail never re-emails the customer. A failed CUSTOMER mail releases the claim.
 */
export async function sweepIosOverlap(deps: IosOverlapDeps, limit = 50): Promise<IosOverlapSummary> {
  const out: IosOverlapSummary = { checked: 0, notified: [], lookupFailed: 0, mailFailed: [], noEmail: [], ownerOnly: [] };
  const rows = await deps.candidates(limit);
  for (const row of rows) {
    out.checked++;
    // Stamp FIRST: a row with no user_id must not stay at the head of the queue forever.
    await deps.stampChecked(row.stripe_subscription_id).catch(() => {});
    if (!row.user_id) continue;
    if (process.env.STRIPE_REFUND_ALERTS === '1' && deps.holdsAppleAddress && deps.alert) {
      // R1: the Apple address decides the account's kind. An Apple holder with a live card plan is an alert to the owner, never a
      // customer email. The claim (ios_overlap_notified_at) makes it once per subscription row.
      let holder = false; let live = 0;
      try {
        holder = await deps.holdsAppleAddress(row.user_id);
        if (deps.liveApplePurchases) live = await deps.liveApplePurchases(row.user_id);
      } catch (e: any) { console.warn('[web-app ios-overlap] apple lookup failed; skipping:', e?.message || e); out.lookupFailed++; continue; }
      if (holder || live >= 2) {
        if (!(await deps.claim(row.stripe_subscription_id).catch(() => false))) continue;
        const lines = [`user: ${row.user_id}`, `web subscription: ${row.stripe_subscription_id} (${row.tier})`, `live Apple purchases: ${live}`];
        // One alert for both reasons: a failure releases the claim and the next run sends it again, never half of it twice.
        try {
          await deps.alert(holder ? 'Prime Barber web: an Apple account also pays a card plan' : 'Prime Barber web: one account has two live Apple purchases',
            [...lines, ...(holder && live >= 2 ? ['This account also has two live Apple purchases.'] : []), ...(holder ? ['The customer was NOT emailed and nothing was cancelled. Settle it by hand.'] : ['Nothing was changed. Settle it by hand.'])]);
        } catch (e: any) {
          console.error('[web-app ios-overlap] apple alert failed; releasing the claim:', e?.message || e);
          await deps.release(row.stripe_subscription_id).catch(() => {});
          out.mailFailed.push(row.stripe_subscription_id);
          continue;
        }
        out.ownerOnly.push(row.stripe_subscription_id);
        continue;
      }
    }
    let state: AppStoreState;
    try { state = await deps.appStoreState(row.user_id); }
    catch (e: any) { console.warn('[web-app ios-overlap] lookup failed; skipping:', e?.message || e); out.lookupFailed++; continue; }
    if (!state) continue;
    if (!(await deps.claim(row.stripe_subscription_id).catch(() => false))) continue;
    // The owner alert for the double payer (STRIPE_REFUND_ALERTS): once per account (the claim above), with the account email, both subscription ids and whether a
    // site address exists. Works for a card plan with no site and a live Apple purchase with no slug too. The customer email below is the separate, existing path.
    let extra: string[] | undefined; let ledgerAlerted = false;
    if (process.env.STRIPE_REFUND_ALERTS === '1' && deps.accountFacts) {
      try {
        const f = await deps.accountFacts(row.user_id);
        ledgerAlerted = f.ledgerAlerted;
        extra = [`account email: ${f.email ?? '(unknown)'}`, `Apple subscriptions: ${f.appleSubs.join(', ') || '(none read)'}`, `site address: ${f.hasSite ? 'yes' : 'none yet'}`];
      } catch (e: any) { console.warn('[web-app ios-overlap] account facts failed (alert without them):', e?.message || e); }
    }
    let note: string;
    if (state === 'active') {
      try {
        const sent = await deps.mailCustomer(row);
        if (sent) { note = 'The customer was emailed; nothing was cancelled or refunded.'; out.notified.push(row.stripe_subscription_id); }
        else { note = 'The customer has NO email address, so nobody was told. Contact them.'; out.noEmail.push(row.stripe_subscription_id); }
      } catch (e: any) {
        console.error('[web-app ios-overlap] customer mail failed; releasing the claim:', e?.message || e);
        await deps.release(row.stripe_subscription_id).catch(() => {});
        out.mailFailed.push(row.stripe_subscription_id);
        continue;
      }
    } else {
      note = 'The App Store plan has lapsed, so the customer was NOT emailed (their web plan may be what keeps the site up). Your call.';
      out.ownerOnly.push(row.stripe_subscription_id);
    }
    // The blocked-purchase ledger already alerted the owner for this account: no second alert (the customer email above is unaffected).
    if (ledgerAlerted) continue;
    await deps.mailOwner(row, state, note, extra).catch((e: any) => console.error('[web-app ios-overlap] owner alert failed (best effort):', e?.message || e));
  }
  return out;
}

export function liveIosOverlapDeps(mode: 'live' | 'test'): IosOverlapDeps {
  const patch = (subId: string, body: Record<string, unknown>, filter = '') => sbRest(`web_app_entitlements?stripe_subscription_id=eq.${enc(subId)}${filter}`, { method: 'PATCH', body, prefer: 'return=representation' });
  return {
    candidates: async (limit) => (await sbRest(`web_app_entitlements?environment=eq.${mode}&status=in.(active,trialing,past_due)&ios_overlap_notified_at=is.null&select=stripe_subscription_id,stripe_customer_id,user_id,tier,site_slug&order=ios_overlap_checked_at.asc.nullsfirst&limit=${limit}`)) ?? [],
    stampChecked: async (id) => { await patch(id, { ios_overlap_checked_at: new Date().toISOString() }); },
    appStoreState: (uid) => appStoreStateOf(uid, mode),
    claim: async (id) => ((await patch(id, { ios_overlap_notified_at: new Date().toISOString() }, '&ios_overlap_notified_at=is.null')) ?? []).length > 0,
    release: async (id) => { await patch(id, { ios_overlap_notified_at: null }); },
    async mailCustomer(row) {
      const { email, firstName } = await contactFor(row.user_id, row.stripe_customer_id);
      if (!email) return false;
      await sendMail(email, iosOverlapEmail({ email, firstName, siteUrl: row.site_slug ? await stampedSiteUrl(row.site_slug) : null, tier: row.tier }));
      return true;
    },
    // live mode counts Production rows only, test mode Sandbox only (a Sandbox row must never suppress a live customer's email).
    async holdsAppleAddress(uid) { return ((await sbRest(`ios_purchases?user_id=eq.${enc(uid)}&site_slug=not.is.null&environment=eq.${mode === 'live' ? 'Production' : 'Sandbox'}&select=original_transaction_id&limit=1`)) ?? []).length > 0; },
    async liveApplePurchases(uid) {
      const rows: any[] = (await sbRest(`ios_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id,product_id,environment,expires_at,revoked_at,taken_down_at,site_slug,published_at&limit=20`)) ?? [];
      return rows.filter((p) => (mode === 'live' ? p.environment === 'Production' : p.environment === 'Production' || p.environment === 'Sandbox') && purchaseLive(p)).length;
    },
    alert: (subject, lines) => alertOwner(subject, lines),
    mailOwner: (row, state, note, extra) => alertOwner('Prime Barber web: subscriber also has an App Store plan', [`user: ${row.user_id}`, `web subscription: ${row.stripe_subscription_id} (${row.tier})`, `site: ${row.site_slug ?? '(none)'}`, `App Store state: ${state}`, ...(extra ?? []), note]),
    async accountFacts(uid) {
      const app: any[] = (await sbRest(`ios_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id,product_id,environment,expires_at,revoked_at,taken_down_at&limit=20`)) ?? [];
      const live = app.filter((p) => (mode === 'live' ? p.environment === 'Production' : p.environment === 'Production' || p.environment === 'Sandbox') && purchaseLive(p));
      const sites: any[] = (await sbRest(`web_app_sites?user_id=eq.${enc(uid)}&environment=eq.${mode}&published_at=not.is.null&select=slug&limit=1`)) ?? [];
      let ledgerAlerted = false;
      try { ledgerAlerted = ((await sbRest(`blocked_purchases?user_id=eq.${enc(uid)}&alerted_at=not.is.null&select=original_transaction_id&limit=1`)) ?? []).length > 0; } catch { /* no ledger table: nothing alerted */ }
      const { liveSignupNudgeDeps } = await import('./signupNudges.js');
      const email = (await liveSignupNudgeDeps(mode).adminUser(uid).catch(() => null))?.email ?? null;
      return { email, appleSubs: live.map((p) => p.original_transaction_id as string), hasSite: sites.length > 0, ledgerAlerted };
    },
  };
}
