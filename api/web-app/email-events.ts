// Resend webhook receiver: bounced (hard) and complained -> suppression list. Svix signature required.
import { handleResendEvent, verifySvix } from '../../lib/webApp/resendWebhook.js';
import { readRawBody } from '../../lib/webApp/webAppServer.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) { console.error('[web-app email-events] RESEND_WEBHOOK_SECRET not set'); return res.status(503).json({ error: 'not_configured' }); }
  let raw: string;
  try { raw = await readRawBody(req); } catch { return res.status(400).json({ error: 'bad_request' }); }
  const h = req.headers ?? {};
  if (!verifySvix(raw, { id: h['svix-id'], timestamp: h['svix-timestamp'], signature: h['svix-signature'] }, secret)) return res.status(400).json({ error: 'bad_signature' });
  let event: any;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad_json' }); }
  try {
    const out = await handleResendEvent(event);
    if (out.tableMissing) return res.status(503).json({ error: 'not_ready' });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[web-app email-events] failed', e?.status ?? 'error'); // never the body or addresses
    return res.status(500).json({ error: 'failed' });
  }
}
