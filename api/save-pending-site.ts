import { Storage } from '@google-cloud/storage';

// Server-side persistence for the pendingSite payload that drives
// post-payment deployment. Mirrors the localStorage write in
// preparePendingSite() so the deploy can recover even if the visitor
// returns to the Stripe success URL from a DIFFERENT browser, an
// incognito window, or after their localStorage was cleared.
//
// POST { siteId, data } → stores JSON at pending-sites/${siteId}.json
// DELETE { siteId }     → removes the recovery copy after successful deploy
//
// Bucket access is server-side only via the GCP service account — the
// JSON is NOT publicly readable so shop names / phone numbers / etc.
// don't leak even if a siteId is guessed.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,DELETE');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const { siteId, data } = req.body || {};
    if (!siteId || typeof siteId !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing siteId' });
    }
    // Sanitize: only allow basic slug characters in the storage key so
    // a tampered siteId can't traverse out of the prefix.
    const safeSiteId = siteId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    if (!safeSiteId) {
      return res.status(400).json({ ok: false, error: 'Invalid siteId' });
    }

    const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!credentialsJson || !bucketName) {
      return res.status(500).json({ ok: false, error: 'Server configuration error' });
    }

    const credentials = JSON.parse(credentialsJson);
    const storage = new Storage({ credentials, projectId: credentials.project_id });
    const bucket = storage.bucket(bucketName);
    const filePath = `pending-sites/${safeSiteId}.json`;
    const file = bucket.file(filePath);

    if (req.method === 'DELETE') {
      try {
        await file.delete({ ignoreNotFound: true } as any);
      } catch {
        // Older GCS clients don't support ignoreNotFound — swallow 404s.
      }
      return res.status(200).json({ ok: true });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ ok: false, error: 'Missing data payload' });
    }

    const payload = JSON.stringify({ siteId: safeSiteId, savedAt: Date.now(), data });
    if (payload.length > 5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: 'Pending site payload too large' });
    }

    await file.save(payload, {
      contentType: 'application/json',
      metadata: { cacheControl: 'private, max-age=0, no-store' },
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('[save-pending-site] Error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal error' });
  }
}
