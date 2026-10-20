import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleAppleNotification, liveNotificationDeps } from '../../lib/ios/notifications.js';

// App Store Server Notifications V2: POST { signedPayload }. Records subscription state only.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    let body: any;
    try {
      body = req.body; // @vercel/node parses lazily and throws on malformed JSON
    } catch {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'bad-request' });
      }
    }
    const signedPayload = body && typeof body.signedPayload === 'string' ? body.signedPayload.trim() : '';
    if (!signedPayload) return res.status(400).json({ error: 'bad-request' });
    const r = await handleAppleNotification(signedPayload, liveNotificationDeps());
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/apple-notification] handler error:', e?.message || e);
    return res.status(500).json({ error: 'temporarily-unavailable' });
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
