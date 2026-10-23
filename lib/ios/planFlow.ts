// /api/shop/plan (Phase 4 tiers): the owner's current plan, as the server's gates see it.
// GET reads it; POST (right after an upgrade purchase) asks Apple for the purchase's latest
// product first, records it and links the purchase to the shop if it has none.
//
// Owner only: Authorization: Bearer <Supabase access token>. Pure flow over injected deps;
// livePlanDeps() wires Supabase and Apple for api/shop/plan.ts.
import { authenticate, liveGetUser, type GetUser } from '../bookings/auth.js';
import { isObj, type FlowResult } from '../bookings/core.js';
import { serviceClient, supabaseBookingRepo, type ShopRow } from '../bookings/repo.js';
import { userLimiter, type RateLimiter } from '../bookings/rateLimit.js';
import { VerifyFailure, isActive, lazyDefaultVerifier, type VerifiedTx } from './appleVerify.js';
import { entitlementActive, purchaseLive } from './lapse.js';
import { supabasePurchases, type PurchaseRow } from './purchases.js';
import { tierOf, type Tier } from './tiers.js';

export interface PlanView {
  /** The shop has a purchase linked (ab_shops.ios_otid). */
  linked: boolean;
  tier: Tier | null;
  /** All false unless active. */
  entitlements: { hosting: boolean; bookings: boolean; store: boolean };
  /** Not revoked, not taken down, and not a lapsed purchase the sweep never takes down (purchaseLive). */
  active: boolean;
  expiresAt: string | null;
  takenDownAt: string | null;
  revoked: boolean;
}

export interface PlanDeps {
  getUser: GetUser;
  shopByOwner(userId: string): Promise<Pick<ShopRow, 'id' | 'ios_otid'> | null>;
  /** The full ios_purchases row (expires_at included). */
  purchase(otid: string): Promise<PurchaseRow | null>;
  verify(transactionId: string): Promise<VerifiedTx>;
  upsertVerified(tx: VerifiedTx, opts?: { checkedAt?: number }): Promise<PurchaseRow>;
  setShopOtid(shopId: string, otid: string): Promise<'ok' | 'taken'>;
  setUser(otid: string, userId: string): Promise<void>;
  now?(): number;
  /** Is migration 015 (member title / booking_url, ab_add_member) applied? Adds `capabilities.memberProfile` to GET when present. */
  memberProfileLive?(): Promise<boolean>;
  /** Per-user write limit on POST (each call costs App Store Server API requests). Absent = none. */
  limiter?: Pick<RateLimiter, 'allow'>;
}

type Auth = string | string[] | undefined;

const isoOrNull = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/**
 * The GET body. `active` and `entitlements` are exactly what the server's gates use
 * (lib/ios/lapse.ts purchaseLive / entitlementActive at `now`), so the app never shows a plan
 * the gates refuse.
 */
export function planView(shop: Pick<ShopRow, 'ios_otid'>, row: PurchaseRow | null, now: number): PlanView {
  const linked = !!shop.ios_otid;
  if (!linked || !row) {
    return {
      linked, tier: null, entitlements: { hosting: false, bookings: false, store: false },
      active: false, expiresAt: null, takenDownAt: null, revoked: false,
    };
  }
  return {
    linked,
    tier: tierOf(row.product_id),
    entitlements: {
      hosting: entitlementActive(row, 'hosting', now),
      bookings: entitlementActive(row, 'bookings', now),
      store: entitlementActive(row, 'store', now),
    },
    active: purchaseLive(row, now),
    expiresAt: isoOrNull(row.expires_at),
    takenDownAt: isoOrNull(row.taken_down_at),
    revoked: !!row.revoked_at,
  };
}

const err = (status: number, error: string, extra: Record<string, unknown> = {}): FlowResult => ({ status, body: { error, ...extra } });
const invalidTx = () => err(400, 'invalid', { field: 'transactionId' });

async function owner(auth: Auth, deps: PlanDeps) {
  const a = await authenticate(auth, deps.getUser);
  if (a.ok === false) return { result: { status: a.status, body: a.body } as FlowResult };
  const shop = await deps.shopByOwner(a.user.id);
  if (!shop) return { result: err(404, 'no-shop') };
  return { user: a.user, shop };
}

