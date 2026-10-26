import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runTransfer } from '../../lib/ios/transfer.js';
import { liveTransferDeps } from '../../lib/ios/transferLive.js';

// POST { transactionId, confirm? } with Authorization: Bearer <Supabase access token>.
//   200 { moved, linked: true } | 409 confirm-required { ownerHint, hasLiveSite, siteUrl? } | 409 account-has-site { slug }
//   | 409 purchase-changed | 402 subscription-inactive | 400 | 401 | 404 | 429 | 503.
// Moves a subscription linked to another account to the caller, only with confirm:true. See lib/ios/transfer.ts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    let body: unknown;
    try {
      body = req.body;
    } catch {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad-request' }); }
    }
    const r = await runTransfer(body, liveTransferDeps(), { authorization: req.headers?.authorization });
    if (r.status === 429) res.setHeader('Retry-After', '60');
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/transfer] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
