// Welcome and failed-payment emails for the web app. Never include a password: the email carries the site
// address, the account email, a sign-in link and a reset-password link.
import { APP_ORIGIN } from './webAppServer.js';

export interface EmailInput { email: string; siteUrl: string | null; tier: string }
export interface Mail { subject: string; html: string; text: string }

const TIER_NAME: Record<string, string> = { website: 'Website', bookings: 'Bookings', store: 'Store' };
/** What the customer signed up for, in words. */
const WHAT: Record<string, string> = { website: 'website hosting', bookings: 'website hosting and online bookings', store: 'website hosting, online bookings and your online store' };
const CAN: Record<string, string> = { website: 'edit your website', bookings: 'edit your website and take bookings', store: 'edit your website, take bookings and sell products' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const signInLink = (origin: string) => `${origin}/app/sign-in`;
export const resetLink = (origin: string) => `${origin}/app/forgot-password`;

function frame(title: string, intro: string, rows: Array<[string, string]>, cta: { label: string; href: string }, outro: string, origin: string): Mail {
  const list = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#777">${esc(k)}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`).join('');
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto;color:#111"><h2>${esc(title)}</h2><p>${intro}</p><table>${list}</table><p style="margin:24px 0"><a href="${cta.href}" style="background:#f4a100;color:#111;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">${esc(cta.label)}</a></p><p>${outro}</p><p style="color:#777;font-size:13px">Forgot your password? <a href="${resetLink(origin)}">Reset it here</a>. We never email passwords.</p></div>`;
  const text = `${title}\n\n${intro.replace(/<[^>]+>/g, '')}\n\n${rows.map(([k, v]) => `${k}: ${v.replace(/<[^>]+>/g, '')}`).join('\n')}\n\n${cta.label}: ${cta.href}\n\n${outro.replace(/<[^>]+>/g, '')}\n\nForgot your password? ${resetLink(origin)}\nWe never email passwords.`;
  return { subject: title, html, text };
}

export function welcomeEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const rows: Array<[string, string]> = [['Plan', esc(TIER_NAME[i.tier] ?? i.tier)], ['Your email', esc(i.email)]];
  if (i.siteUrl) rows.unshift(['Your site', `<a href="${esc(i.siteUrl)}">${esc(i.siteUrl)}</a>`]);
  const what = WHAT[i.tier] ?? 'AIBarber';
  return frame(`You signed up for ${what} with AIBarber`, `Thanks for signing up. You are now subscribed to ${what} with AIBarber, and your plan is active.`, rows, { label: 'Sign in', href: signInLink(origin) }, `Sign in with the email above to ${CAN[i.tier] ?? 'manage your site'}, and to manage your plan.`, origin);
}

export function failedPaymentEmail(i: EmailInput, origin = APP_ORIGIN()): Mail {
  const rows: Array<[string, string]> = [['Plan', esc(TIER_NAME[i.tier] ?? i.tier)], ['Your email', esc(i.email)]];
  if (i.siteUrl) rows.unshift(['Your site', `<a href="${esc(i.siteUrl)}">${esc(i.siteUrl)}</a>`]);
  const site = i.siteUrl ? `your site ${esc(i.siteUrl)}` : 'your site';
  return frame('Your AIBarber payment failed: you\'ll lose access to your site', `We could not take your latest payment for AIBarber ${esc(TIER_NAME[i.tier] ?? i.tier)}. <b>If it is not fixed, you'll lose access to your site</b>: ${site} will go offline and you will no longer be able to ${CAN[i.tier] ?? 'manage it'}.`, rows, { label: 'Sign in to update your card', href: signInLink(origin) }, 'Sign in, open Settings and choose Manage plan to update your payment method. We will keep trying your card for a few days.', origin);
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
