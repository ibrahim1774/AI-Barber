// The one email to a barber whose Apple purchase the server did not tie to their account (one-account plan, lane C1, question 22:
// automatic, once per purchase and account). Plain letter, the standard sender (no "from Ibrahim" display name), Reply-To the support
// mailbox, no links, no prices, no footer, no em dashes. The wording is the plan's, word for word. Emails may name Apple (question 15
// covers only the in-app text). reason 'web-account' (and 'mixed') use the first text; 'other-apple-id' has its own.
import { esc, replyToAddress, type Mail } from '../webApp/emails.js';
import type { BlockReason } from './blocked.js';

export const WEB_ACCOUNT_TEXT =
  "You bought a Prime Barber subscription in the iPhone app, but your account's website was made on primebarber.org, so the new subscription was not used. Nothing changed on your website. To stop being charged, cancel it on your iPhone: Settings, your name, Subscriptions. To ask for your money back, go to reportaproblem.apple.com. If your web plan has ended, renew it at primebarber.org.";
export const OTHER_APPLE_ID_TEXT =
  'Your website belongs to the subscription you first bought with a different Apple ID. This new subscription was not used. Resubscribe with that Apple ID, or reply to this email and we will move your website for you.';

export function blockedPurchaseEmail(reason: BlockReason): Mail {
  const text = reason === 'other-apple-id' ? OTHER_APPLE_ID_TEXT : WEB_ACCOUNT_TEXT;
  const subject = reason === 'other-apple-id' ? 'About your new Prime Barber subscription' : 'About your Prime Barber subscription';
  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111"><p style="margin:0 0 12px;font-size:15px;line-height:22px">${esc(text)}</p></body></html>`;
  return { subject, html, text, replyTo: replyToAddress(), tags: [{ name: 'kind', value: `blocked_purchase_${reason === 'other-apple-id' ? 'other_apple_id' : 'web_account'}` }] };
}
