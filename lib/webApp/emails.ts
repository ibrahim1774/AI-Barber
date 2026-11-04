// Welcome and failed-payment emails for the web app. Never include a password: the email carries the site
// address, a sign-in link and a reset-password link. Table layout + inline CSS so it renders in every mail client.
import { randomUUID } from 'node:crypto';
import { APP_ORIGIN } from './webAppServer.js';

export interface EmailInput {
  email: string; siteUrl: string | null; tier: string;
  /** Account holder's first name, when known (used in the failed-payment subject). */
  firstName?: string | null;
  /** Stripe-hosted page where this customer fixes the payment (hosted invoice). Falls back to sign-in. */
  updateUrl?: string | null;
  /** 0 = the first notice; 1+ = a follow-up reminder. */
  reminder?: number;
}
export interface Mail { subject: string; html: string; text: string; /** Optional Reply-To address (a real, monitored mailbox). */ replyTo?: string }

const TIER_NAME: Record<string, string> = { website: 'Custom site', bookings: 'Custom site + booking', store: 'Custom site, booking + your own store' };
/** What the plan includes, in a few words. */
const WHAT: Record<string, string> = { website: 'website hosting', bookings: 'website hosting + bookings', store: 'website hosting + bookings + store' };
/** Plan names used in subjects, kept short. */
const PLAN: Record<string, string> = { website: 'barber site hosting', bookings: 'barber booking + site plan', store: 'barber store + booking + site plan' };
export const firstOf = (n?: string | null) => (n || '').trim().split(/\s+/)[0];
/** "Jack, your barber site hosting payment failed" (name dropped when unknown). */
const personal = (n: string | null | undefined, rest: (plan: string) => string, tier: string) => {
  const f = firstOf(n); const t = rest(PLAN[tier] ?? 'barber site hosting');
  return f ? `${f}, ${t}` : t.charAt(0).toUpperCase() + t.slice(1);
};
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const signInLink = (origin: string) => `${origin}/app/sign-in`;
export const resetLink = (origin: string) => `${origin}/app/forgot-password`;

const AMBER = '#f4a100';
const INK = '#0d0d0d';

export interface Layout {
  subject?: string;
  preheader: string;
  headline: string;
  lead: string;
  /** Plain "label: value" lines (also used for the text version). */
  facts: Array<[string, string, string?]>; // [label, text value, html value]
  cta: { label: string; href: string };
  note?: string;
  origin: string;
}

export function render(l: Layout): Mail {
  const factRows = l.facts
    .map(([k, v, h]) => `<tr><td style="padding:10px 0;border-top:1px solid #2a2a2a;color:#8b919e;font-size:13px;width:64px;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #2a2a2a;color:#f4f5f8;font-size:15px;font-weight:600;white-space:nowrap">${h ?? esc(v)}</td></tr>`)
    .join('');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f1ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${INK};border-radius:18px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<tr><td style="padding:26px 28px 0 28px"><span style="font-size:13px;letter-spacing:3px;font-weight:700;color:#fff">PRIME<span style="color:${AMBER}">BARBER</span></span></td></tr>
<tr><td style="padding:22px 28px 0 28px"><div style="font-size:24px;line-height:30px;font-weight:700;color:#fff">${esc(l.headline)}</div><div style="margin-top:10px;font-size:15px;line-height:22px;color:#c9ccd4">${l.lead}</div></td></tr>
<tr><td style="padding:20px 28px 0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #2a2a2a">${factRows}</table></td></tr>
<tr><td style="padding:26px 28px 6px 28px"><a href="${l.cta.href}" style="display:block;text-align:center;background:${AMBER};color:#15130c;text-decoration:none;padding:15px 20px;border-radius:12px;font-size:15px;font-weight:700">${esc(l.cta.label)}</a></td></tr>
${l.note ? `<tr><td style="padding:14px 28px 0 28px;font-size:13px;line-height:19px;color:#8b919e">${l.note}</td></tr>` : ''}
<tr><td style="padding:22px 28px 26px 28px;font-size:12px;line-height:18px;color:#6b7280">Forgot your password? <a href="${resetLink(l.origin)}" style="color:#c9ccd4">Reset it</a>. We never email passwords.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    l.headline, '', l.lead.replace(/<[^>]+>/g, ''), '',
    ...l.facts.map(([k, v]) => `${k}: ${v}`), '',
    `${l.cta.label}: ${l.cta.href}`,
    ...(l.note ? ['', l.note.replace(/<[^>]+>/g, '')] : []),
    '', `Forgot your password? ${resetLink(l.origin)}`, 'We never email passwords.',
  ].join('\n');
  return { subject: l.subject ?? l.headline, html, text };
}

function facts(i: EmailInput, bare = false): Layout['facts'] {
  const f: Layout['facts'] = [];
  if (i.siteUrl) f.push(['Site', i.siteUrl, `<a href="${esc(i.siteUrl)}" style="color:${AMBER};text-decoration:none">${esc(i.siteUrl.replace(/^https?:\/\//, ''))}</a>`]);
  f.push(['Plan', TIER_NAME[i.tier] ?? i.tier]);
  f.push(['Account', i.email]);
  return f;
}

