// GET/POST /api/web-app/domain-action?t=<signed token>: the operator links of a manual web domain order
// (Mark live / Can't get this name / Mark ended). Ibrahim only: the link is emailed to DOMAIN_ORDERS_EMAIL,
// carries an HMAC (DOMAIN_ADMIN_LINK_SECRET), expires after 30 days and is single use (the conditional state update).
// GET only shows the checks and writes nothing (mail scanners prefetch links); POST acts and needs a same-origin browser.
import { clientIp, domainActionLimiter } from '../../lib/bookings/rateLimit.js';
import { domainActionView, postAllowed, runDomainAction } from '../../lib/webApp/domainManual.js';
import { liveManualEnv } from '../../lib/webApp/domainManualLive.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const send = (status: number, html: string) => res.status(status).send(html);
  if (req.method !== 'GET' && req.method !== 'POST') return send(405, '<p>Method not allowed.</p>');
  try {
    const post = req.method === 'POST';
    if (!(await domainActionLimiter.allow(clientIp(req.headers), post ? 'write' : 'read'))) return send(429, '<p>Too many requests. Try again in a minute.</p>');
    if (post && !postAllowed(req.headers)) return send(403, '<p>This action must be pressed on the confirmation page.</p>');
    const token = post ? (req.body?.t ?? req.query?.t) : req.query?.t;
    const env = liveManualEnv();
    const r = post ? await runDomainAction(token, env) : await domainActionView(token, env);
    return send(r.status, r.html);
  } catch (e: any) {
    console.error('[web-app/domain-action] error:', e?.code || e?.message || e); // never the token
    return send(500, '<p>Something went wrong. Nothing was changed that you can rely on: reload the link to see the current state.</p>');
  }
}
