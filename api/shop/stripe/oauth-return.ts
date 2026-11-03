// GET ?code&state (or ?error&state): Stripe Connect OAuth redirect target. Verifies the signed state, exchanges the
// code, links the account to the shop, then 303s back to the web app (?stripe=return|refresh|taken). Bad state: 400 text.
import { liveOwnerStripeDeps } from '../../../lib/bookings/payments.js';
import { stripeOauthReturn } from '../../../lib/bookings/stripeOauth.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  try {
    const q = req.query ?? {};
    const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
    const r = await stripeOauthReturn({ code: one(q.code), state: one(q.state), error: one(q.error) }, liveOwnerStripeDeps());
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if ('redirect' in r) { res.setHeader('Location', r.redirect); return res.status(303).end(); }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(r.status).send(r.text);
  } catch (e: any) {
    console.error('[shop/stripe/oauth-return] error:', e?.name);
    return res.status(500).send('Something went wrong. Go back to Prime Barber and try again.');
  }
}
