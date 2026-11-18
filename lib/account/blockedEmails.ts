// The one email to a barber whose Apple purchase the server did not tie to their account (one-account plan, lane C1, question 22:
// automatic, once per purchase and account). Plain letter, the standard sender (no "from Ibrahim" display name), Reply-To the support
// mailbox, no links, no prices, no footer, no em dashes. Emails may name Apple (question 15 covers only the in-app text).
// reason 'web-account' (and 'mixed') use the web-account letter, which names the account email, says how to cancel the new Apple subscription so the
// customer is not charged twice, and how to sign in with the plan they already have (password, or the emailed sign-in code). 'other-apple-id' has its own.
// When the account's email cannot be read the bracketed part and the address in the last paragraph are dropped, and the letter is still sent.
import { esc, replyToAddress, type Mail } from '../webApp/emails.js';
import type { BlockReason } from './blocked.js';

/** The app's own wording for the code button on its password sign-in screen (src/app/sign-in.tsx, "Email me a sign-in code"). */
export const SIGN_IN_CODE_BUTTON = 'Email me a sign-in code';

export function webAccountParagraphs(email?: string | null, planLive = true): string[] {
  const e = (email ?? '').trim();
  const cancel = 'So that you are not charged twice, cancel the new subscription on your iPhone: Settings, your name, Subscriptions. To ask for your money back, go to reportaproblem.apple.com.';
  if (!planLive) {
    // The web plan on this account has ended: never "already has a plan". Restores the old renewal line (emails may name the web address).
    return [
      `You bought a Prime Barber subscription in the iPhone app, but your website belongs to your web account${e ? ` (${e})` : ''}, so the new subscription was not used. The web plan on that account has ended. Nothing changed on your website.`,
      cancel,
      `If you want to keep your website, renew your web plan at primebarber.org, then open the app and sign in${e ? ` with ${e}` : ''}. If you do not remember your password, tap ${SIGN_IN_CODE_BUTTON} and we will email you a code.`,
    ];
  }
  return [
    `You bought a Prime Barber subscription in the iPhone app, but your account${e ? ` (${e})` : ''} already has a Prime Barber plan, so the new subscription was not used. Nothing changed on your website.`,
    cancel,
    `To use the app with the plan you already have, open the app and sign in${e ? ` with ${e}` : ''}. If you do not remember your password, tap ${SIGN_IN_CODE_BUTTON} and we will email you a code.`,
  ];
}
export function otherAppleIdParagraphs(email?: string | null): string[] {
  const e = (email ?? '').trim();
  return [
    `Your website belongs to the subscription you first bought with a different Apple ID. This new subscription was not used.${e ? ` This is the account ${e}.` : ''} So that you are not charged twice, you can cancel the new subscription in iPhone Settings, your name, Subscriptions. Resubscribe with that Apple ID, or reply to this email and we will move your website for you.`,
  ];
}

export function blockedPurchaseEmail(reason: BlockReason, email?: string | null, planLive = true): Mail {
  const paragraphs = reason === 'other-apple-id' ? otherAppleIdParagraphs(email) : webAccountParagraphs(email, planLive);
  const subject = reason === 'other-apple-id' ? 'About your new Prime Barber subscription' : planLive ? 'Your Prime Barber plan is already active' : 'About your Prime Barber subscription';
  const text = paragraphs.join('\n\n');
  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111">${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:22px">${esc(p)}</p>`).join('')}</body></html>`;
  return { subject, html, text, replyTo: replyToAddress(), tags: [{ name: 'kind', value: `blocked_purchase_${reason === 'other-apple-id' ? 'other_apple_id' : 'web_account'}` }] };
}
