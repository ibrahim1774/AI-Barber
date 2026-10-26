/**
 * The words of the pay-then-sign-up flow that more than one place says: refusals from the server (409 on publish and
 * on Restore) and the sign-in-first codes. Pure, so every screen and test shares one wording. A hint is the server's
 * masked email ("a***@gmail.com"); a slug is the live site's name. Nothing else about another account is ever shown.
 */

/** What a 409 on publish was about. Kept on the pending record so the locked step can show it after a relaunch. */
export type Conflict =
  | { code: 'purchase-other-account'; hint?: string | null }
  | { code: 'account-has-site'; slug?: string | null; reason?: 'site' | 'shop' | null };

/** The label of the button that replaces the dead end. */
export const MOVE_BUTTON_TITLE = 'Move subscription to this account';

/** account-has-site with reason 'shop': the account owns a Bookings/Store shop (and no site), so it cannot take another business. */
export const ACCOUNT_HAS_SHOP_MESSAGE = "This account already has its own Bookings or Store set up, so it can't take another business. Use a different account.";

/** 503 (shop setup) / 409 (delete account) move-in-progress: a subscription move has not finished yet. */
export const MOVE_IN_PROGRESS_MESSAGE =
  'Your subscription move is still finishing. Open Bookings or Store, or tap Move subscription again, then try again in a moment.';

/** Signed out, and the subscription belongs to an account (or a site): only that account can restore it. */
export const SIGN_IN_TO_RESTORE_CODE = 'sign-in-required';

/** Signed out, bought earlier, and the check says an account already owns this purchase. */
export const CLAIMED_SIGNED_OUT_MESSAGE =
  "This Apple ID's subscription already belongs to a Prime Barber account. A subscription is tied to the Apple ID, so only one account can use it at a time. Sign in to that account in Settings to publish.";

const TIED = 'A subscription is tied to the Apple ID, so only one account can use it at a time.';

/** What a 409 from publish says, naming the masked owner or the live site. */
export function conflictMessage(c: Conflict): string {
  if (c.code === 'account-has-site') {
    if (c.reason === 'shop') return ACCOUNT_HAS_SHOP_MESSAGE;
    return `This account already runs a live website${c.slug ? ` (${c.slug})` : ''}. Each account has one website. Use a different account to publish this one.`;
  }
  return `This Apple ID's subscription belongs to another Prime Barber account${c.hint ? ` (${c.hint})` : ''}. ${TIED} Move it to this account, or sign in to that account to publish.`;
}

/** What Restore says when the subscription is linked to another account: nothing was copied or changed. */
export function restoreOtherAccountMessage(hint?: string | null): string {
  return `This Apple ID's subscription belongs to another Prime Barber account${hint ? ` (${hint})` : ''}. ${TIED} Move it to this account, or sign in to that account to restore it. Nothing has changed yet.`;
}

/** Restore signed out (or with a rejected session): sign in first. */
export const RESTORE_SIGN_IN_MESSAGE =
  'Sign in to your Prime Barber account first, then tap Restore purchases. Your website is saved to your account.';

/**
 * Bookings / Store are locked: Superwall says paid, but the purchase belongs to another Prime Barber account on this
 * Apple ID. `hint` is the server's masked email, when it sends one.
 */
export function otherAccountPlanMessage(hint?: string | null): string {
  return `This Apple ID's subscription belongs to another Prime Barber account${hint ? ` (${hint})` : ''}. ${TIED} Move it to this account, or sign in to that account to use Bookings and Store.`;
}
