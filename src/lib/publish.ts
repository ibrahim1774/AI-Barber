import type { WebsiteData } from '@/web/types';
import { adoptAndSave, isPlainSiteData, SYNC_NOTICE, SYNC_TIMEOUT_MS, UPDATED_ON_PUBLISH_MESSAGE, versionFields, type ServerSite, type SyncResult } from '@/lib/adminSync';
import { track } from '@/lib/analytics';
import { ApiError, type api } from '@/lib/api';
import { stripMarkers } from '@/lib/editable';
import { linksOf, linksToSend, type LinkContext } from '@/lib/bookingChoice';
import { cancelRemindersInBackground } from '@/lib/reminders';
import { emitSiteLive } from '@/lib/siteEvents';
import type { PendingPublish, SiteRecord } from '@/lib/siteStore';
import { CLAIMED_SIGNED_OUT_MESSAGE, conflictMessage, type Conflict } from '@/lib/claimCopy';
import type { PlanHint } from '@/lib/publishRequest';
import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

/**
 * The App Store products that entitle one hosted site: the Website, Bookings and
 * Store plans, monthly and yearly. Any of the six counts as paid at publish; the
 * entitlements say which tabs unlock.
 */
export const PRODUCT_IDS = [
  'com.ibrahim1774.aibarber.hosting.monthly',
  'com.ibrahim1774.aibarber.hosting.yearly',
  'com.ibrahim1774.aibarber.bookings.monthly',
  'com.ibrahim1774.aibarber.bookings.yearly',
  'com.ibrahim1774.aibarber.store.monthly',
  'com.ibrahim1774.aibarber.store.yearly',
] as const;

/** Only after a purchase verified in this run, once its pending publish is saved. */
export const PENDING_MESSAGE =
  "Your payment went through. We're finishing your website — it'll be live in a few minutes.";
/** No active AI Barber transaction found: never claim a payment. */
export const UNCONFIRMED_MESSAGE =
  "We couldn't confirm your purchase yet. If you were charged, tap Publish again in a minute or use Restore Purchases.";
/** An entitled republish (nothing bought this run) that couldn't finish yet. */
export const UPDATING_MESSAGE = "Your website is still being updated. We'll finish publishing it shortly.";

/** An entitled republish whose ownership check failed: nothing is queued, so say to try again. */
export const CHECK_FAILED_MESSAGE = "We couldn't check your site just now, so nothing was published. Please try again in a moment.";

/** A plain pending publish older than this is dropped instead of retried. A paid, unclaimed one (state set) never is. */
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PublishDeps {
  hasEntitlement(): Promise<boolean>;
  /** registerPlacement('publish', feature); the plan hint rides along as the placement's params. */
  showPaywall(planHint?: PlanHint): Promise<'purchased' | 'restored' | 'declined'>;
  /** getCustomerInfo().subscriptions → pickLatestTransactionId */
  latestTransactionId(): Promise<string | null>;
  iosPublish: typeof api.iosPublish;
  /** POST /api/ios/claim-start: bookkeeping right after a purchase, before any account. */
  claimStart: typeof api.claimStart;
  /** The shop facts that decide the Book / Shop links on every publish. Without it, links the plan lacks are only stripped. */
  linkContext?(): Promise<LinkContext | null>;
  /** The site data with `staff` refreshed from ab_members (team profiles). Must not throw; capped like linkContext. */
  refreshTeam?(data: WebsiteData): Promise<WebsiteData>;
  store: typeof import('./siteStore');
  /** POST /api/ios/site (Bearer) → adopt a newer admin edit (adminSync.syncFromServer). Optional; never throws. */
  syncFromServer?(transactionId: string): Promise<SyncResult>;
  /**
   * The signed-in user's access token (refreshed when near expiry), null when signed out. Every publish needs it:
   * the server links the purchase to the account from it, so without one nothing is sent.
   */
  accessToken(): Promise<string | null>;
  /**
   * The caller just completed a verified purchase (an upgrade paywall that returned 'purchased'). Treated like a
   * purchase made here: the paid record is saved before anything can fail, so a failing claim-start never loses it.
   */
  purchasedNow?: boolean;
  /**
   * After a publish is saved locally (publishFlow and the launch retry alike):
   * keeps the account's `sites` row current. Not awaited, and its failure
   * never turns a live site into an error.
   */
  onLive?(site: SiteRecord): Promise<void> | void;
}

