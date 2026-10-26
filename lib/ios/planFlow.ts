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
import { liveBindingOwner, liveEmailOf, otherAccountBody, type BindingOwner } from './ownership.js';
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
  /**
   * Whose subscription the purchase is, from the caller's side: 'self' (linked to the caller),
   * 'other' (linked to another account: the same Apple ID under a second email), null (no purchase
   * known, or not linked yet). The purchase is the shop's, or the one named by GET ?otid=.
   */
  purchaseAccount: 'self' | 'other' | null;
}

export interface PlanDeps {
  getUser: GetUser;
  shopByOwner(userId: string): Promise<Pick<ShopRow, 'id' | 'ios_otid'> | null>;
  /** The full ios_purchases row (expires_at included). */
  purchase(otid: string): Promise<PurchaseRow | null>;
  verify(transactionId: string): Promise<VerifiedTx>;
  upsertVerified(tx: VerifiedTx, opts?: { checkedAt?: number }): Promise<PurchaseRow>;
  setShopOtid(shopId: string, otid: string | null): Promise<'ok' | 'taken'>;
  /** Atomic conditional link (WHERE user_id IS NULL): true = this call linked it; false = it was already linked. */
  setUserIfUnlinked(otid: string, userId: string): Promise<boolean>;
  /** Masked-hint lookup for a 409 (account id -> email). Absent: hint null. */
  emailOf?(userId: string): Promise<string | null>;
  /** Unlinked purchase (no user_id): which account owns the shop/site bound to it (id, 'ambiguous', null). */
  bindingOwner?(row: PurchaseRow): Promise<BindingOwner>;
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
const accountOf = (row: PurchaseRow | null, userId: string | undefined): PlanView['purchaseAccount'] =>
  !row || !row.user_id || !userId ? null : row.user_id === userId ? 'self' : 'other';

export function planView(shop: Pick<ShopRow, 'ios_otid'>, row: PurchaseRow | null, now: number, userId?: string): PlanView {
  const linked = !!shop.ios_otid;
  const purchaseAccount = accountOf(row, userId);
  if (!linked || !row) {
    return {
      linked, tier: null, entitlements: { hosting: false, bookings: false, store: false },
      active: false, expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount,
    };
  }
  return {
    purchaseAccount,
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

/**
 * GET /api/shop/plan. Optional `otid` (the device's Apple originalTransactionId, digits only) lets a
 * shop-less or differently-linked account learn `purchaseAccount` for that purchase without Apple.
 */
export async function getPlan(auth: Auth, deps: PlanDeps, opts: { otid?: string } = {}): Promise<FlowResult> {
  const a = await authenticate(auth, deps.getUser);
  if (a.ok === false) return { status: a.status, body: a.body };
  const shop = await deps.shopByOwner(a.user.id);
  // A signed-in account with no shop yet is not an error: nothing is granted, so the app shows its upgrade card.
  const row = shop?.ios_otid ? await deps.purchase(shop.ios_otid) : null;
  const asked = opts.otid && /^\d{1,32}$/.test(opts.otid) ? opts.otid : null;
  const askedRow = asked && asked !== shop?.ios_otid ? await deps.purchase(asked) : null;
  const view: PlanView = shop
    ? planView(shop, row, (deps.now ?? Date.now)(), a.user.id)
    : {
        linked: false, tier: null, entitlements: { hosting: false, bookings: false, store: false },
        active: false, expiresAt: null, takenDownAt: null, revoked: false, purchaseAccount: null,
      };
  // The device's own purchase decides the copy when it is not the shop's: another account's wins.
  if (askedRow && accountOf(askedRow, a.user.id) === 'other') view.purchaseAccount = 'other';
  else if (askedRow && !view.purchaseAccount) view.purchaseAccount = accountOf(askedRow, a.user.id);
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

  // A subscription is never movable (DECIDED 2026-10-26): linked to another account = 409, whatever
  // Apple says. `error` stays 'purchase-in-use' for builds that know it; `reason` + `hint` are the new copy.
  if (row.user_id && row.user_id !== user.id) {
    const other = await otherAccountBody(deps.emailOf, row.user_id);
    return err(409, 'purchase-in-use', { reason: other.error, hint: other.hint });
  }
  // An unlinked purchase whose slug/shop already belongs to another account is theirs, not this
  // caller's (the same Apple ID under a second email). Nothing attached yet: first signed-in claim wins.
  if (!row.user_id && row.site_slug && shop.ios_otid !== otid && deps.bindingOwner) {
    const owner = await deps.bindingOwner(row);
    if (owner && owner !== user.id) {
      const other = await otherAccountBody(deps.emailOf, owner === 'ambiguous' ? null : owner);
      return err(409, 'purchase-in-use', { reason: other.error, hint: other.hint });
    }
  }
  // Only a live purchase (Apple: active or billing grace) may take over the shop's link. An
  // expired, revoked or retrying one (an old Apple ID, a stale transaction) leaves the shop
  // exactly as it was, and the current plan comes back.
  if (!isActive(tx, now())) {
    const current = shop.ios_otid ? (shop.ios_otid === otid ? row : await deps.purchase(shop.ios_otid)) : null;
    return { status: 200, body: planView(shop, current, now(), user.id) };
  }
  // The shop link first: when another shop already holds this purchase ('taken') nothing is linked.
  const before = shop.ios_otid;
  if (before !== otid) {
    if ((await deps.setShopOtid(shop.id, otid)) === 'taken') return err(409, 'purchase-in-use');
    shop = { ...shop, ios_otid: otid };
  }
  let linkedRow = row;
  if (!row.user_id) {
    try {
      if (await deps.setUserIfUnlinked(otid, user.id)) {
        linkedRow = { ...row, user_id: user.id };
      } else {
        // Lost the race (a publish, Restore or setup linked it between our read and now): re-decide.
        // Someone else's: 409, and the shop link is put back so nothing of theirs is left behind.
        const again = await deps.purchase(otid);
        if (again?.user_id && again.user_id !== user.id) {
          if (before !== otid) await deps.setShopOtid(shop.id, before).catch((e: any) => console.error('[shop/plan] shop link revert failed:', e?.message || e));
          const other = await otherAccountBody(deps.emailOf, again.user_id);
          return err(409, 'purchase-in-use', { reason: other.error, hint: other.hint });
        }
        if (again) linkedRow = again;
      }
    } catch (e: any) {
      // Best effort: the ios_otid unique index already stops a second shop on this purchase.
      console.error('[shop/plan] linking purchase to account failed:', e?.message || e);
    }
  }
  return { status: 200, body: planView(shop, linkedRow, now(), user.id) };
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
    setUserIfUnlinked: (otid, uid) => purchases.setUserIfUnlinked(otid, uid),
    emailOf: liveEmailOf,
    bindingOwner: liveBindingOwner,
    now: Date.now,
    memberProfileLive: () => shops.memberProfileLive(),
    limiter: userLimiter,
  };
}
