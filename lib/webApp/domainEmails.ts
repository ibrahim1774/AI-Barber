// Emails of the manual web-domain fulfilment (lib/webApp/domainManual.ts): the order notice and its
// follow-ups to Ibrahim, and three transactional mails to the customer (ordered / live / refunded).
// Pure: facts in, Mail out. Plain text first; the HTML part mirrors it (URLs become links).
// Never any card data, secret or token other than the signed action links the operator mails carry.
import { esc, replyToAddress, type Mail } from './emails.js';

/** What the customer is told, in every place that promises a time. */
export const FULFIL_PROMISE = 'usually within 1 business day, up to 3 business days';

export interface OrderFacts {
  domain: string;
  slug: string;
  project: string;
  liveUrl: string | null;
  customerEmail: string | null;
  shopName: string | null;
  subscriptionId: string;
  stripeCustomerId: string | null;
  testMode: boolean;
  createdAt: string;
  /** e.g. "available, $9.98 first year, $9.98 renewal" or "price unavailable". */
  priceNote: string;
  /** An own, detached name of this site: already on the Vercel team, just re-attach. */
  ownDetached: boolean;
  paidUntil: string | null;
  /** The row's auto_renew: false = the customer already cancelled (the live mail must not promise a renewal). */
  autoRenew?: boolean;
  teamSlug: string | null;
}

export interface OrderLinks { live: string; cant: string }

const LINK = /(https?:\/\/[^\s<]+)/g;

/** Plain-text mail; the HTML part is the same text with URLs linked. */
export function textMail(subject: string, lines: string[], replyTo?: string): Mail {
  const text = lines.join('\n');
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:15px;line-height:22px;color:#111;white-space:pre-wrap">${
    esc(text).replace(LINK, (u) => `<a href="${u}" style="color:#0b57d0">${u}</a>`)
  }</div>`;
  return { subject, text, html, ...(replyTo ? { replyTo } : {}) };
}

const stripeBase = (f: Pick<OrderFacts, 'testMode'>) => `https://dashboard.stripe.com/${f.testMode ? 'test/' : ''}`;
const projectLink = (f: Pick<OrderFacts, 'teamSlug' | 'project'>) =>
  f.teamSlug ? `https://vercel.com/${encodeURIComponent(f.teamSlug)}/${encodeURIComponent(f.project)}/settings/domains` : 'https://vercel.com/dashboard';
const utc = (iso: string) => `${iso.replace('T', ' ').replace(/\.\d+Z$/, '')} UTC`;

function factLines(f: OrderFacts): string[] {
  return [
    `Domain: ${f.domain}`,
    `Vercel quote: ${f.priceNote}`,
    ...(f.ownDetached ? ['This is a name of this same site that is already on the Vercel team (detached earlier): just re-attach it, nothing to buy.'] : []),
    `Customer: ${f.customerEmail ?? 'email unknown'}${f.shopName ? ` (${f.shopName})` : ''}`,
    `Site: ${f.slug}`,
    `Current address: ${f.liveUrl ?? '—'}`,
    `Vercel project: ${f.project}`,
    `Project domains: ${projectLink(f)}`,
    `Stripe subscription: ${f.subscriptionId} ${stripeBase(f)}subscriptions/${f.subscriptionId}`,
    ...(f.stripeCustomerId ? [`Stripe customer: ${f.stripeCustomerId} ${stripeBase(f)}customers/${f.stripeCustomerId}`] : []),
    ...(f.testMode ? ['TEST MODE: this is a Stripe test order, nothing real was charged.'] : []),
    `Paid: $39.00 for one year${f.paidUntil ? ` (to ${utc(new Date(f.paidUntil).toISOString())})` : ''}`,
    `Ordered: ${utc(f.createdAt)}`,
  ];
}

const NO_LINKS = 'Action links are off: DOMAIN_ADMIN_LINK_SECRET is not set on the server. Set it and the 48 hour reminder carries links; until then do the steps by hand (Stripe for a refund, the site owner for the rest).';

function steps(f: OrderFacts, links: OrderLinks | null): string[] {
  return [
    'What to do:',
    `1. Buy ${f.domain} at the registrar of your choice (on the Vercel team, DNS is automatic).`,
    `2. In Vercel project ${f.project}, Settings, Domains: add ${f.domain} and www.${f.domain} (www redirects to the apex, 308).`,
    '3. External registrar: an A record 76.76.21.21 on the apex and a CNAME cname.vercel-dns.com on www.',
    '4. Wait for "Valid configuration" and the certificate.',
    ...(links
      ? [
        '5. Click Mark live. It checks the attach, DNS and HTTPS, republishes the site on the new address and emails the customer:',
        links.live,
        `6. Can't get this exact name? Click Can't get this name. It cancels the subscription, refunds the $39 in full and emails the customer to pick another:`,
        links.cant,
        'The links expire in 30 days; the reminder email carries fresh ones. Opening a link only shows the checks; nothing changes until you press the button on the page.',
      ]
      : ['5. Then mark it live, or refund it if you cannot get the name.', NO_LINKS]),
  ];
}

export function orderEmail(f: OrderFacts, links: OrderLinks | null): Mail {
  return textMail(`Domain order: ${f.domain} ($39 paid) - buy and attach`, [`A customer paid for a custom domain. Buy it and attach it.`, '', ...factLines(f), '', ...steps(f, links)]);
}