export type PublishOutcome =
  | { kind: 'live'; url: string; republished: boolean }
  | { kind: 'declined' }
  /** Not live yet. `offline`: the request never reached the server (the locked step then says "waiting for connection"). */
  | { kind: 'pending'; message: string; offline?: boolean }
  | { kind: 'inactive' }
  /** An admin edit is newer: the server copy was adopted and nothing was published. Review, then publish again. */
  | { kind: 'site-updated'; message: string }
  /** The server refused: the purchase is another account's, or this account already has a site. Nothing was published. */
  | { kind: 'blocked'; message: string; /** The purchase is another account's: "Move subscription to this account" can fix it. */ movable?: boolean }
  /** Paid but no usable session: the locked account step comes next (route /claim). Nothing was sent. */
  | { kind: 'claim-required' };

/** Superwall can lag behind StoreKit right after a purchase: first try plus 3 retries, 1 s apart. */
const TX_RETRIES = 3;
const TX_RETRY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SubscriptionLike {
  transactionId: string;
  productId: string;
  purchaseDate: string;
  isActive: boolean;
  isRevoked?: boolean;
}

/** The newest active, unrevoked AI Barber subscription's transaction id (CustomerInfo.subscriptions). */
export function pickLatestTransactionId(subs: SubscriptionLike[]): string | null {
  let best: SubscriptionLike | null = null;
  let bestAt = -Infinity;
  for (const s of subs) {
    if (!s.isActive || s.isRevoked || !(PRODUCT_IDS as readonly string[]).includes(s.productId)) continue;
    const at = Date.parse(s.purchaseDate);
    const t = Number.isNaN(at) ? 0 : at;
    if (!best || t > bestAt) {
      best = s;
      bestAt = t;
    }
  }
  return best?.transactionId ?? null;
}

/** `lookup` until it finds an id: first try plus 3 retries, 1 s apart. A throw counts as not found. */
export async function findTransactionId(lookup: () => Promise<string | null>): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const id = await lookup().catch(() => null);
    if (id) return id;
    if (attempt >= TX_RETRIES) return null;
    await sleep(TX_RETRY_MS);
  }
}

/**
 * The payload the server accepts: no editor markers anywhere, and no inline
 * `data:` URLs (the server 400s on any string starting with one). Such a slot
 * becomes '' rather than being removed, so image indexes stay matched.
 */
function clean(v: unknown): unknown {
  if (typeof v === 'string') {
    const s = stripMarkers(v);
    return /^\s*data:/i.test(s) ? '' : s;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = clean(val);
    return out;
  }
  return v;
}

export function publishPayload(data: WebsiteData): WebsiteData {
  const c = clean(data) as WebsiteData;
  // Shapes the server requires; a missing one would be a 400.
  return {
    ...c,
    hero: c.hero ?? ({} as WebsiteData['hero']),
    about: c.about ?? ({} as WebsiteData['about']),
    gallery: Array.isArray(c.gallery) ? c.gallery : [],
    services: Array.isArray(c.services) ? c.services : [],
  };
}

/**
 * Sends the saved pending publish with the account's Bearer (never without one: no token means no request and the
 * locked account step). The pending record is only cleared on a final answer: live, inactive (402), a malformed
 * payload (400 bad-request, rethrown) or, for an ordinary retry, a 409 refusal. A paid claim (state set) keeps its
 * record through a 409 as state 'conflict'. Everything else — network, 5xx, 404 while Apple catches up, other 4xx,
 * a garbled 200 — keeps it for the next retry and returns `pending` with `retryMessage`.
 */
