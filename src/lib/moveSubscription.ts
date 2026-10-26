import { ApiError, type api } from '@/lib/api';
import { ACCOUNT_HAS_SHOP_MESSAGE, MOVE_IN_PROGRESS_MESSAGE } from '@/lib/claimCopy';
import { getCurrentEntitlementProof, type StorekitProof } from '@/lib/storekitProof';

/**
 * "Move subscription to this account": the one way out of every "this subscription belongs to another account"
 * dead end. Pure engine (no React, no Alert), so each branch is tested on its own; useMoveSubscription wires it up.
 *
 * Flow: transfer without `confirm`. If the purchase is linked to another account the server answers 409
 * confirm-required (masked owner, whether a live site / a shop is attached); the user confirms; transfer again with
 * confirm:true. Every call carries Apple's signed proof (JWS) when the phone can produce one.
 */

export const MOVE_CONFIRM_TITLE = 'Move this subscription?';
export const MOVE_CONFIRM_CANCEL = 'Cancel';
export const MOVE_CONFIRM_OK = 'Move here';

export const MOVE_ERROR = {
  accountHasSite:
    'This account already has a live website, and each account can have one. Use a different account to move this subscription.',
  purchaseChanged: 'This subscription just changed accounts. Try again.',
  inactive: "This subscription has ended or was refunded, so it can't be moved. Subscribe again to publish.",
  offline: "Couldn't reach Prime Barber. Check your connection and try again.",
  noPurchase: "We couldn't find your subscription yet. Check your connection and try again in a moment.",
  signIn: 'Sign in to this account first, then move the subscription.',
  rateLimited: 'Too many tries. Wait a minute and try again.',
  otherAccount: "This subscription's website belongs to another account. Sign in to that account to use it.",
  refresh: "Your subscription moved, but we couldn't refresh your plan. Check your connection and tap again.",
  proof:
    "We couldn't confirm this subscription with Apple on this phone. Open Settings, tap your name, then Subscriptions to check it is active, then try again.",
  accountHasShop: ACCOUNT_HAS_SHOP_MESSAGE,
  inProgress: MOVE_IN_PROGRESS_MESSAGE,
  generic: "Couldn't move your subscription right now. Try again in a moment.",
} as const;

export type MoveConfirmInfo = { ownerHint: string | null; hasLiveSite: boolean; hasShop: boolean };

/**
 * The confirm Alert's body. Only the things that exist are named: the website (hasLiveSite), bookings and store
 * (hasShop). With neither, only the subscription moves.
 */
export function moveConfirmMessage({ ownerHint, hasLiveSite, hasShop }: MoveConfirmInfo): string {
  const who = ownerHint ? `another account (${ownerHint})` : 'another account';
  if (!hasLiveSite && !hasShop) return `This subscription is on ${who}. Moving it here moves just the subscription to this account.`;
  const text = hasLiveSite && hasShop ? 'This subscription, your website, bookings and store'
    : hasLiveSite ? 'This subscription and your website' : 'This subscription, bookings and store';
  return `${text} are on ${who}. Moving it here moves all of that to this account, and that account will be left empty.`;
}

export type MoveResult =
  | { kind: 'moved'; transactionId: string }
  /** The user said Cancel on the confirm: nothing changed. */
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export interface MoveDeps {
  transfer: typeof api.transfer;
  transactionId(): Promise<string | null>;
  /** Shows the confirm; true = "Move here". */
  confirm(info: MoveConfirmInfo): Promise<boolean>;
  /** Apple-signed proof of the current entitlement; null when unavailable (the server may not require it yet). */
  proof?(): Promise<StorekitProof | null>;
}

/** One friendly sentence for a failed transfer. */
export function moveErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return MOVE_ERROR.generic;
  if (e.code === 'move-in-progress') return MOVE_ERROR.inProgress;
  if (e.code === 'proof-required' || e.code === 'proof-invalid') return MOVE_ERROR.proof;
  if (e.status === 0 || e.status === 503 || e.status >= 500) return MOVE_ERROR.offline;
  if (e.status === 402 || e.code === 'subscription-inactive') return MOVE_ERROR.inactive;
  if (e.status === 401) return MOVE_ERROR.signIn;
  if (e.status === 429) return MOVE_ERROR.rateLimited;
  if (e.status === 409) {
    if (e.code === 'account-has-site') return e.body?.reason === 'shop' ? MOVE_ERROR.accountHasShop : MOVE_ERROR.accountHasSite;
    if (e.code === 'purchase-changed') return MOVE_ERROR.purchaseChanged;
    if (e.code === 'purchase-other-account') return MOVE_ERROR.otherAccount;
  }
  return MOVE_ERROR.generic;
}

async function readProof(deps: MoveDeps): Promise<StorekitProof | null> {
  try {
    return (await (deps.proof ?? getCurrentEntitlementProof)()) ?? null;
  } catch {
    return null;
  }
}

export async function moveSubscription(deps: MoveDeps): Promise<MoveResult> {
  let id: string | null = null;
  try {
    id = await deps.transactionId();
  } catch {
    id = null;
  }
  if (!id) return { kind: 'error', message: MOVE_ERROR.noPurchase };
  // The proof is read fresh before each transfer call (the server wants a recent signedDate, and the user may sit on
  // the confirm for a while). Its originalTransactionId wins over a stale pending/plan id.
  const send = async (confirm: boolean, token?: string): Promise<unknown> => {
    const proof = await readProof(deps);
    const tx = proof && proof.originalTransactionId !== id ? proof.originalTransactionId : id!;
    id = tx;
    const args: Parameters<MoveDeps['transfer']> = confirm ? [tx, true, token] : [tx];
    if (proof) { args[1] = confirm || undefined; args[2] = token; args[3] = proof.jws; }
    return deps.transfer(...args);
  };
  // At most two probes: if the owner changes under the user (purchase-changed), say so and probe again so the
  // confirm names the new owner. A second change ends in the friendly line.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let token: string | undefined;
      try {
        const r = await send(false);
        return { kind: 'moved', transactionId: id };
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409 && e.code === 'confirm-required')) throw e;
        token = typeof e.body?.ownerToken === 'string' ? e.body.ownerToken : undefined;
        const ok = await deps.confirm({
          ownerHint: typeof e.body?.ownerHint === 'string' ? e.body.ownerHint : null,
          hasLiveSite: e.body?.hasLiveSite === true,
          hasShop: e.body?.hasShop === true,
        });
        if (!ok) return { kind: 'cancelled' };
      }
      const r = await send(true, token);
      return { kind: 'moved', transactionId: id };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'purchase-changed' && attempt === 0) continue;
      return { kind: 'error', message: moveErrorMessage(e) };
    }
  }
  return { kind: 'error', message: MOVE_ERROR.purchaseChanged };
}
