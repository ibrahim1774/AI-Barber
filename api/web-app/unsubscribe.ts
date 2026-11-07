// Unsubscribe from sign-up reminders. GET only shows a confirm page (mail scanners GET links, so GET never writes).
// POST: RFC 8058 one-click from the mail provider (token in the URL, body "List-Unsubscribe=One-Click"), or the
// confirm page's button (same, plus page=1). The token is the credential; the URL carries the address, so the
// query string is never logged.
import { verifyUnsubscribeToken } from '../../lib/webApp/nudgeToken.js';
import { mailPage } from '../../lib/webApp/nudgeContinue.js';
import { suppress } from '../../lib/webApp/suppressions.js';

function html(res: any, code: number, body: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(code).send(body);
}
const bodyOf = (req: any): Record<string, any> => {
  const b = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
  return b && typeof b === 'object' ? b : {};
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.WEB_APP_NUDGE_SECRET || '';
  const b = req.method === 'POST' ? bodyOf(req) : {};
  const token = req.query?.t ?? b.t;
  const email = verifyUnsubscribeToken(token, secret);

  if (req.method === 'GET') {
    if (!email) return html(res, 200, mailPage({ heading: 'This link is not valid', body: 'To stop these emails, reply to any of them and say unsubscribe.' }));
    return html(res, 200, mailPage({
      heading: 'Stop these emails?', body: 'You will not get any more reminders about finishing your Prime Barber website.',
      button: { label: 'Unsubscribe', formAction: '/api/web-app/unsubscribe', fields: { t: String(token), page: '1' } },
    }));
  }

  const page = b.page === '1';
  if (!email) return page ? html(res, 400, mailPage({ heading: 'This link is not valid', body: 'To stop these emails, reply to any of them and say unsubscribe.' })) : res.status(400).send('invalid');
  try {
    // A missing table means nothing was saved: never claim "unsubscribed" then.
    if (!(await suppress(email, 'unsubscribe', page ? 'page' : 'one-click'))) throw new Error('not_ready');
  } catch (e: any) {
    console.error('[web-app unsubscribe] failed', e?.status ?? e?.message ?? 'error');
    return page ? html(res, 503, mailPage({ heading: "That didn't work", body: 'Please try again in a minute.' })) : res.status(503).send('try again');
  }
  if (page) return html(res, 200, mailPage({ heading: "You're unsubscribed", body: 'You will not get any more of these reminders.' }));
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send('unsubscribed');
}