/** GET /api/shop/plan */
export async function getPlan(auth: Auth, deps: PlanDeps): Promise<FlowResult> {
  const o = await owner(auth, deps);
  if (o.result) return o.result;
  const row = o.shop.ios_otid ? await deps.purchase(o.shop.ios_otid) : null;
  const view = planView(o.shop, row, (deps.now ?? Date.now)());
  if (!deps.memberProfileLive) return { status: 200, body: view };
  // A failed probe reads as "not live": the app then keeps website-only fields in site JSON.
  const memberProfile = await deps.memberProfileLive().catch(() => false);
  return { status: 200, body: { ...view, capabilities: { memberProfile } } };
}

/**
 * POST /api/shop/plan { transactionId }: verify with Apple (the latest product), record it,
 * and, when Apple says it is active, link the shop to this purchase under setup's rules
 * (409 purchase-in-use when another user owns it or another shop holds it), then return the
 * GET body. A shop linked to a different purchase is relinked: the purchase the owner just
 * paid for is the one that gates. An inactive purchase changes no link. Limited per user
 * (the write limit), failing open.
 */
export async function refreshPlan(auth: Auth, body: unknown, deps: PlanDeps): Promise<FlowResult> {
  const o = await owner(auth, deps);
  if (o.result) return o.result;
  const { user } = o;
  let shop = o.shop;
  const raw = isObj(body) ? body.transactionId : undefined;
  const transactionId = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{1,32}$/.test(transactionId)) return invalidTx();

  if (deps.limiter) {
    let allowed = true;
    try {
      allowed = await deps.limiter.allow(user.id, 'write'); // the 'user' scope
    } catch (e: any) {
      console.error('[shop/plan] rate limiter failed, allowing:', e?.message || e); // fail open
    }
    if (!allowed) return { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '60' } };
  }

  const now = deps.now ?? Date.now;
  // Captured before asking Apple, so a revocation newer than this answer is never cleared.
  const checkedAt = now();
  let tx: VerifiedTx;
  try {
    tx = await deps.verify(transactionId);
  } catch (e: any) {
    if (e instanceof VerifyFailure && e.code !== 'apple-unavailable') return invalidTx();
    console.error('[shop/plan] purchase verify failed:', e?.message || e);
    return err(503, 'temporarily-unavailable');
  }
  const otid = tx.originalTransactionId;
  const row = await deps.upsertVerified(tx, { checkedAt });

  if (row.user_id && row.user_id !== user.id) return err(409, 'purchase-in-use');
  // Only a live purchase (Apple: active or billing grace) may take over the shop's link. An
  // expired, revoked or retrying one (an old Apple ID, a stale transaction) leaves the shop
  // exactly as it was, and the current plan comes back.
  if (!isActive(tx, now())) {
    const current = shop.ios_otid ? (shop.ios_otid === otid ? row : await deps.purchase(shop.ios_otid)) : null;
    return { status: 200, body: planView(shop, current, now()) };
  }
  if (!row.user_id) {
    try {
      await deps.setUser(otid, user.id);
    } catch (e: any) {
      // Best effort: the ios_otid unique index already stops a second shop on this purchase.
      console.error('[shop/plan] linking purchase to account failed:', e?.message || e);
    }
  }
  if (shop.ios_otid !== otid) {
    if ((await deps.setShopOtid(shop.id, otid)) === 'taken') return err(409, 'purchase-in-use');
    shop = { ...shop, ios_otid: otid };
  }
  return { status: 200, body: planView(shop, row, now()) };
}

/** Real dependencies for api/shop/plan.ts (service-role Supabase, Apple). */
export function livePlanDeps(): PlanDeps {
  const client = serviceClient();
  const shops = supabaseBookingRepo(client);
  const purchases = supabasePurchases(client);
  return {
    getUser: liveGetUser(client),
    shopByOwner: (uid) => shops.shopByOwner(uid),
    purchase: (otid) => purchases.get(otid),
    // Lazy: missing Apple env vars surface as a mapped 503, not a crash at wiring time.
    verify: lazyDefaultVerifier(),
    upsertVerified: (tx, opts) => purchases.upsertVerified(tx, opts),
    setShopOtid: (id, otid) => shops.setShopOtid(id, otid),
    setUser: (otid, uid) => purchases.setUser(otid, uid),
    now: Date.now,
    memberProfileLive: () => shops.memberProfileLive(),
    limiter: userLimiter,
  };
}
