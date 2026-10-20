import type { VercelRequest, VercelResponse } from '@vercel/node';
import { deleteAccount, liveDeleteDeps } from '../../lib/ios/deleteAccount.js';

// POST with `Authorization: Bearer <supabase access token>`. No body is read:
// the token alone decides which account is deleted.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    const h = req.headers?.authorization;
    const r = await deleteAccount(Array.isArray(h) ? h[0] : h, liveDeleteDeps());
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/delete-account] handler error:', e?.message || e);
    return res.status(500).json({ error: 'delete-failed' });
  }
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );
}
