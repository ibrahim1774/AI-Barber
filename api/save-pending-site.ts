import { Storage } from '@google-cloud/storage';
import { supabasePurchases } from '../lib/ios/purchases.js';
import { draftOwnFolder, logoProblem } from '../lib/logoUrl.js';
import { isPreconditionFailed, readPendingSite, readPendingVersioned, slugify, type VersionedPending } from '../lib/publishSite.js';

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
  /**
   * The stored copy with its GCS generation (review fix round 1, finding 6). With it, the save and
   * the delete are conditional on that generation, so a server stamp landing between the
   * published check and the write (the first checkout deploy) is never dropped or deleted.
   * Absent (older fakes): isPublished and unconditional writes.
   */
  readVersioned?(slug: string): Promise<VersionedPending>;
}

const liveDeps: SavePendingDeps = {
  isAppSlug: async (slug) => (await supabasePurchases().findBySlug(slug)) != null,
  isPublished: async (slug) => !!(await readPendingSite(slug))?.deployedUrl,
  readVersioned: readPendingVersioned,
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
    // The canonical slug (lib/publishSite.slugify) is the key every server path reads, and the
    // published check below reads exactly the object this request writes or deletes.
    const safeSiteId = slugify(siteId);
    if (!safeSiteId) {
      return res.status(400).json({ ok: false, error: 'Invalid siteId' });
    }

    try {
      if (await deps.isAppSlug(safeSiteId)) {
        console.warn(`[save-pending-site] ${req.method} refused: ${safeSiteId} is an iOS app site`);
        return res.status(409).json({ ok: false, error: 'slug-taken' });
      }
    } catch (e: any) {
      console.error(`[save-pending-site] ${req.method} ${safeSiteId}: ios_purchases lookup failed (refusing):`, e?.message || e);
      return res.status(503).json({ ok: false, error: 'lookup-failed' });
    }
    let generation: number | null = null;
    try {
      let published: boolean;
      if (deps.readVersioned) {
        const v = await deps.readVersioned(safeSiteId);
        published = !!v.pending?.deployedUrl;
        generation = v.generation;
      } else {
        published = await deps.isPublished(safeSiteId);
      }
      if (published) {
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

    // A write that lost the race to a server stamp (412) is the published case.
    const stampedMeanwhile = () => {
      console.warn(`[save-pending-site] ${req.method} refused: ${safeSiteId} changed since the check (published meanwhile)`);
      return res.status(409).json({ ok: false, error: 'site-published' });
    };

    if (req.method === 'DELETE') {
      if (generation === 0) return res.status(200).json({ ok: true }); // nothing stored
      try {
        await file.delete({ ignoreNotFound: true, ...(generation != null ? { ifGenerationMatch: generation } : {}) } as any);
      } catch (e: any) {
        if (generation != null && isPreconditionFailed(e)) return stampedMeanwhile();
        // Older GCS clients don't support ignoreNotFound — swallow 404s.
      }
      return res.status(200).json({ ok: true });
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ ok: false, error: 'Missing data payload' });
    }
    const clean: Record<string, unknown> = { ...data };
    for (const k of SERVER_ONLY_FIELDS) delete clean[k];
    // A shop logo must be a png/jpeg this site uploaded to its own <site>/logo folder in our bucket (lib/logoUrl.ts).
    // The stored copy is { siteId, siteData, imageUrlMap }: the logo is siteData.logo, with its URL either inline or, in the
    // pending shape, the 'uploaded' marker plus imageUrlMap.logo. A stray imageUrlMap.logo with no siteData.logo is refused too.
    const sdata = clean.siteData && typeof clean.siteData === 'object' ? (clean.siteData as Record<string, any>) : null;
    const umap = clean.imageUrlMap && typeof clean.imageUrlMap === 'object' ? (clean.imageUrlMap as Record<string, unknown>) : null;
    if (sdata?.logo != null || umap?.logo != null) {
      const l = sdata?.logo;
      const logo = l && typeof l === 'object' && !Array.isArray(l) ? { ...l, url: l.url === 'uploaded' ? umap?.logo : l.url } : l;
      const rules = { bucketName, allowFolder: draftOwnFolder(safeSiteId) };
      let problem = logoProblem(logo, rules);
      // The pending shape renders from imageUrlMap.logo, so when the map names a logo it must pass the same rules even if
      // the inline URL is valid (no external URL, no other site's folder).
      if (!problem && umap?.logo != null && logo && typeof logo === 'object') problem = logoProblem({ ...(logo as object), url: umap.logo }, rules);
      if (problem) {
        console.warn(`[save-pending-site] ${req.method} ${safeSiteId} refused: ${problem}`);
        return res.status(400).json({ ok: false, error: 'Invalid logo' });
      }
    }

    const payload = JSON.stringify({ siteId: safeSiteId, savedAt: Date.now(), data: clean });
    if (payload.length > 5 * 1024 * 1024) {
      return res.status(413).json({ ok: false, error: 'Pending site payload too large' });
    }

    try {
      await file.save(payload, {
        contentType: 'application/json',
        resumable: false,
        metadata: { cacheControl: 'private, max-age=0, no-store' },
        ...(generation != null ? { preconditionOpts: { ifGenerationMatch: generation } } : {}),
      });
    } catch (e: any) {
      if (generation != null && isPreconditionFailed(e)) return stampedMeanwhile();
      throw e;
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('[save-pending-site] Error:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
