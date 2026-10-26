// POST /api/ios/transfer { transactionId, confirm? } (Bearer required). 2026-10-26, DECIDED by the owner:
// a subscription follows the Apple ID. The signed-in account may take a subscription that is linked to
// another account, but ONLY after an explicit confirmation that says the other account's website goes
// offline. Payment still gates everything: the move needs an active, Apple-verified, unrevoked transaction.
// Nothing moves silently.
//
// Order is the contract:
//   verify with Apple (active, not revoked)  ->  decide  ->  [confirm:true only]
//   1. caller already has a live site under a different purchase: 409 account-has-site, nothing changes
//   2. ATOMIC compare-and-set  user_id: O -> caller  (zero rows = someone else moved it: 409 purchase-changed)
//   3. only after the CAS won: take O's site offline with the EXISTING takedown (removeSite.takeDown: the
//      removed/taken-down stamps + the offline page; the same offline deploy the lapse sweep uses). No
//      deletion: purge() is never called, O's stored copy, photos, account and login stay.
//   4. detach O's shop from the purchase (ab_shops.ios_otid), clear the slug so the caller publishes fresh.
// If step 3 fails the link is put back (CAS in reverse) and the stamps are undone, so a failed move leaves
// O exactly as before (503, retry). No PII in logs: last 4 of the otid and 8-char account id prefixes.
import { VerifyFailure, isActive, type VerifiedTx } from './appleVerify.js';
import type { PurchasesRepo } from './purchases.js';
import { takeDown, type RemoveSiteDeps } from './removeSite.js';
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
  /** The existing takedown pieces (liveRemoveDeps): markRemoved, markTakenDown, deployOffline. */
  takedown: Pick<RemoveSiteDeps, 'markRemoved' | 'markTakenDown' | 'deployOffline' | 'now'>;
  /** Detach every shop linked to this purchase (ab_shops.ios_otid = otid -> null). Throws on failure. */
  detachShop(otid: string): Promise<void>;
}

export type TransferResult =
  | { status: 200; body: { moved: boolean; linked: true } }
  | { status: 409; body: { error: 'confirm-required'; ownerHint: string | null; hasLiveSite: boolean; siteUrl?: string } }
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

  const b = input && typeof input === 'object' ? (input as { transactionId?: unknown; confirm?: unknown }) : {};
  const transactionId = typeof b.transactionId === 'string' ? b.transactionId.trim() : '';
  if (!transactionId || transactionId.length > 64) return { status: 400, body: { error: 'bad-request' } };
  // Only a real boolean true confirms; "true", 1 and friends are a malformed request, never a yes.
  if (b.confirm !== undefined && b.confirm !== null && typeof b.confirm !== 'boolean') return { status: 400, body: { error: 'bad-request' } };
  const confirm = b.confirm === true;

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
  if (!repo.transferUser || !repo.releaseSiteAfterMove || !repo.liveSitesOfUser) return unavailable;
  try {
    const row = await repo.upsertVerified(tx, { checkedAt });
    // A revocation recorded by Apple's notification that this active answer did not supersede.
    if (row.revoked_at) return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };

    // Already the caller's: idempotent.
    if (row.user_id === caller) return { status: 200, body: { moved: false, linked: true } };

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
        body: { error: 'confirm-required', ownerHint: hint, hasLiveSite: live, ...(live && row.site_slug ? { siteUrl: siteUrlOf(row.site_slug) } : {}) },
      };
    }

    // a. One site per account: a caller who already has a live site under a different purchase is refused.
    const has = await mine();
    if (has) return { status: 409, body: { error: 'account-has-site', slug: has.site_slug as string } };

    // b. The atomic compare-and-set. Nothing else happens unless this wins.
    if (!(await repo.transferUser(otid, ownerId, caller))) {
      console.warn(`ios-transfer ${tag} lost the race: purchase changed`);
      return { status: 409, body: { error: 'purchase-changed' } };
    }

    // c. Only now: O's site goes offline (existing takedown, no deletion), then the caller starts fresh.
    const cur = (await repo.get(otid)) ?? row;
    const slug = cur.site_slug;
    if (slug && cur.published_at != null && cur.removed_at == null) {
      const hadTakenDown = cur.taken_down_at != null;
      try {
        await takeDown({ original_transaction_id: otid, site_slug: slug, environment: cur.environment, published_at: cur.published_at }, deps.takedown);
      } catch (e: any) {
        console.error(`ios-transfer ${tag} takedown failed, putting the link back:`, e?.message || e);
        await undoMove(deps, otid, ownerId, caller, { clearTakenDown: !hadTakenDown && !isIndefiniteDeployError(e) });
        return unavailable;
      }
    }
    if (slug) {
      try {
        await repo.releaseSiteAfterMove(otid, slug, caller);
      } catch (e: any) {
        console.error(`ios-transfer ${tag} ALERT: moved and offline but the slug release failed:`, e?.message || e);
        return unavailable;
      }
    }
    try {
      await deps.detachShop(otid);
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

/** A takedown that failed after the CAS: give the purchase back and undo the stamps so O is as before. */
async function undoMove(deps: TransferDeps, otid: string, from: string, to: string, o: { clearTakenDown: boolean }): Promise<void> {
  const log = (what: string) => (e: any) => console.error(`ios-transfer otid=${otid.slice(-4)} ALERT: undo ${what} failed:`, e?.message || e);
  const { repo } = deps;
  // Stamps first (while the row is still ours), then the link goes back.
  const cur = await repo.get(otid).catch(() => null);
  if (cur?.removed_at && repo.clearRemoved) await repo.clearRemoved(otid, cur.removed_at).catch(log('clearRemoved'));
  if (o.clearTakenDown) await repo.clearTakenDown(otid).catch(log('clearTakenDown'));
  await repo.transferUser!(otid, to, from).catch(log('transferUser'));
}
