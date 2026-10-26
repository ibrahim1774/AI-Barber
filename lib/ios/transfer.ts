// POST /api/ios/transfer { transactionId, confirm? } (Bearer required). 2026-10-26, DECIDED by the owner:
// a subscription follows the Apple ID. The signed-in account may take a subscription that is linked to
// another account, but ONLY after an explicit confirmation that says the other account's website goes
// offline. Payment still gates everything: the move needs an active, Apple-verified, unrevoked transaction.
// Nothing moves silently.
//
// REVISION 2 (2026-10-26): the WHOLE BUSINESS moves; nothing goes offline and nothing is deleted.
// Order is the contract:
//   proof of device (Apple-signed JWS, `proof`, signedDate not older than 45 days) when sent or when IOS_REQUIRE_TRANSFER_PROOF is on
//   verify with Apple (active, not revoked)  ->  decide  ->  [confirm:true only]
//   0. ownerToken (HMAC of the owner the user saw + otid) must match the CURRENT owner, else 409 purchase-changed
//   1. the caller already has a live site, or a shop of their own that is not this purchase's:
//      409 account-has-site, nothing changes
//   2. a move INTENT (ab_events: otid, from, to, slug) is recorded; then ONE conditional UPDATE moves
//      ios_purchases.user_id O -> caller (zero rows = 409 purchase-changed, intent cancelled). This CAS is the single
//      gate; nothing else is written unless it wins.
//   3. moveBusiness(otid, from, caller, slug): ONLY rows owned by `from` are re-pointed: shop + owner member first
//      (payments cleared and audited, calendar token rotated, caller's old staff row deactivated), then the sites copy.
//      Idempotent. The "already the caller's" branch (a retry) and the plan GET/refresh, publish and shop-setup hooks
//      FINISH a move only when its intent row exists, and never undo anything.
// ios_domains is keyed by the otid and stays. Push tokens are NOT moved (they belong to the device owner).
// No PII in logs: last 4 of the otid and 8-char account id prefixes.
import { VerifyFailure, isActive, type DecodedTransaction, type IosEnv, type VerifiedTx } from './appleVerify.js';
import type { PurchasesRepo } from './purchases.js';
import { timingSafeEqual } from 'node:crypto';
import type { MoveIntents } from './moveIntent.js';
import { hasLiveSite, otherAccountBody, siteUrlOf, type BindingOwner } from './ownership.js';

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
  /** Clock (ms). */
  now(): number;
  /** Does a shop hang off this purchase, and does it hold payment settings (a Stripe account or manual handles)? Shown in the confirmation. Absent: both false. */
  shopSummary?(otid: string): Promise<{ hasShop: boolean }>;
  /** The caller's own shop, if any (ab_shops has one row per owner). */
  shopOf?(userId: string): Promise<{ id: string; ios_otid: string | null } | null>;
  /** Move intents (ab_events): recorded BEFORE the CAS; a retry finishes a move only when one exists. */
  intents: MoveIntents;
  /**
   * Move the business of this purchase from `from` to `to`: ONLY rows owned by `from` are re-pointed (the shop and
   * its owner member first, then the sites copy), payments settings are cleared and audited, the owner calendar
   * token is rotated. Idempotent; never deletes. Throws on failure (a retry finishes it).
   */
  moveBusiness(otid: string, from: string, to: string, slug: string | null): Promise<void>;
  /** Proof of device: verify an Apple-signed transaction JWS (StoreKit 2 jwsRepresentation). Throws if the signature/bundle/environment is wrong. */
  decodeProof(env: IosEnv, jws: string): Promise<DecodedTransaction>;
  /** Expected bundle id (APPLE_BUNDLE_ID). */
  bundleId: string;
  /** IOS_REQUIRE_TRANSFER_PROOF. Default false. */
  requireProof: boolean;
  /** Opaque token bound to (owner, otid): HMAC with a server secret. Deterministic. */
  ownerToken(ownerId: string, otid: string): string;
}

export type TransferResult =
  | { status: 200; body: { moved: boolean; linked: true } }
  | { status: 409; body: { error: 'confirm-required'; ownerHint: string | null; hasLiveSite: boolean; hasShop: boolean; ownerToken: string; siteUrl?: string } }
  | { status: 409; body: { error: 'account-has-site'; slug: string; reason: 'site' | 'shop' } }
  | { status: 409; body: { error: 'purchase-changed' } }
  | { status: 409; body: { error: 'move-in-progress' } }
  | { status: 409; body: { error: 'purchase-other-account'; hint: string | null; ownerHint: string | null; hasLiveSite: boolean } }
  | { status: 402; body: { error: 'subscription-inactive'; reason?: 'revoked' } }
  | { status: 400; body: { error: 'proof-required' } }
  | { status: 403; body: { error: 'proof-invalid' } }
  | { status: 400 | 401 | 404 | 429 | 503; body: { error: string } };