export function orderReminderEmail(f: OrderFacts, links: OrderLinks | null): Mail {
  return textMail(`Reminder: domain order ${f.domain} still waiting (48 hours)`, [
    `The order for ${f.domain} has been waiting more than 48 hours. The customer was told ${FULFIL_PROMISE}.`, '', ...factLines(f), '', ...steps(f, links),
  ]);
}

export function orderVoidEmail(f: OrderFacts, links: OrderLinks | null, why: 'subscription' | 'owner-removed', refunded?: boolean): Mail {
  return textMail(`Domain order void: ${f.domain} - do not buy`, [
    why === 'owner-removed'
      ? `The owner removed the site or deleted the account while this order was waiting. Do not buy ${f.domain}.`
      : `The subscription for ${f.domain} is no longer active (cancelled now, refunded, or the account was deleted). Do not buy it.`,
    'If you already bought it, remove it from the Vercel project and let it lapse.',
    why === 'owner-removed'
      ? (refunded ? 'The subscription was cancelled and the $39 refunded in full automatically (nothing was bought by the system).' : 'The system is cancelling the subscription and refunding the $39 (retried every 10 minutes). Check Stripe if you do not see the refund soon.')
      : `Check Stripe: if the $39 was not refunded already, refund it.${links ? " The Can't get this name link below cancels and refunds in one step (safe to repeat) and closes the order." : ''}`,
    '', ...factLines(f),
    ...(links ? ['', links.cant] : []),
  ]);
}

export function endedEmail(f: OrderFacts, endLink: string | null): Mail {
  return textMail(`Domain period ended: ${f.domain} - detach it`, [
    `The subscription for ${f.domain} is no longer active, so the paid period is over.`,
    '',
    'What to do:',
    `1. Remove ${f.domain} (and www.${f.domain}) from Vercel project ${f.project}: ${projectLink(f)}`,
    '2. Do not renew the registration at your registrar.',
    ...(endLink
      ? ['3. Click Mark ended. It checks the subscription is over, republishes the site on its free address and closes the order:', endLink, 'Opening the link only shows the checks; nothing changes until you press the button on the page.']
      : ['3. Then close the order by hand.', NO_LINKS]),
    '', ...factLines(f),
  ]);
}

export function renewalDueEmail(f: OrderFacts, renewsOn: string): Mail {
  return textMail(`Domain renewal due: ${f.domain} renews ${renewsOn.slice(0, 10)}`, [
    `The customer's $39 subscription for ${f.domain} renews on ${utc(renewsOn)}. Make sure the registration at your registrar renews too, or the name will lapse while the customer is paying.`,
    '', ...factLines(f),
  ]);
}

// ─── customer ───

/** Where the customer manages the domain subscription (web app). */
const manageUrl = (origin: string) => `${origin}/app/domain`;

export function customerOrderedEmail(f: Pick<OrderFacts, 'domain' | 'liveUrl'>, origin: string): Mail {
  return textMail(`We're setting up ${f.domain}`, [
    `Thanks for your order. We're setting up ${f.domain} for your website by hand. This is ${FULFIL_PROMISE}. We'll email you again as soon as it's live.`,
    '',
    f.liveUrl ? `Until then your current address keeps working: ${f.liveUrl}` : 'Until then your current address keeps working.',
    '',
    `Your $39/year subscription renews every year until you cancel it. You can cancel or manage it here: ${manageUrl(origin)}`,
    `If we can't get this exact name, we'll refund your $39 in full and you can pick another.`,
    '',
    'Questions? Reply to this email.',
  ], replyToAddress());
}

export function customerLiveEmail(f: Pick<OrderFacts, 'domain' | 'liveUrl' | 'paidUntil'> & { autoRenew?: boolean }, origin: string): Mail {
  return textMail(`${f.domain} is live`, [
    `Your website is now live at https://${f.domain}`,
    '',
    f.liveUrl ? `Your previous address keeps working too: ${f.liveUrl}` : 'Your previous address keeps working too.',
    '',
    f.autoRenew === false
      ? `Your $39/year subscription is set to end${f.paidUntil ? ` on ${new Date(f.paidUntil).toISOString().slice(0, 10)}` : ' at the end of the paid year'} and will not renew. The domain keeps working until then. Manage it here: ${manageUrl(origin)}`
      : `Your $39/year subscription renews every year${f.paidUntil ? ` (next on ${new Date(f.paidUntil).toISOString().slice(0, 10)})` : ''} until you cancel it. If you cancel, the domain keeps working until the paid year ends. Manage it here: ${manageUrl(origin)}`,
    '',
    'Questions? Reply to this email.',
  ], replyToAddress());
}

export function customerRefundedEmail(f: Pick<OrderFacts, 'domain' | 'liveUrl'>, origin: string): Mail {
  return textMail(`Your $39 for ${f.domain} was refunded`, [
    `We could not register ${f.domain} for you. Your $39 has been refunded in full and the subscription is cancelled. A refund usually shows on your statement within 5 to 10 business days.`,
    '',
    f.liveUrl ? `Your website is not affected and is still at ${f.liveUrl}` : 'Your website is not affected.',
    `You can pick another name any time: ${manageUrl(origin)} (a new name is $39/year).`,
    '',
    'Questions? Reply to this email.',
  ], replyToAddress());
}
