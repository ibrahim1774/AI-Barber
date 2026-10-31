// Welcome and failed-payment emails for the web app. Never include a password: the email carries the site
// address, a sign-in link and a reset-password link. Table layout + inline CSS so it renders in every mail client.
import { APP_ORIGIN } from './webAppServer.js';

export interface EmailInput { email: string; siteUrl: string | null; tier: string }
export interface Mail { subject: string; html: string; text: string }

const TIER_NAME: Record<string, string> = { website: 'Website', bookings: 'Bookings', store: 'Store' };
/** What the plan includes, in a few words. */
const WHAT: Record<string, string> = { website: 'website hosting', bookings: 'website hosting + bookings', store: 'website hosting + bookings + store' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const signInLink = (origin: string) => `${origin}/app/sign-in`;
export const resetLink = (origin: string) => `${origin}/app/forgot-password`;

const AMBER = '#f4a100';
const INK = '#0d0d0d';

interface Layout {
  preheader: string;
  headline: string;
  lead: string;
  /** Plain "label: value" lines (also used for the text version). */
  facts: Array<[string, string, string?]>; // [label, text value, html value]
  cta: { label: string; href: string };
  note?: string;
  origin: string;
}

function render(l: Layout): Mail {
  const factRows = l.facts
    .map(([k, v, h]) => `<tr><td style="padding:10px 0;border-top:1px solid #2a2a2a;color:#8b919e;font-size:13px;width:84px;vertical-align:top">${esc(k)}</td><td style="padding:10px 0;border-top:1px solid #2a2a2a;color:#f4f5f8;font-size:15px;font-weight:600;word-break:break-all">${h ?? esc(v)}</td></tr>`)
    .join('');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f1ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${INK};border-radius:18px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<tr><td style="padding:26px 28px 0 28px"><span style="font-size:13px;letter-spacing:3px;font-weight:700;color:#fff">AI<span style="color:${AMBER}">BARBER</span></span></td></tr>
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
  return { subject: l.headline, html, text };
}

function facts(i: EmailInput): Layout['facts'] {
  const f: Layout['facts'] = [];
  if (i.siteUrl) f.push(['Site', i.siteUrl, `<a href="${esc(i.siteUrl)}" style="color:${AMBER};text-decoration:none">${esc(i.siteUrl.replace(/^https?:\/\//, ''))}</a>`]);
  f.push(['Plan', TIER_NAME[i.tier] ?? i.tier]);
  f.push(['Account', i.email]);
  return f;
}

export function welcomeEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const what = WHAT[i.tier] ?? 'AIBarber';
  return render({
    preheader: `Your ${what} plan is active.`,
    headline: `You signed up for ${what}`,
    lead: 'Your plan is active. Sign in to edit your site and manage your plan.',
    facts: facts(i),
    cta: { label: 'Sign in', href: signInLink(origin) },
    origin,
  });
}

export function failedPaymentEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  return render({
    preheader: 'Update your card to keep your site online.',
    headline: "Payment failed: you'll lose access to your site",
    lead: `We couldn't charge your card. <b style="color:#fff">Update it now</b> or your site goes offline.`,
    facts: facts(i),
    cta: { label: 'Update my card', href: signInLink(origin) },
    note: 'Sign in, open Settings, then Manage plan. We retry your card for a few days.',
    origin,
  });
}

export async function sendMail(to: string, mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY missing');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.WEB_APP_EMAIL_FROM || 'AIBarber <support@davoxa.com>', to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}
