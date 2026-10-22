import { Storage } from '@google-cloud/storage';
import { supabasePurchases } from '../lib/ios/purchases.js';
import { readPendingSite } from '../lib/publishSite.js';

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
//
// This endpoint is unauthenticated, so it must never touch an iOS app site:
// for those slugs the stored copy is the server's source of truth (versions,
// admin edits, the 409 site-updated guard). A siteId bound in
// ios_purchases.site_slug is refused (409 slug-taken) for POST and DELETE, and
// a lookup failure refuses too (the web flow keeps its localStorage copy).
// The version fields only the server sets are always dropped from `data`.
//
// A web site that has been published (its stored copy carries a deployedUrl stamp) is
// refused too (409 site-published), for POST and DELETE: the stamp is what tells the Stripe
// webhook and api/publish-sweeper the site is live. Before this, anyone could replace a
// just-paid customer's copy with their own content and a dead deployedUrl, and the next
// sweep deployed it to the customer's site. deployedUrl is now server-owned: dropped from
// `data`, stamped by /api/deploy-site after an authorised deploy and by lib/publishSite.

/** Fields only server code (iOS publish, admin edits, deploys) may write. */
export const SERVER_ONLY_FIELDS = ['version', 'editedBy', 'editedAt', 'adminVersion', 'note', 'deployedUrl'] as const;

export interface SavePendingDeps {
  /** Is this slug bound to an iOS purchase? Throws when the lookup fails. */
  isAppSlug(slug: string): Promise<boolean>;
  /** Does this slug's stored copy carry a deployedUrl stamp (the site is published)? Throws when the read fails. */
  isPublished(slug: string): Promise<boolean>;
}

const liveDeps: SavePendingDeps = {
  isAppSlug: async (slug) => (await supabasePurchases().findBySlug(slug)) != null,
  isPublished: async (slug) => !!(await readPendingSite(slug))?.deployedUrl,
};

export default function handler(req: any, res: any) {
  return savePendingSite(req, res, liveDeps);
}

export async function savePendingSite(req: any, res: any, deps: SavePendingDeps) {
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

    try {
      if (await deps.isAppSlug(safeSiteId.toLowerCase())) {
        console.warn(`[save-pending-site] ${req.method} refused: ${safeSiteId} is an iOS app site`);
        return res.status(409).json({ ok: false, error: 'slug-taken' });
      }
    } catch (e: any) {
      console.error(`[save-pending-site] ${req.method} ${safeSiteId}: ios_purchases lookup failed (refusing):`, e?.message || e);
      return res.status(503).json({ ok: false, error: 'lookup-failed' });
    }
    try {
      if (await deps.isPublished(safeSiteId.toLowerCase())) {
        console.warn(`[save-pending-site] ${req.method} refused: ${safeSiteId} is already published`);
        return res.status(409).json({ ok: false, error: 'site-published' });
      }
    } catch (e: any) {
      console.error(`[save-pending-site] ${req.method} ${safeSiteId}: stored copy read failed (refusing):`, e?.message || e);
      return res.status(503).json({ ok: false, error: 'lookup-failed' });
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

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ ok: false, error: 'Missing data payload' });
    }
    const clean: Record<string, unknown> = { ...data };
    for (const k of SERVER_ONLY_FIELDS) delete clean[k];

    const payload = JSON.stringify({ siteId: safeSiteId, savedAt: Date.now(), data: clean });
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
