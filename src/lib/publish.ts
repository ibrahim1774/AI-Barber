import type { WebsiteData } from '@/web/types';
import { adoptAndSave, isPlainSiteData, SYNC_NOTICE, SYNC_TIMEOUT_MS, UPDATED_ON_PUBLISH_MESSAGE, versionFields, type ServerSite, type SyncResult } from '@/lib/adminSync';
import { track } from '@/lib/analytics';
import { ApiError, type api } from '@/lib/api';
import { stripMarkers } from '@/lib/editable';
import { linksOf, linksToSend, type LinkContext } from '@/lib/bookingChoice';
import { cancelRemindersInBackground } from '@/lib/reminders';
import { emitSiteLive } from '@/lib/siteEvents';
import type { SiteRecord } from '@/lib/siteStore';
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

/** A pending publish older than this is dropped instead of retried. */
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PublishDeps {
  hasEntitlement(): Promise<boolean>;
  /** registerPlacement('publish', feature) */
  showPaywall(): Promise<'purchased' | 'restored' | 'declined'>;
  /** getCustomerInfo().subscriptions → pickLatestTransactionId */
  latestTransactionId(): Promise<string | null>;
  iosPublish: typeof api.iosPublish;
  /** The shop facts that decide the Book / Shop links on every publish. Without it, links the plan lacks are only stripped. */
  linkContext?(): Promise<LinkContext | null>;
  /** The site data with `staff` refreshed from ab_members (team profiles). Must not throw; capped like linkContext. */
  refreshTeam?(data: WebsiteData): Promise<WebsiteData>;
  store: typeof import('./siteStore');
  /** GET /api/ios/site → adopt a newer admin edit (adminSync.syncFromServer). Optional; never throws. */
  syncFromServer?(transactionId: string): Promise<SyncResult>;
  /**
   * True when `transactionId` is bound to a different live site than `site` (this Apple ID's site is
   * someone else's here). Optional; a failure counts as false.
   */
  boundElsewhere?(transactionId: string, site: SiteRecord): Promise<boolean>;
  /** The signed-in Supabase user (older servers read it from the body). */
  userId(): string | null;
  /** The signed-in user's access token (refreshed when near expiry): the server links the purchase only from it. */
  accessToken?(): Promise<string | null>;
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
  | { kind: 'pending'; message: string }
  | { kind: 'inactive' }
  /** An admin edit is newer: the server copy was adopted and nothing was published. Review, then publish again. */
  | { kind: 'site-updated'; message: string }
  /** Nothing was published: this phone's site would overwrite a different live site bound to the Apple ID. */
  | { kind: 'blocked'; message: string };

export const BOUND_ELSEWHERE_MESSAGE =
  "This phone's Apple ID already runs a different website, so this one wasn't published and your live site is untouched. To publish this one, subscribe with another Apple ID.";

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
 * Sends the saved pending publish. The pending record is only cleared on a
 * final answer: live, inactive (402), or a malformed payload (400
 * bad-request, rethrown). Everything else — network, 5xx, 404 while Apple
 * catches up, other 4xx, a garbled 200 — keeps it for the next retry and
 * returns `pending` with `retryMessage`.
 */
async function send(
  pending: { transactionId: string; data: WebsiteData; baseVersion?: number },
  deps: PublishDeps,
  retryMessage: string,
): Promise<PublishOutcome> {
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
    const token = deps.accessToken ? await deps.accessToken().catch(() => null) : null;
    res = await deps.iosPublish(
      {
        transactionId: pending.transactionId,
        siteData,
        userId: deps.userId(),
        // The version this data was based on, never the live record's (an admin edit may have landed since).
        ...(typeof pending.baseVersion === 'number' ? { baseVersion: pending.baseVersion } : {}),
      },
      // Only when signed in (older callers and test doubles see the one-argument call).
      ...(token ? [token] : []),
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'site-updated') {
      // Never auto-republish: adopt the admin's copy and let the barber review it.
      const server = e.body?.site as ServerSite | undefined;
      const adopted = isPlainSiteData(server?.siteData) ? await adoptAndSave(deps.store, UPDATED_ON_PUBLISH_MESSAGE, server) : null;
      let site = adopted?.site;
      // No usable copy in the 409: fetch it. If that fails too, this is an error, not a "review it" outcome.
      if (!site) {
        const synced = await deps.syncFromServer?.(pending.transactionId).catch(() => null);
        if (synced?.kind === 'adopted') site = synced.site;
      }
      if (!site) throw e;
      await deps.store.savePendingPublish(null);
      track('publish_site_updated');
      notifyLive(deps, site);
      return { kind: 'site-updated', message: adopted?.message ?? UPDATED_ON_PUBLISH_MESSAGE };
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
    return { kind: 'pending', message: retryMessage };
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
      transactionId: pending.transactionId,
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

/**
 * Fails closed: only a clean "not bound elsewhere" answer lets a publish through.
 * A thrown check (network, 5xx, timeout) is 'unknown'; the caller keeps the pending record and retries later.
 */
async function checkBound(deps: PublishDeps, transactionId: string, site: SiteRecord): Promise<'ok' | 'blocked' | 'unknown'> {
  if (!(site.slug == null && site.ownerUserId) || !deps.boundElsewhere) return 'ok';
  try {
    return (await deps.boundElsewhere(transactionId, site)) ? 'blocked' : 'ok';
  } catch {
    return 'unknown';
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

/** True while a publish or retry is running, so a new one would wait its turn. */
export function publishBusy(): boolean {
  return queued > 0;
}

/**
 * Pay (unless already entitled) → transaction id → save the pending publish →
 * POST /api/ios/publish. Only a found, active transaction for our products
 * proves payment; showPaywall's 'purchased' is itself verified (paywall.tsx).
 * The purchase conversion is tracked by SubscriptionSync from Superwall's own
 * events, not here.
 */
export async function publishFlow(site: SiteRecord, deps: PublishDeps): Promise<PublishOutcome> {
  return serial(async () => {
    const data = publishPayload(site.data);
    let paid = false;
    if (!(await deps.hasEntitlement().catch(() => false))) {
      const result = await deps.showPaywall();
      if (result === 'declined') return { kind: 'declined' } as const;
      paid = true;
      // Remember the purchase before anything else can fail; the id is looked up next.
      await deps.store.savePendingPublish({
        transactionId: null, data, createdAt: Date.now(), baseVersion: (await deps.store.loadSite())?.serverVersion,
      });
      // Paid: no "publish your site" reminders while it goes live (not for
      // good: a purchase that can't be confirmed brings them back).
      cancelRemindersInBackground({ forGood: false });
    }
    const transactionId = await findTransactionId(deps.latestTransactionId);
    if (!transactionId) return { kind: 'pending', message: UNCONFIRMED_MESSAGE } as const;
    // A site loaded from an account (no slug of its own) must never publish over the live site the Apple ID is bound to.
    const guard = await checkBound(deps, transactionId, site);
    if (guard === 'blocked') {
      if (paid) await deps.store.savePendingPublish(null);
      return { kind: 'blocked', message: BOUND_ELSEWHERE_MESSAGE } as const;
    }
    if (guard === 'unknown') {
      // Could not check: fail closed. Keep the paid record (the retry runs the same check).
      if (paid) await deps.store.savePendingPublish({ transactionId, data, createdAt: Date.now(), baseVersion: (await deps.store.loadSite())?.serverVersion });
      return { kind: 'pending', message: UPDATING_MESSAGE } as const;
    }
    // An admin edit must reach the barber before their publish can overwrite it.
    const synced = await deps.syncFromServer?.(transactionId).catch(() => null);
    if (synced?.kind === 'adopted') {
      return { kind: 'site-updated', message: UPDATED_ON_PUBLISH_MESSAGE + synced.message.slice(SYNC_NOTICE.length) } as const;
    }
    const pending = { transactionId, data, createdAt: Date.now(), baseVersion: (await deps.store.loadSite())?.serverVersion };
    await deps.store.savePendingPublish(pending);
    return send(pending, deps, paid ? PENDING_MESSAGE : UPDATING_MESSAGE);
  });
}

/**
 * At launch and whenever the app comes back to the foreground: finishes a
 * publish that was paid for but never confirmed. A record saved before its
 * transaction id was found looks the id up first, and is dropped if there is
 * no active subscription.
 */
export async function resumePendingPublish(deps: PublishDeps): Promise<PublishOutcome | null> {
  return serial(async () => {
    const pending = await deps.store.loadPendingPublish();
    if (!pending) return null;
    if (Date.now() - pending.createdAt > PENDING_MAX_AGE_MS) {
      await deps.store.savePendingPublish(null);
      track('publish_pending_expired');
      return null;
    }
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
    const cur = await deps.store.loadSite();
    if (cur) {
      const guard = await checkBound(deps, transactionId, cur);
      if (guard === 'blocked') {
        await deps.store.savePendingPublish(null);
        return { kind: 'blocked', message: BOUND_ELSEWHERE_MESSAGE } as const;
      }
      if (guard === 'unknown') return { kind: 'pending', message: UPDATING_MESSAGE } as const;
    }
    return send({ transactionId, data: pending.data, baseVersion: pending.baseVersion }, deps, PENDING_MESSAGE);
  });
}
