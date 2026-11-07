// Sign-up reminder link target. GET shows a Continue page and changes nothing (mail scanners GET links);
// POST (the button) signs the user in server-side and redirects. See lib/webApp/nudgeContinue.ts.
import { clientIp, memoryStore } from '../../lib/bookings/rateLimit.js';
import { continuePage, liveContinueDeps, performContinue, previewContinue } from '../../lib/webApp/nudgeContinue.js';
import { webAppOriginAllowed } from '../../lib/webApp/webAppServer.js';
import { modeOf } from '../../lib/webApp/reliability.js';

export const CONTINUE_PER_MINUTE = 10;
const limiter = memoryStore();

function html(res: any, code: number, body: string) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(code).send(body);
}
const tokenFrom = (req: any): unknown => {
  if (req.method === 'GET') return req.query?.t;
  const b = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : req.body;
  return b?.t;
};

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.WEB_APP_NUDGE_SECRET || '';
  let mode: 'live' | 'test';
  try { mode = modeOf(); } catch { return html(res, 200, continuePage('expired')); }
  if (!secret) return html(res, 200, continuePage('expired'));

  if (req.method === 'GET') {
    const token = tokenFrom(req);
    const state = previewContinue(token, { mode, secret, now: Date.now });
    return html(res, 200, continuePage(state, state === 'form' ? String(token) : undefined));
  }

  // POST: same-origin only (Origin/Sec-Fetch-Site must be ours when sent) and rate limited per IP.
  const origin = req.headers?.origin;
  const site = req.headers?.['sec-fetch-site'];
  if ((origin !== undefined && !webAppOriginAllowed(origin)) || (site !== undefined && site !== 'same-origin' && site !== 'same-site')) {
    return res.status(403).json({ error: 'forbidden_origin' });
  }
  if (!(await limiter.hit(`continue:${clientIp(req.headers)}`, CONTINUE_PER_MINUTE, 60_000, Date.now()))) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited' });
  }
  const out = await performContinue(tokenFrom(req), liveContinueDeps(mode, secret));
  if (out.kind === 'redirect') {
    if (out.cookies.length) res.setHeader('Set-Cookie', out.cookies);
    res.setHeader('Location', out.location);
    return res.status(303).end();
  }
  return html(res, 200, continuePage(out.state));
}
