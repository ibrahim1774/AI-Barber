// POST /api/ios/transfer { transactionId, confirm? } (Bearer required). 2026-10-26, DECIDED by the owner:
// a subscription follows the Apple ID. The signed-in account may take a subscription that is linked to
// another account, but ONLY after an explicit confirmation that says the other account's website goes
// offline. Payment still gates everything: the move needs an active, Apple-verified, unrevoked transaction.
// Nothing moves silently.
//
// Order is the contract:
//   verify with Apple (active, not revoked)  ->  decide  ->  [confirm:true only]
//   0. ownerToken (HMAC of the owner the user saw + otid) must match the CURRENT owner, else 409 purchase-changed
//   1. caller already has a live site under a different purchase: 409 account-has-site, nothing changes
//   2. ONE conditional UPDATE moves user_id O -> caller AND clears site_slug/published_at/taken_down_at/
//      removed_at (zero rows = someone else moved it first: 409 purchase-changed). From here on the caller
//      can never reach O's slug or stored copy, whatever fails next.
//   3. only after that won: deployOffline(O's pre-read slug), the existing offline deploy the lapse sweep
//      uses (idempotent). markRemoved/markTakenDown are NOT used: no purchase row references the slug any
//      more, so neither the sweep nor an admin can redeploy it. No deletion; purge() is never called.
//      If the deploy fails the move is reversed (compare-and-set on the exact fields) and the call is 503.
//   4. detach O's shop (ab_shops.ios_otid = otid and owner <> caller). Also done on a retry by the new owner.
// Custom domains: ios_domains is keyed by the purchase and is NOT touched. A moved subscription's custom
// domain stays with the old site until support moves it.
// No PII in logs: last 4 of the otid and 8-char account id prefixes.
import { VerifyFailure, isActive, type VerifiedTx } from './appleVerify.js';
import type { PurchasesRepo } from './purchases.js';
import type { RemoveSiteDeps } from './removeSite.js';
import { timingSafeEqual } from 'node:crypto';
import { hasLiveSite, otherAccountBody, siteUrlOf, type BindingOwner } from './ownership.js';
import { isIndefiniteDeployError } from './sweep.js';

export interface TransferDeps {
  verify(transactionId: string): Promise<VerifiedTx>;
  repo: PurchasesRepo;
  /** The account behind a bearer token (null = invalid; throws on an outage). */
  userOf(token: string): Promise<{ id: string } | null>;
  /** Masked-hint lookup (account id -> email). Absent: ownerHint null. */
  emailOf?(userId: string): Promise<string | null>;
  /** Legacy unlinked purchase with a bound slug: who owns the shop/site (see ownership.ts). */
  bindingOwner?(row: import('./purchases.js').PurchaseRow): Promise<BindingOwner>;
  /** Per-caller write limit. Throws -> fail CLOSED (503). */
  allow(callerId: string): Promise<boolean>;
  /** The existing offline deploy (liveRemoveDeps) and the clock. */
  takedown: Pick<RemoveSiteDeps, 'deployOffline' | 'now'>;
  /** Detach the OTHER accounts' shops from this purchase (ab_shops.ios_otid = otid AND owner_id <> callerId -> null). Throws on failure. */
  detachShop(otid: string, callerId: string): Promise<void>;
  /** Opaque token bound to (owner, otid): HMAC with a server secret. Deterministic. */
  ownerToken(ownerId: string, otid: string): string;
}

export type TransferResult =
  | { status: 200; body: { moved: boolean; linked: true } }
  | { status: 409; body: { error: 'confirm-required'; ownerHint: string | null; hasLiveSite: boolean; ownerToken: string; siteUrl?: string } }
  | { status: 409; body: { error: 'account-has-site'; slug: string } }
  | { status: 409; body: { error: 'purchase-changed' } }
  | { status: 409; body: { error: 'purchase-other-account'; hint: string | null; ownerHint: string | null; hasLiveSite: boolean } }
  | { status: 402; body: { error: 'subscription-inactive'; reason?: 'revoked' } }
  | { status: 400 | 401 | 404 | 429 | 503; body: { error: string } };

