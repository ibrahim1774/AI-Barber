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
export interface Mail {
  subject: string; html: string; text: string;
  /** Optional Reply-To address (a real, monitored mailbox). */ replyTo?: string;
  /** Optional sender override (full "Name <addr>"). Absent: WEB_APP_EMAIL_FROM or the default. */ from?: string;
  /** Optional extra mail headers (List-Unsubscribe etc.). Only sent to Resend when present. */ headers?: Record<string, string>;
  /** Optional Resend tags. Only sent to Resend when present. */ tags?: { name: string; value: string }[];
}

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

function facts(i: EmailInput): Layout['facts'] {
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

/** Reply-To for customer and owner mail: WEB_APP_REPLY_TO when set, else support@davoxa.com. Read per call so tests and env changes apply. */
export const replyToAddress = (): string => process.env.WEB_APP_REPLY_TO?.trim() || 'support@davoxa.com';

/**
 * Plain, light failed-payment mail: white page, dark text, ONE action link (the update-payment button), a text part
 * that mirrors the HTML, no hidden preheader, no sign-in or reset links, a one-line reason for the email.
 */
export function failedPaymentEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const reminder = (i.reminder ?? 0) > 0;
  const href = i.updateUrl || signInLink(origin);
  const first = firstOf(i.firstName);
  const subject = (reminder ? 'Reminder: ' : '') + (first ? `${first}, your payment didn't go through` : "Your payment didn't go through");
  const headline = reminder ? "Your payment still hasn't gone through" : "Your payment didn't go through";
  const planName = PLAN[i.tier] ?? 'barber site hosting';
  const lead = `We couldn't charge your card for your ${planName}. Update your card to keep your site online.`;
  const rows: Array<[string, string]> = [];
  if (i.siteUrl) rows.push(['Site', i.siteUrl.replace(/^https?:\/\//, '')]);
  rows.push(['Plan', TIER_NAME[i.tier] ?? i.tier]);
  const footer = 'You are getting this because you have a Prime Barber plan. Questions? Reply to this email.';
  const factRows = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555;font-size:14px;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#111;font-size:14px">${esc(v)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111">
<p style="margin:0 0 12px;font-size:16px;font-weight:600">${esc(headline)}</p>
<p style="margin:0 0 12px;font-size:15px;line-height:22px">${esc(lead)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${factRows}</table>
<p style="margin:0 0 16px;font-size:15px"><a href="${esc(href)}" style="color:#0b57d0">Update payment method</a></p>
<p style="margin:0;font-size:12px;line-height:18px;color:#666">${esc(footer)}</p>
</body></html>`;
  const text = [headline, '', lead, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Update payment method: ${href}`, '', footer].join('\n');
  return { subject, html, text, replyTo: replyToAddress() };
}

export interface NudgeInput {
  email: string;
  firstName?: string | null;
  /** Shop name from the draft; omitted phrasing when blank. */
  shopName?: string | null;
  /** Signed one-tap sign-in link (on the app origin). The only link in the mail. */
  continueUrl: string;
}

/** "Ibrahim from Prime Barber <addr>": the address comes from WEB_APP_NUDGE_FROM, else WEB_APP_EMAIL_FROM, else support@davoxa.com. */
export function nudgeFrom(): string {
  const raw = process.env.WEB_APP_NUDGE_FROM?.trim() || process.env.WEB_APP_EMAIL_FROM?.trim() || 'support@davoxa.com';
  const addr = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  return `Ibrahim from Prime Barber <${addr}>`;
}

/**
 * Unpaid sign-up reminder, step 1 (1 h), 2 (24 h) or 3 (72 h). A plain personal letter, built to reach the Primary tab:
 * no logo, header, button or table, ONE plain text link, no footer, no List-Unsubscribe headers and no unsubscribe link (the opt-out
 * is a grey P.S. line: reply "stop"), no prices, no images or tracking. The text part mirrors the HTML.
 */
export function signupNudgeEmail(step: 1 | 2 | 3, i: NudgeInput): Mail {
  const first = firstOf(i.firstName);
  const shop = (i.shopName || '').replace(/\s+/g, ' ').trim();
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const hi = first ? `Hi ${first},` : 'Hi,';
  const site = shop ? `your ${shop} website` : 'your website';
  let subject: string; let paragraphs: string[]; let closing: string[];
  if (step === 1) {
    subject = first ? `${first}, ${site} is saved` : `${cap(site)} is saved`;
    paragraphs = [hi, `Your website${shop ? ` for ${shop}` : ''} is saved in your account. Nothing is lost.`,
      "When you're ready, tap the link below. It signs you back in and opens your site so you can finish it and put it online."];
    closing = ['If you have a question, just reply to this email.'];
  } else if (step === 2) {
    subject = `${cap(site)} is still waiting`;
    paragraphs = [hi, `${cap(site)} is still saved, with all your pages, services and photos.`,
      'It takes about a minute to finish and go live. Tap the link below to sign back in and pick up where you left off.'];
    closing = ["Stuck on something? Reply and tell me what's in the way. I read every email."];
  } else {
    subject = `Still want ${site}?`;
    paragraphs = [hi, `This is the last reminder from me. ${cap(site)} is still saved and ready to finish whenever you want.`,
      'Tap the link below to sign back in and open it.'];
    closing = ["If you decided it's not for you, no problem. You won't get any more emails about it."];
  }
  const postal = process.env.WEB_APP_POSTAL_ADDRESS?.trim();
  const optOut = 'P.S. If you\'d rather not hear from me about this, just reply "stop" and I won\'t email you about it again.';
  const linkLabel = 'Finish my website';
  const p = (t: string) => `<p>${esc(t)}</p>`;
  const grey = (t: string) => `<p style="color:#777777;font-size:13px">${esc(t)}</p>`;
  const html = [
    '<!doctype html><html><body>',
    ...paragraphs.map(p),
    `<p><a href="${esc(i.continueUrl)}">${linkLabel}</a></p>`,
    ...closing.map(p),
    '<p>Ibrahim<br>Prime Barber</p>',
    grey(optOut),
    ...(postal ? [grey(`Prime Barber, ${postal}`)] : []),
    '</body></html>',
  ].join('\n');
  const text = [
    ...paragraphs.flatMap((x) => [x, '']),
    `${linkLabel}: ${i.continueUrl}`, '',
    ...closing.flatMap((x) => [x, '']),
    'Ibrahim', 'Prime Barber', '',
    optOut,
    ...(postal ? ['', `Prime Barber, ${postal}`] : []),
  ].join('\n');
  return {
    subject, html, text, replyTo: replyToAddress(), from: nudgeFrom(),
    tags: [{ name: 'kind', value: 'signup_nudge' }, { name: 'step', value: String(step) }],
  };
}

export async function sendMail(to: string, mail: Mail, fetchImpl: typeof fetch = fetch, idempotencyKey: string = randomUUID()): Promise<string> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY missing');
  const init = {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: mail.from || process.env.WEB_APP_EMAIL_FROM || 'Prime Barber <support@davoxa.com>', to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}), ...(mail.headers && Object.keys(mail.headers).length ? { headers: mail.headers } : {}), ...(mail.tags && mail.tags.length ? { tags: mail.tags } : {}) }),
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
