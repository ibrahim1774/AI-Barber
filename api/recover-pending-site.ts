import { Storage } from '@google-cloud/storage';

// Server-side recovery for the pendingSite payload when the visitor
// returns to the Stripe success URL from a context that lost the
// localStorage write (different browser, incognito, cleared cache).
//
// POST { sessionId } → verifies the Stripe checkout session, extracts
//                      siteId from session.client_reference_id +
//                      metadata.siteId, fetches the pending JSON saved
//                      by /api/save-pending-site, returns the data.
//
// Caller MUST pass a real Stripe session id — we verify it against
// Stripe before serving the pending site so a tampered request can't
// drain pending payloads for siteIds they didn't pay for.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { sessionId } = req.body || {};
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing sessionId' });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ ok: false, error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }

    // Verify the Stripe session exists + belongs to us (Stripe rejects
    // session ids from other accounts). Read siteId from
    // client_reference_id / metadata.siteId — both are set when the
    // session is created in /api/create-checkout-session.
    const stripeResp = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
    );
    if (!stripeResp.ok) {
      return res.status(404).json({ ok: false, error: 'Invalid session' });
    }
    const session = await stripeResp.json();
    const siteIdRaw: string | null =
      (typeof session.client_reference_id === 'string' && session.client_reference_id) ||
      (session.metadata && typeof session.metadata.siteId === 'string' && session.metadata.siteId) ||
      null;
    if (!siteIdRaw) {
      return res.status(404).json({ ok: false, error: 'No siteId on session' });
    }
    const safeSiteId = siteIdRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    if (!safeSiteId) {
      return res.status(404).json({ ok: false, error: 'Invalid siteId on session' });
    }

    const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!credentialsJson || !bucketName) {
      return res.status(500).json({ ok: false, error: 'Server configuration error' });
    }

    const credentials = JSON.parse(credentialsJson);
    const storage = new Storage({ credentials, projectId: credentials.project_id });
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(`pending-sites/${safeSiteId}.json`);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ ok: false, error: 'No pending site found for this session' });
    }

    const [buf] = await file.download();
    let payload: any;
    try {
      payload = JSON.parse(buf.toString('utf-8'));
    } catch {
      return res.status(500).json({ ok: false, error: 'Pending site payload corrupted' });
    }

    return res.status(200).json({
      ok: true,
      siteId: safeSiteId,
      data: payload?.data ?? null,
      savedAt: payload?.savedAt ?? null,
    });
  } catch (error: any) {
    console.error('[recover-pending-site] Error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal error' });
  }
}
