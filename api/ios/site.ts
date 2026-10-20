import type { VercelRequest, VercelResponse } from '@vercel/node';
import { liveDeps, runIosSiteLookup } from '../../lib/ios/publishFlow.js';

// POST { transactionId } from the iOS app → the site bound to that purchase:
// { siteId, deployedUrl, siteData (real image URLs), active }.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    let body: any = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'bad-request' });
      }
    }
    const transactionId = body && typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
    if (!transactionId) return res.status(400).json({ error: 'bad-request' });
    const r = await runIosSiteLookup(transactionId, liveDeps());
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/site] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );
}