/** StoreKit hands back the JWS signed at purchase/renewal time, so it can be weeks old: 45 days covers a monthly renewal plus slack. */
export const PROOF_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
const PROOF_FUTURE_SKEW_MS = 5 * 60 * 1000;

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

  const b = input && typeof input === 'object' ? (input as { transactionId?: unknown; confirm?: unknown; ownerToken?: unknown; proof?: unknown }) : {};
  const transactionId = typeof b.transactionId === 'string' ? b.transactionId.trim() : '';
  if (!transactionId || transactionId.length > 64) return { status: 400, body: { error: 'bad-request' } };
  // Only a real boolean true confirms; "true", 1 and friends are a malformed request, never a yes.
  if (b.confirm !== undefined && b.confirm !== null && typeof b.confirm !== 'boolean') return { status: 400, body: { error: 'bad-request' } };
  const confirm = b.confirm === true;
  if (b.ownerToken !== undefined && b.ownerToken !== null && (typeof b.ownerToken !== 'string' || b.ownerToken.length > 200)) return { status: 400, body: { error: 'bad-request' } };
  const sentToken = typeof b.ownerToken === 'string' ? b.ownerToken : '';
  if (b.proof !== undefined && b.proof !== null && typeof b.proof !== 'string') return { status: 400, body: { error: 'bad-request' } };
  const proof = typeof b.proof === 'string' ? b.proof.trim() : '';
  if (proof.length > 16_384) return { status: 403, body: { error: 'proof-invalid' } };

  // 2. Rate limit (per account), fail closed.
  try {
    if (!(await deps.allow(caller))) return { status: 429, body: { error: 'rate-limited' } };
  } catch (e: any) {
    console.error('[ios/transfer] rate limiter failed, refusing (fail closed):', e?.message || e);
    return unavailable;
  }

  // 3. Proof of payment, exactly as publish / claim-start.
  const checkedAt = deps.now();
  let tx: VerifiedTx;
  try {
    tx = await deps.verify(transactionId);
  } catch (e) {
    if (e instanceof VerifyFailure) return { status: VERIFY_STATUS[e.code], body: { error: e.code } };
    console.error('[ios/transfer] verify threw unexpectedly:', (e as Error)?.message || e);
    return { status: 503, body: { error: 'apple-unavailable' } };
  }
  const inactive: TransferResult | null = tx.revoked
    ? { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } }
    : !isActive(tx, checkedAt) ? { status: 402, body: { error: 'subscription-inactive' } } : null;

  const otid = tx.originalTransactionId;
  const tag = `otid=${otid.slice(-4)}`;

  // 3b. Proof that the DEVICE holds this entitlement: an Apple-signed transaction JWS. Required when
  // IOS_REQUIRE_TRANSFER_PROOF is on; when off a bare transactionId still works, but a proof that IS sent
  // must be valid. Checked before anything is read from or written to our tables.
  if (!proof) {
    if (deps.requireProof) return { status: 400, body: { error: 'proof-required' } };
  } else {
    try {
      const d = await deps.decodeProof(tx.environment, proof);
      // N2: the JWS must be the purchase's LATEST transaction (Apple's status check), so an old renewal's JWS is useless.
      const latestOk = (x: DecodedTransaction) => tx.latestTransactionId
        ? x.transactionId === tx.latestTransactionId
        : typeof x.expiresDate === 'number' && x.expiresDate > checkedAt;
      const age = checkedAt - (d.signedDate ?? NaN); // negative = signed in the future
      const ok = d.originalTransactionId === otid && d.bundleId === deps.bundleId
        && d.environment === tx.environment && latestOk(d) && Number.isFinite(age) && age <= PROOF_MAX_AGE_MS && age >= -PROOF_FUTURE_SKEW_MS;
      if (!ok) {
        console.warn(`ios-transfer ${tag} proof rejected`);
        return { status: 403, body: { error: 'proof-invalid' } };
      }
    } catch (e) {
      if (e instanceof VerifyFailure && e.code === 'apple-unavailable') {
        console.error('[ios/transfer] proof verifier unavailable:', e.message);
        return unavailable;
      }
      console.warn(`ios-transfer ${tag} proof rejected`);
      return { status: 403, body: { error: 'proof-invalid' } };
    }
  }
  const { repo } = deps;
  if (!repo.transferUser || !repo.liveSitesOfUser) return unavailable;
  // Finishes an unfinished move of THIS caller (an intent row exists and the CAS already won). Moves data only,
  // never entitlement, so it also runs for a purchase that has lapsed meanwhile. Null = nothing to finish.
  const finishOwn = async (row: { user_id: string | null; site_slug: string | null }): Promise<boolean> => {
    if (row.user_id !== caller) return false;
    const intent = await deps.intents.find(otid, caller);
    if (!intent) return false;
    await deps.moveBusiness(otid, intent.from, caller, row.site_slug ?? intent.slug);
    await deps.intents.finish(otid, caller);
    console.log(`ios-transfer ${tag} finished to=${short(caller)}`);
    return true;
  };

  try {
    if (inactive) {
      const cur = await repo.get(otid);
      if (cur) {
        try { await finishOwn(cur); } catch (e: any) { console.error(`ios-transfer ${tag} finisher failed:`, e?.message || e); }
      }
      return inactive;
    }
    const row = await repo.upsertVerified(tx, { checkedAt });
    // A revocation recorded by Apple's notification that this active answer did not supersede.
    if (row.revoked_at) {
      try { await finishOwn(row); } catch (e: any) { console.error(`ios-transfer ${tag} finisher failed:`, e?.message || e); }
      return { status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } };
    }

    // Already the caller's: idempotent.
    if (row.user_id === caller) {
      // Finish an earlier attempt of THIS caller's move, only when its intent row exists (idempotent, never undoes).
      // Without an intent row nothing is touched, whoever owns the shop or site of this otid.
      try {
        await finishOwn(row);
      } catch (e: any) {
        console.error(`ios-transfer ${tag} ALERT: finishing the move failed (a retry finishes it):`, e?.message || e);
        return unavailable;
      }
      return { status: 200, body: { moved: false, linked: true } };
    }

    const mine = async () => (await repo.liveSitesOfUser!(caller)).find((r) => r.original_transaction_id !== otid && r.site_slug);
    // The caller's own shop that is not this purchase's (one shop per account).
    const ownShop = async () => {
      const sh = deps.shopOf ? await deps.shopOf(caller) : null;
      return !!sh && sh.ios_otid !== otid;
    };

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
      if (has) return { status: 409, body: { error: 'account-has-site', slug: has.site_slug as string, reason: 'site' } };
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
      const sum = deps.shopSummary ? await deps.shopSummary(otid) : { hasShop: false };
      return {
        status: 409,
        body: { error: 'confirm-required', ownerHint: hint, hasLiveSite: live, hasShop: sum.hasShop, ownerToken: deps.ownerToken(ownerId, otid), ...(live && row.site_slug ? { siteUrl: siteUrlOf(row.site_slug) } : {}) },
      };
    }

    // The confirmation must be for the owner the user was shown. Missing token: malformed; stale: purchase-changed.
    if (!sentToken) return { status: 400, body: { error: 'bad-request' } };
    const want = Buffer.from(deps.ownerToken(ownerId, otid));
    const got = Buffer.from(sentToken);
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      return { status: 409, body: { error: 'purchase-changed' } };
    }

    // a. One business per account: a caller with a live site under another purchase, or a shop of their own, is refused.
    const has = await mine();
    if (has) return { status: 409, body: { error: 'account-has-site', slug: has.site_slug as string, reason: 'site' } };
    if (await ownShop()) return { status: 409, body: { error: 'account-has-site', slug: '', reason: 'shop' } };

    // b0. An earlier move of this purchase to a DIFFERENT account whose business move is unfinished must be
    // finished first (its `from` would otherwise be overwritten by this one).
    const open = await deps.intents.pendingForOtid(otid);
    if (open.some((i) => i.to !== caller && i.to === ownerId)) return { status: 409, body: { error: 'move-in-progress' } };

    // b. Record the intent (WHO the business moves from) BEFORE the gate, so a retry can finish it.
    await deps.intents.begin({ otid, from: ownerId, to: caller, slug: row.site_slug });

    // c. THE gate: one conditional UPDATE. Nothing else happens unless it wins.
    if (!(await repo.transferUser(otid, ownerId, caller))) {
      console.warn(`ios-transfer ${tag} lost the race: purchase changed`);
      // Cancel the intent only if this caller is NOT the one the purchase now belongs to: a duplicate confirm
      // that lost to the caller's OWN winning request must not cancel the winner's intent.
      const now = await repo.get(otid).catch(() => null);
      if (now && now.user_id !== caller) await deps.intents.cancel(otid, caller).catch(() => {});
      return { status: 409, body: { error: 'purchase-changed' } };
    }

    // d. The business follows (rows owned by O only). The slug is re-read: a publish may have bound one meanwhile.
    try {
      const after = await repo.get(otid);
      await deps.moveBusiness(otid, ownerId, caller, after?.site_slug ?? row.site_slug);
      await deps.intents.finish(otid, caller);
    } catch (e: any) {
      console.error(`ios-transfer ${tag} ALERT: purchase moved but moving the business failed (a retry finishes it):`, e?.message || e);
      return unavailable;
    }
    console.log(`ios-transfer ${tag} from=${short(ownerId)} to=${short(caller)}`);
    return { status: 200, body: { moved: true, linked: true } };
  } catch (e) {
    console.error(`[ios/transfer] ${tag}: unexpected error:`, (e as Error)?.message || e);
    return unavailable;
  }
}
