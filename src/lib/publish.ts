import type { WebsiteData } from '@/web/types';
import { track } from '@/lib/analytics';
import { ApiError, type api } from '@/lib/api';
import { stripMarkers } from '@/lib/editable';
import type { SiteRecord } from '@/lib/siteStore';

/** The two App Store products that entitle one hosted site (Superwall entitlement `hosting`). */
export const PRODUCT_IDS = [
  'com.ibrahim1774.aibarber.hosting.monthly',
  'com.ibrahim1774.aibarber.hosting.yearly',
] as const;

export const PENDING_MESSAGE =
  "Your payment went through. We're finishing your website — it'll be live in a few minutes.";

export interface PublishDeps {
  hasEntitlement(): Promise<boolean>;
  /** registerPlacement('publish', feature) */
  showPaywall(): Promise<'purchased' | 'restored' | 'declined'>;
  /** getCustomerInfo().subscriptions → pickLatestTransactionId */
  latestTransactionId(): Promise<string | null>;
  iosPublish: typeof api.iosPublish;
  store: typeof import('./siteStore');
  userId(): string | null;
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

async function transactionIdWithRetry(deps: PublishDeps): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    const id = await deps.latestTransactionId().catch(() => null);
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

const retryLater = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500);

/**
 * Sends the saved pending publish. The pending record is only cleared once
 * the server has answered for good: live, inactive (402), or rejected (other
 * 4xx, rethrown). Network failures and 5xx keep it for the launch retry.
 */
async function send(
  pending: { transactionId: string; data: WebsiteData },
  deps: PublishDeps,
): Promise<PublishOutcome> {
  let res: Awaited<ReturnType<PublishDeps['iosPublish']>>;
  try {
    res = await deps.iosPublish({ transactionId: pending.transactionId, siteData: pending.data, userId: deps.userId() });
  } catch (e) {
    if (retryLater(e)) {
      track('publish_pending', { code: (e as ApiError).code });
      return { kind: 'pending', message: PENDING_MESSAGE };
    }
    await deps.store.savePendingPublish(null);
    if (e instanceof ApiError && e.status === 402) {
      track('publish_inactive');
      return { kind: 'inactive' };
    }
    track('publish_failed', { code: e instanceof ApiError ? e.code : 'unknown' });
    throw e;
  }
  // Merge into the latest record: the editor may have saved since this started.
  const cur = await deps.store.loadSite();
  if (cur) {
    await deps.store.saveSite({
      ...cur,
      slug: res.siteId,
      deployedUrl: res.deployedUrl,
      transactionId: pending.transactionId,
    });
  }
  await deps.store.savePendingPublish(null);
  track('site_published', { republished: res.republished });
  return { kind: 'live', url: res.deployedUrl, republished: res.republished };
}

// The launch retry and a Publish tap must never send at the same time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Pay (unless already entitled) → transaction id → save the pending publish →
 * POST /api/ios/publish. The purchase conversion is tracked by SubscriptionSync
 * from Superwall's own events, not here.
 */
export async function publishFlow(site: SiteRecord, deps: PublishDeps): Promise<PublishOutcome> {
  return serial(async () => {
    if (!(await deps.hasEntitlement().catch(() => false))) {
      const result = await deps.showPaywall();
      if (result === 'declined') return { kind: 'declined' } as const;
    }
    const transactionId = await transactionIdWithRetry(deps);
    if (!transactionId) return { kind: 'pending', message: PENDING_MESSAGE } as const;
    const pending = { transactionId, data: publishPayload(site.data), createdAt: Date.now() };
    await deps.store.savePendingPublish(pending);
    return send(pending, deps);
  });
}

/** Run once at launch: finishes a publish that was paid for but never confirmed. */
export async function resumePendingPublish(deps: PublishDeps): Promise<PublishOutcome | null> {
  return serial(async () => {
    const pending = await deps.store.loadPendingPublish();
    if (!pending) return null;
    return send(pending, deps);
  });
}