async function send(pending: PendingPublish, deps: PublishDeps, retryMessage: string): Promise<PublishOutcome> {
  const token = await deps.accessToken().catch(() => null);
  if (!token) return toClaim(deps, pending);
  const transactionId = pending.transactionId!;
  let res: Awaited<ReturnType<PublishDeps['iosPublish']>>;
  // Capped like the admin sync: a stalled shop lookup is "unknown", never a stuck publish.
  const ctx = deps.linkContext ? await withTimeout(deps.linkContext(), SYNC_TIMEOUT_MS).catch(() => null) : null;
  // One load: its inputs decide the links, its updatedAt marks what this publish covers.
  const rec = await deps.store.loadSite().catch(() => null);
  const sentAt = rec?.updatedAt;
  // Whenever the AI Barber link is dropped (plan, shop, unknown context), the barber's own link is used.
  // Team cards come from ab_members (source of truth): refresh them before they go online.
  const fresh = deps.refreshTeam ? await withTimeout(deps.refreshTeam(pending.data), SYNC_TIMEOUT_MS).catch(() => pending.data) : pending.data;
  const siteData = linksToSend(fresh, rec?.inputs, ctx);
  try {
    res = await deps.iosPublish(
      {
        transactionId,
        siteData,
        // The version this data was based on, never the live record's (an admin edit may have landed since).
        ...(typeof pending.baseVersion === 'number' ? { baseVersion: pending.baseVersion } : {}),
      },
      token,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'site-updated') {
      // Never auto-republish: adopt the admin's copy and let the barber review it.
      const server = e.body?.site as ServerSite | undefined;
      const adopted = isPlainSiteData(server?.siteData) ? await adoptAndSave(deps.store, UPDATED_ON_PUBLISH_MESSAGE, server) : null;
      let site = adopted?.site;
      // No usable copy in the 409: fetch it. If that fails too, this is an error, not a "review it" outcome.
      if (!site) {
        const synced = await deps.syncFromServer?.(transactionId).catch(() => null);
        if (synced?.kind === 'adopted') site = synced.site;
      }
      if (!site) throw e;
      await deps.store.savePendingPublish(null);
      track('publish_site_updated');
      notifyLive(deps, site);
      return { kind: 'site-updated', message: adopted?.message ?? UPDATED_ON_PUBLISH_MESSAGE };
    }
    if (e instanceof ApiError && e.status === 409 && (e.code === 'purchase-other-account' || e.code === 'account-has-site')) {
      const conflict: Conflict =
        e.code === 'account-has-site'
          ? { code: 'account-has-site', slug: typeof e.body?.slug === 'string' ? e.body.slug : null, reason: e.body?.reason === 'shop' ? 'shop' : 'site' }
          : { code: 'purchase-other-account', hint: typeof e.body?.hint === 'string' ? e.body.hint : null };
      track('publish_conflict', { code: e.code });
      // A paid claim stays locked on its account step; an ordinary publish just stops.
      if (pending.state) await deps.store.savePendingPublish({ ...pending, state: 'conflict', conflict });
      else await deps.store.savePendingPublish(null);
      return { kind: 'blocked', message: conflictMessage(conflict), ...(conflict.code === 'purchase-other-account' ? { movable: true } : {}) };
    }
    if (e instanceof ApiError && e.status === 401) {
      // The server does not accept this session: back to the account step, record kept.
      track('publish_unauthorized');
      return toClaim(deps, pending);
    }
    if (e instanceof ApiError && e.status === 409 && e.code === 'purchase-changed') {
      // A move took the purchase while this publish ran (the server put its offline page back). Not offline, so it
      // is never auto-retried; the record stays and the next tap re-checks whose purchase it is.
      track('publish_purchase_changed');
      return { kind: 'pending', message: 'This subscription just changed accounts. Tap Publish to try again.' };
    }
    if (e instanceof ApiError && e.status === 402) {
      await deps.store.savePendingPublish(null);
      track('publish_inactive');
      return { kind: 'inactive' };
    }
    if (e instanceof ApiError && e.status === 400 && e.code === 'bad-request') {
      await deps.store.savePendingPublish(null);
      track('publish_failed', { code: e.code });
      throw e;
    }
    track('publish_pending', { code: e instanceof ApiError ? e.code : 'unknown' });
    return { kind: 'pending', message: retryMessage, ...(e instanceof ApiError && e.status === 0 ? { offline: true } : {}) };
  }
  // A 200 without a usable answer (a proxy page parsed as JSON, an API change) is not live: keep the
  // pending publish for the retry instead of saving a record bound to nothing.
  if (!isLiveAnswer(res)) {
    track('publish_pending', { code: 'bad-response' });
    return { kind: 'pending', message: retryMessage };
  }
  const republished = res.republished === true;
  // Merge into the latest record: the editor may have saved since this started.
  const cur = await deps.store.loadSite();
  let saved: SiteRecord | null = null;
  if (cur) {
    const learned = versionFields(res);
    // Never lower the version: a newer one may have been adopted (an admin edit) while this answer was on
    // its way. Then that record's version and sync point stay; this publish is older than what it holds.
    const newerOnDisk =
      typeof cur.serverVersion === 'number' && typeof learned.serverVersion === 'number' &&
      cur.serverVersion > learned.serverVersion;
    saved = {
      ...cur,
      slug: res.siteId,
      deployedUrl: res.deployedUrl,
      transactionId,
      // Edits made while the request ran are not published.
      ...(newerOnDisk ? {} : { syncedAt: sentAt ?? cur.updatedAt, ...learned, liveLinks: linksOf(siteData) }),
    };
    await deps.store.saveSite(saved);
    emitSiteLive(saved);
  }
  await deps.store.savePendingPublish(null);
  track('site_published', { republished });
  // Live: no more publish reminders, for good. Never affects the outcome.
  cancelRemindersInBackground();
  if (saved) notifyLive(deps, saved);
  return { kind: 'live', url: res.deployedUrl, republished };
}