export function welcomeEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const plan = TIER_NAME[i.tier] ?? 'Prime Barber';
  const first = firstOf(i.firstName);
  return render({
    // Short and the same for every plan so a phone preview never cuts it off; the plan is named in the body.
    subject: `${first ? `Welcome ${first}! ` : 'Welcome! '}Barber plan active`,
    preheader: `Your plan: ${plan}.`,
    headline: "You're signed up",
    lead: `Your plan is active: <b style="color:#fff">${esc(plan)}</b>. Sign in to edit your site and manage your plan.`,
    facts: facts(i),
    cta: { label: 'Sign in', href: signInLink(origin) },
    origin,
  });
}

export function failedPaymentEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const reminder = (i.reminder ?? 0) > 0;
  const href = i.updateUrl || signInLink(origin);
  return render({
    subject: (reminder ? 'Reminder: ' : '') + (firstOf(i.firstName) ? `${firstOf(i.firstName)}, barber site plan card failed` : 'Barber site plan card failed'),
    preheader: 'Your payment failed. Update your payment method to keep your site online.',
    headline: reminder ? 'Your site is still at risk' : 'Your payment failed',
    lead: `We couldn't charge your card for your barber website hosting. <b style="color:#fff">Update your payment method now or you're about to lose your site</b>: it will go offline and customers won't be able to find or book you.`,
    facts: facts(i, true),
    cta: { label: 'Update payment method', href },
    note: `You can also <a href="${signInLink(origin)}" style="color:#c9ccd4">sign in</a> and open Settings, then Manage plan. We keep retrying your card for about two weeks, and we'll remind you every 2 days until it's fixed.`,
    origin,
  });
}

export async function sendMail(to: string, mail: Mail, fetchImpl: typeof fetch = fetch, idempotencyKey: string = randomUUID()): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY missing');
  const init = {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: process.env.WEB_APP_EMAIL_FROM || 'Prime Barber <support@davoxa.com>', to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}) }),
  };
  // Resend allows ~2 requests/s per key and an order fires several mails at once: retry a 429/5xx once.
  let r = await fetchImpl('https://api.resend.com/emails', init);
  if (r.status === 429 || r.status >= 500) {
    await new Promise((res) => setTimeout(res, 1100));
    r = await fetchImpl('https://api.resend.com/emails', init);
  }
  if (!r.ok) throw new Error(`resend ${r.status}`);
  // A 2xx without a message id is not an accepted email: never report it as sent.
  const body: any = await r.json().catch(() => null);
  if (!body || typeof body.id !== 'string' || !body.id) throw new Error('resend accepted without a message id');
  return body.id;
}

/** Customer was charged twice and the second charge was refunded (only sent when WEB_APP_DUP_REFUND=1 acted). */
export function duplicateRefundEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const plan = TIER_NAME[i.tier] ?? 'Prime Barber';
  return render({
    subject: 'We refunded a duplicate Prime Barber charge',
    preheader: 'You were charged twice. We refunded the second charge.',
    headline: 'We refunded a duplicate charge',
    lead: `You were charged twice for Prime Barber, so we cancelled the second subscription and refunded it. Your plan stays active: <b style="color:#fff">${esc(plan)}</b>.`,
    facts: facts(i),
    cta: { label: 'Sign in', href: signInLink(origin) },
    note: 'To change your plan, sign in and open Settings, then Manage plan.',
    origin,
  });
}

/** A web subscriber who also bought through the App Store now pays twice. We only tell them; we never cancel for them. */
export function iosOverlapEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const site = i.siteUrl ? i.siteUrl.replace(/^https?:\/\//, '') : null;
  return render({
    subject: 'You now pay for Prime Barber twice',
    preheader: 'You have an App Store plan and a web plan. Cancel the web plan to stop paying twice.',
    headline: 'You now pay for Prime Barber twice',
    lead: 'You have a Prime Barber plan through the App Store and one on the web. Your shop now runs on your App Store plan, so the web plan no longer adds anything. To stop paying twice, cancel your web plan: sign in, open Settings, then Manage plan.',
    facts: facts(i),
    cta: { label: 'Manage web plan', href: signInLink(origin) },
    note: site ? `Note: your web site address ${esc(site)} goes offline when the web plan ends.` : undefined,
    origin,
  });
}

/** Plain operator alert. */
export function alertMail(subject: string, lines: string[]): Mail {
  return { subject, text: lines.join('\n'), html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap">${esc(lines.join('\n'))}</pre>` };
}

/**
 * Email the operator at WEB_APP_ALERT_EMAIL (no default address). Unset: log instead and resolve.
 * A mail failure throws, so the caller can choose to retry later.
 */
export async function alertOwner(subject: string, lines: string[]): Promise<void> {
  const to = process.env.WEB_APP_ALERT_EMAIL;
  if (!to) { console.error(`[web-app] ALERT ${subject}\n${lines.join('\n')}`); return; }
  await sendMail(to, alertMail(subject, lines));
}
