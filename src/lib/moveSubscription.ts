import { ApiError, type api } from '@/lib/api';

/**
 * "Move subscription to this account": the one way out of every "this subscription belongs to another account"
 * dead end. Pure engine (no React, no Alert), so each branch is tested on its own; useMoveSubscription wires it up.
 *
 * Flow: transfer without `confirm`. If the purchase is linked to another account the server answers 409
 * confirm-required (masked owner, whether their site is live); the user confirms; transfer again with confirm:true.
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
  generic: "Couldn't move your subscription right now. Try again in a moment.",
} as const;

export type MoveConfirmInfo = { ownerHint: string | null; hasLiveSite: boolean };

/** The confirm Alert's body. The offline sentence is dropped when the other account has no live site. */
export function moveConfirmMessage({ ownerHint, hasLiveSite }: MoveConfirmInfo): string {
  const who = ownerHint ? `another account (${ownerHint})` : 'another account';
  return `This subscription is on ${who}.${hasLiveSite ? " Moving it here takes that account's website offline." : ''}`;
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
}

/** One friendly sentence for a failed transfer. */
export function moveErrorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return MOVE_ERROR.generic;
  if (e.status === 0 || e.status === 503 || e.status >= 500) return MOVE_ERROR.offline;
  if (e.status === 402 || e.code === 'subscription-inactive') return MOVE_ERROR.inactive;
  if (e.status === 401) return MOVE_ERROR.signIn;
  if (e.status === 429) return MOVE_ERROR.rateLimited;
  if (e.status === 409) {
    if (e.code === 'account-has-site') return MOVE_ERROR.accountHasSite;
    if (e.code === 'purchase-changed') return MOVE_ERROR.purchaseChanged;
    if (e.code === 'purchase-other-account') return MOVE_ERROR.otherAccount;
  }
  return MOVE_ERROR.generic;
}

export async function moveSubscription(deps: MoveDeps): Promise<MoveResult> {
  let id: string | null = null;
  try {
    id = await deps.transactionId();
  } catch {
    id = null;
  }
  if (!id) return { kind: 'error', message: MOVE_ERROR.noPurchase };
  // At most two probes: if the owner changes under the user (purchase-changed), say so and probe again so the
  // confirm names the new owner. A second change ends in the friendly line.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let token: string | undefined;
      try {
        await deps.transfer(id);
        return { kind: 'moved', transactionId: id };
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409 && e.code === 'confirm-required')) throw e;
        token = typeof e.body?.ownerToken === 'string' ? e.body.ownerToken : undefined;
        const ok = await deps.confirm({
          ownerHint: typeof e.body?.ownerHint === 'string' ? e.body.ownerHint : null,
          hasLiveSite: e.body?.hasLiveSite === true,
        });
        if (!ok) return { kind: 'cancelled' };
      }
      await deps.transfer(id, true, token);
      return { kind: 'moved', transactionId: id };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === 'purchase-changed' && attempt === 0) continue;
      return { kind: 'error', message: moveErrorMessage(e) };
    }
  }
  return { kind: 'error', message: MOVE_ERROR.purchaseChanged };
}