const VERIFY_STATUS = { 'not-found': 404, 'bad-bundle': 400, 'bad-product': 400, 'apple-unavailable': 503 } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable: TransferResult = { status: 503, body: { error: 'temporarily-unavailable' } };
const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : 'none');

const bearer = (h: unknown): string => {
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === 'string' ? v.replace(/^Bearer\s+/i, '').trim() : '';
};

export async function runTransfer(input: unknown, deps: TransferDeps, ctx: { authorization?: unknown } = {}): Promise<TransferResult> {
  // 1. Who is asking. Only a verified Supabase bearer identifies the caller (nothing in the body does).
  const token = bearer(ctx.authorization);
  if (!token) return { status: 401, body: { error: 'unauthorized' } };
  let caller: string;
  try {
    const user = await deps.userOf(token);
    if (!user?.id || !UUID_RE.test(user.id)) return { status: 401, body: { error: 'unauthorized' } };
    caller = user.id;
  } catch (e: any) {
    console.error('[ios/transfer] account lookup failed:', e?.message || e);
    return unavailable;
  }

  const b = input && typeof input === 'object' ? (input as { transactionId?: unknown; confirm?: unknown; ownerToken?: unknown }) : {};
  const transactionId = typeof b.transactionId === 'string' ? b.transactionId.trim() : '';
  if (!transactionId || transactionId.length > 64) return { status: 400, body: { error: 'bad-request' } };
  // Only a real boolean true confirms; "true", 1 and friends are a malformed request, never a yes.
  if (b.confirm !== undefined && b.confirm !== null && typeof b.confirm !== 'boolean') return { status: 400, body: { error: 'bad-request' } };
  const confirm = b.confirm === true;
  if (b.ownerToken !== undefined && b.ownerToken !== null && (typeof b.ownerToken !== 'string' || b.ownerToken.length > 200)) return { status: 400, body: { error: 'bad-request' } };
  const sentToken = typeof b.ownerToken === 'string' ? b.ownerToken : '';

  // 2. Rate limit (per account), fail closed.
  try {
    if (!(await deps.allow(caller))) return { status: 429, body: { error: 'rate-limited' } };
  } catch (e: any) {
    console.error('[ios/transfer] rate limiter failed, refusing (fail closed):', e?.message || e);
    return unavailable;
  }

  // 3. Proof of payment, exactly as publish / claim-start.
  const checkedAt = deps.takedown.now();
  let tx: VerifiedTx;
  try {
    tx = await deps.verify(transactionId);
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    console.error('[ios/transfer] verify threw unexpectedly:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  if (tx.revoked) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };
  if (!isActive(tx, checkedAt)) return { status: 402, body: { error: 'subscription-inactive' } };

  const otid = tx.originalTransactionId;
  const tag = `otid=${otid.slice(-4)}`;
  const { repo } = deps;
  if (!repo.moveUserAndRelease || !repo.revertMove || !repo.liveSitesOfUser) return unavailable;
  try {
    const row = await repo.upsertVerified(tx, { checkedAt });
    // A revocation recorded by Apple's notification that this active answer did not supersede.
    if (row.revoked_at) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };

    // Already the caller's: idempotent.
    if (row.user_id === caller) {
      // Finish a detach that failed on an earlier attempt (idempotent, never touches the caller's own shop).
      await deps.detachShop(otid, caller);
      return { status: 200, body: { moved: false, linked: true } };
    }

    const mine = async () => (await repo.liveSitesOfUser!(caller)).find((r) => r.original_transaction_id !== otid && r.site_slug);

    // Unlinked: link it to the caller (the atomic setUserIfUnlinked decides a race).
    if (!row.user_id) {
      // A legacy slug bound to someone else's shop/site is theirs (same rule as publish).
      if (row.site_slug) {
        const owner = deps.bindingOwner ? await deps.bindingOwner(row) : 'ambiguous';
        if (owner && owner !== caller) {
          return { status: 409, body: await otherAccountBody(deps.emailOf, owner === 'ambiguous' ? null : owner, row) };
        }
      }
      const has = await mine();
      if (has) return { status: 409, body: { error: 'account-has-site', slug: has.site_slug as string } };
      if (await repo.setUserIfUnlinked(otid, caller)) {
        console.log(`ios-transfer ${tag} from=none to=${short(caller)} (linked)`);
        return { status: 200, body: { moved: false, linked: true } };
      }
      const again = await repo.get(otid);
      if (again?.user_id === caller) return { status: 200, body: { moved: false, linked: true } };
      return { status: 409, body: { error: 'purchase-changed' } }; // someone linked it between our read and now
    }

    // Linked to another account O.
    const ownerId = row.user_id;
    if (!confirm) {
      // Writes nothing (beyond Apple's refresh above). Tells the app what to say.
      const live = hasLiveSite(row);
      const hint = (await otherAccountBody(deps.emailOf, ownerId, row)).ownerHint;
      return {
        status: 409,
        body: { error: 'confirm-required', ownerHint: hint, hasLiveSite: live, ownerToken: deps.ownerToken(ownerId, otid), ...(live && row.site_slug ? { siteUrl: siteUrlOf(row.site_slug) } : {}) },
      };
    }

    // The confirmation must be for the owner the user was shown. Missing token: malformed; stale: purchase-changed.
    if (!sentToken) return { status: 400, body: { error: 'bad-request' } };
    const want = Buffer.from(deps.ownerToken(ownerId, otid));
    const got = Buffer.from(sentToken);
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      return { status: 409, body: { error: 'purchase-changed' } };
    }

    // a. One site per account: a caller who already has a live site under a different purchase is refused.
    const has = await mine();
    if (has) return { status: 409, body: { error: 'account-has-site', slug: has.site_slug as string } };

    // b. ONE conditional UPDATE: owner -> caller AND the previous site detached. Nothing else happens unless it wins.
    const slug = row.site_slug;
    if (!(await repo.moveUserAndRelease(otid, ownerId, caller, slug))) {
      console.warn(`ios-transfer ${tag} lost the race: purchase changed`);
      return { status: 409, body: { error: 'purchase-changed' } };
    }

    // c. Only now: O's site goes offline (the existing offline deploy; nothing is deleted).
    if (slug && row.published_at != null && row.removed_at == null) {
      let failure: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await deps.takedown.deployOffline(slug);
          failure = null;
          break;
        } catch (e: any) {
          failure = e;
        }
      }
      if (failure) {
        console.error(`ios-transfer ${tag} offline deploy failed, reversing the move:`, failure?.message || failure);
        // An unknown outcome (timeout) may have taken it down: flag it so the sweep restores an active site.
        const prev = {
          user_id: ownerId, site_slug: slug, published_at: row.published_at, removed_at: row.removed_at ?? null,
          taken_down_at: isIndefiniteDeployError(failure) ? new Date(deps.takedown.now()).toISOString() : row.taken_down_at ?? null,
        };
        let reverted = false;
        try {
          reverted = await repo.revertMove(otid, caller, prev);
        } catch (e: any) {
          console.error(`ios-transfer ${tag}: reverse failed:`, e?.message || e);
        }
        if (!reverted) console.error(`ios-transfer ${tag} ALERT: moved, offline deploy failed AND the reverse failed; slug ${slug} may be live and untracked`);
        return unavailable;
      }
    }

    // d. O's shop no longer reads this purchase. A failure here is finished by a retry (already-the-caller's branch).
    try {
      await deps.detachShop(otid, caller);
    } catch (e: any) {
      console.error(`ios-transfer ${tag} ALERT: moved but detaching the previous shop failed:`, e?.message || e);
      return unavailable;
    }
    console.log(`ios-transfer ${tag} from=${short(ownerId)} to=${short(caller)}`);
    return { status: 200, body: { moved: true, linked: true } };
  } catch (e) {
    console.error(`[ios/transfer] ${tag}: unexpected error:`, (e as Error)?.message || e);
    return unavailable;
  }
}