/** The publish answer names the live site: a non-empty string siteId and deployedUrl. */
function isLiveAnswer(res: unknown): boolean {
  const r = res as { siteId?: unknown; deployedUrl?: unknown } | null;
  return (
    !!r && typeof r === 'object' &&
    typeof r.siteId === 'string' && r.siteId.length > 0 &&
    typeof r.deployedUrl === 'string' && r.deployedUrl.length > 0
  );
}

function notifyLive(deps: PublishDeps, site: SiteRecord): void {
  const warn = (e: unknown) => console.warn('[publish] after-publish hook failed:', e);
  try {
    Promise.resolve(deps.onLive?.(site)).catch(warn);
  } catch (e) {
    warn(e);
  }
}

// The launch retry and a Publish tap must never send at the same time.
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;
function serial<T>(fn: () => Promise<T>): Promise<T> {
  queued++;
  const run = queue.then(fn, fn).finally(() => queued--);
  queue = run.catch(() => undefined);
  return run;
}

/** Runs `fn` in the publish queue, so it never overlaps a publish or a launch retry. */
export function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  return serial(fn);
}

/** True while a publish or retry is running, so a new one would wait its turn. */
export function publishBusy(): boolean {
  return queued > 0;
}

/** Paid and no usable session: keep the record as 'unclaimed' (the locked /claim step takes it from here). */
async function toClaim(deps: PublishDeps, pending: PendingPublish): Promise<PublishOutcome> {
  const { conflict: _drop, ...rest } = pending;
  await deps.store.savePendingPublish({ ...rest, state: 'unclaimed' });
  track('publish_claim_required');
  return { kind: 'claim-required' };
}

/**
 * Pay (unless already entitled) → transaction id → account → publish.
 *
 * - Signed out: after the verified purchase, POST claim-start (bookkeeping; only a 402 stops here), save the
 *   pending publish as 'unclaimed' and answer `claim-required`: the locked /claim step creates or signs in to an
 *   account, then resumePendingPublish sends the publish with its Bearer. Nothing is ever published without one.
 * - Signed in: the site data is sent with the Bearer right away; the server links the purchase to the account
 *   and decides every conflict (409 purchase-other-account / account-has-site).
 *
 * Only a found, active transaction for our products proves payment; showPaywall's 'purchased' is itself verified
 * (paywall.tsx). The purchase conversion is tracked by SubscriptionSync from Superwall's own events, not here.
 */
