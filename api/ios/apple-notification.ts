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
    // Superwall's revenue tracking gets the same notification, unmodified; it
    // never blocks or changes our own handling.
    const forwarded = forwardToSuperwall(body);
    const r = await handleAppleNotification(signedPayload, liveNotificationDeps());
    await forwarded;
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/apple-notification] handler error:', e?.message || e);
    return res.status(500).json({ error: 'temporarily-unavailable' });
  }
}

async function forwardToSuperwall(body: unknown): Promise<void> {
  const url = process.env.SUPERWALL_ASN_FORWARD_URL;
  if (!url) return;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.error('[ios/apple-notification] Superwall forward failed:', r.status);
  } catch (e: any) {
    console.error('[ios/apple-notification] Superwall forward failed:', e?.name || e?.message || e);
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
