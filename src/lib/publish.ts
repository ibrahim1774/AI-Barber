import type { WebsiteData } from '@/web/types';
import { track } from '@/lib/analytics';
import { ApiError, type api } from '@/lib/api';
import { stripMarkers } from '@/lib/editable';
import { getEntitlements } from '@/lib/entitlements';
import { stripLapsedLinks } from '@/lib/tierLinks';
import { cancelRemindersInBackground } from '@/lib/reminders';
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
  store: typeof import('./siteStore');
  /** The signed-in Supabase user, so the server can link the purchase to the account. */
  userId(): string | null;
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
  | { kind: 'inactive' };

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
  pending: { transactionId: string; data: WebsiteData },
  deps: PublishDeps,
  retryMessage: string,
): Promise<PublishOutcome> {
  let res: Awaited<ReturnType<PublishDeps['iosPublish']>>;
  try {
    res = await deps.iosPublish({ transactionId: pending.transactionId, siteData: stripLapsedLinks(pending.data, getEntitlements()), userId: deps.userId() });
  } catch (e) {
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
  // Merge into the latest record: the editor may have saved since this started.
  const cur = await deps.store.loadSite();
  let saved: SiteRecord | null = null;
  if (cur) {
    saved = { ...cur, slug: res.siteId, deployedUrl: res.deployedUrl, transactionId: pending.transactionId };
    await deps.store.saveSite(saved);
  }
  await deps.store.savePendingPublish(null);
  track('site_published', { republished: res.republished });
  // Live: no more publish reminders, for good. Never affects the outcome.
  cancelRemindersInBackground();
  if (saved) notifyLive(deps, saved);
  return { kind: 'live', url: res.deployedUrl, republished: res.republished };
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
      await deps.store.savePendingPublish({ transactionId: null, data, createdAt: Date.now() });
      // Paid: no "publish your site" reminders while it goes live (not for
      // good: a purchase that can't be confirmed brings them back).
      cancelRemindersInBackground({ forGood: false });
    }
    const transactionId = await findTransactionId(deps.latestTransactionId);
    if (!transactionId) return { kind: 'pending', message: UNCONFIRMED_MESSAGE } as const;
    const pending = { transactionId, data, createdAt: Date.now() };
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
    return send({ transactionId, data: pending.data }, deps, PENDING_MESSAGE);
  });
}