export async function publishFlow(site: SiteRecord, deps: PublishDeps, planHint?: PlanHint): Promise<PublishOutcome> {
  return serial(async () => {
    const data = publishPayload(site.data);
    const prior = await deps.store.loadPendingPublish().catch(() => null);
    const token = await deps.accessToken().catch(() => null);
    // A paid record from an earlier tap (or a launch) is never charged twice: no paywall, same transaction.
    const paidBefore = !!prior && (prior.state != null || prior.transactionId != null);
    const baseVersion = (await deps.store.loadSite().catch(() => null))?.serverVersion;
    let paid = false;
    // A paywall "restored" is the Apple ID's earlier purchase, not a payment made now: it never locks the app.
    let bought = false;
    if (!paidBefore && (deps.purchasedNow || !(await deps.hasEntitlement().catch(() => false)))) {
      const result = deps.purchasedNow ? 'purchased' : await deps.showPaywall(planHint);
      if (result === 'declined') return { kind: 'declined' } as const;
      paid = true;
      bought = result === 'purchased';
      // Remember the purchase before anything else can fail; the id is looked up next.
      await deps.store.savePendingPublish({
        transactionId: null, data, createdAt: Date.now(), baseVersion, ...(token ? {} : { state: 'unclaimed' as const }),
      });
      // Paid: no "publish your site" reminders while it goes live (not for
      // good: a purchase that can't be confirmed brings them back).
      cancelRemindersInBackground({ forGood: false });
    }
    const transactionId = (paidBefore ? prior!.transactionId : null) ?? (await findTransactionId(deps.latestTransactionId));
    if (!transactionId) return { kind: 'pending', message: UNCONFIRMED_MESSAGE } as const;
    const base: PendingPublish = {
      transactionId, data, createdAt: Date.now(), baseVersion,
      ...(prior?.state && prior.state !== 'conflict' ? { state: prior.state } : {}),
    };

    if (!token) {
      // No account yet. Only a 402 (refunded / revoked) is final; everything else still goes to the account step,
      // because the publish with a Bearer is what really links the purchase.
      if (prior?.state !== 'unclaimed') {
        try {
          await deps.claimStart(transactionId);
        } catch (e) {
          if (e instanceof ApiError && e.status === 402) {
            await deps.store.savePendingPublish(null);
            track('publish_inactive');
            return { kind: 'inactive' } as const;
          }
          const claimed = e instanceof ApiError && e.status === 409 && e.code === 'purchase-claimed';
          // A legacy purchase that already has a site is claimed by signing up or in, like any other.
          const hasSite = e instanceof ApiError && e.status === 409 && e.code === 'purchase-has-site';
          // Not bought just now and the check failed: nothing was saved, nothing to claim. Say so; never lock the app.
          if (!bought && !paidBefore && !hasSite) {
            // A paywall "restored" saved a record before this check: with nothing to claim it goes again.
            if (paid) await deps.store.savePendingPublish(null);
            return claimed
              ? ({ kind: 'blocked', message: CLAIMED_SIGNED_OUT_MESSAGE } as const)
              : ({ kind: 'pending', message: CHECK_FAILED_MESSAGE, ...(e instanceof ApiError && e.status === 0 ? { offline: true } : {}) } as const);
          }
        }
      }
      return toClaim(deps, { ...base, state: 'unclaimed' });
    }

    // An admin edit must reach the barber before their publish can overwrite it.
    const synced = await deps.syncFromServer?.(transactionId).catch(() => null);
    if (synced?.kind === 'adopted') {
      return { kind: 'site-updated', message: UPDATED_ON_PUBLISH_MESSAGE + synced.message.slice(SYNC_NOTICE.length) } as const;
    }
    // A paid claim keeps its lock until the publish is confirmed ('claiming'); an ordinary payer has no state.
    const pending: PendingPublish = base.state ? { ...base, state: 'claiming' } : base;
    await deps.store.savePendingPublish(pending);
    return send(pending, deps, paid ? PENDING_MESSAGE : UPDATING_MESSAGE);
  });
}

/**
 * At launch, whenever the app comes back to the foreground, and when the locked step has an account: finishes a
 * publish that was paid for but never confirmed. A record saved before its transaction id was found looks the id
 * up first, and is dropped if there is no active subscription. Without a session it never publishes: it answers
 * `claim-required`. A 'conflict' record is left for the locked step to show.
 */
export async function resumePendingPublish(deps: PublishDeps): Promise<PublishOutcome | null> {
  return serial(async () => {
    const pending = await deps.store.loadPendingPublish();
    if (!pending) return null;
    // A paid, unclaimed record is never aged out: that would be losing a payment.
    if (!pending.state && Date.now() - pending.createdAt > PENDING_MAX_AGE_MS) {
      await deps.store.savePendingPublish(null);
      track('publish_pending_expired');
      return null;
    }
    if (pending.state === 'conflict') return null;
    // Paused (the user went back to the editor): without an account nothing is sent and nothing re-locks the app.
    if (pending.state === 'paused' && !(await deps.accessToken().catch(() => null))) return null;
    let transactionId = pending.transactionId;
    if (!transactionId) {
      try {
        transactionId = await withTimeout(deps.latestTransactionId(), LOOKUP_TIMEOUT_MS);
      } catch {
        // Lookup failed or timed out (no Superwall config yet): keep the record, try again later.
        return { kind: 'pending', message: UPDATING_MESSAGE } as const;
      }
      if (!transactionId) {
        await deps.store.savePendingPublish(null);
        track('publish_unconfirmed_dropped');
        return null;
      }
      await deps.store.savePendingPublish({ ...pending, transactionId });
    }
    const token = await deps.accessToken().catch(() => null);
    if (!token) return toClaim(deps, { ...pending, transactionId });
    // An account exists: the locked claim moves on to 'claiming' (still locked until the server confirms).
    const next: PendingPublish = { ...pending, transactionId, ...(pending.state ? { state: 'claiming' as const } : {}) };
    if (next.state !== pending.state) await deps.store.savePendingPublish(next);
    return send(next, deps, PENDING_MESSAGE);
  });
}
