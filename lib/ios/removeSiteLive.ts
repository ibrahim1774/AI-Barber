// Live wiring for removeSite.ts (Supabase, Vercel, GCS). Kept apart so removeSite.ts, deleteAccount.ts
// and takeOffline.ts stay pure and testable over injected deps.
import { deployRenderedSite } from '../deploySite.js';
import { findShopForSite } from '../siteSubpages.js';
import { bucket, readPendingSite, slugify } from '../publishSite.js';
import { offlineHtml } from './offlinePage.js';
import { supabasePurchases } from './purchases.js';
import { supabaseDomains, SITE_HOLDING_STATES } from './domainsRepo.js';
import { liveVercelDomains } from './vercelDomains.js';
import { projectFor } from './domainFlow.js';
import type { RemoveSiteDeps } from './removeSite.js';

/** The object path of one of OUR bucket's public URLs, else null (foreign hosts are never touched). */
export function ourObjectPath(url: unknown, bucketName: string): string | null {
  if (typeof url !== 'string') return null;
  const prefix = `https://storage.googleapis.com/${bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  let path = url.slice(prefix.length).split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { return null; }
  if (!path || path.includes('..') || path.startsWith('/')) return null;
  // Never the server's own JSON, whatever a (user supplied) URL says.
  if (/^(pending-sites|pending-sites-history|admin-republish-runs)\//.test(path)) return null;
  return path;
}

export function liveRemoveDeps(): RemoveSiteDeps {
  const purchases = supabasePurchases();
  return {
    now: () => Date.now(),
    markTakenDown: (otid, at) => purchases.markTakenDown(otid, at),
    async deployOffline(slug) {
      // Same page and same manage/order-link rule as the lapse sweep (api/ios/sweep.ts).
      const shop = await findShopForSite(slug);
      await deployRenderedSite({ siteId: slug, html: offlineHtml(), subpages: shop ? { mode: 'manage-only' } : null });
    },
    async releaseDomains(slug) {
      const repo = supabaseDomains();
      const row = await repo.holdingSite(slug);
      if (!row) return;
      if (!row.simulated) {
        const vercel = liveVercelDomains();
        if (!vercel) throw new Error('Vercel is not configured; cannot release the custom domain');
        await vercel.removeProjectDomain(projectFor(slug), row.domain); // 'absent' is fine
      }
      await repo.update(row.original_transaction_id, SITE_HOLDING_STATES, { state: 'detached', detached_at: new Date().toISOString() });
    },
    async deleteContent(slug) {
      const b = bucket();
      const safe = slugify(slug);
      // Photos first (the list lives in the stored copy), then the copy itself, so a retry after a
      // failure still finds the list. Missing objects are fine.
      const pending = await readPendingSite(safe);
      const paths = new Set<string>();
      for (const u of Object.values(pending?.imageUrlMap ?? {})) {
        const p = ourObjectPath(u, b.name);
        if (p) paths.add(p);
      }
      for (const p of paths) await b.file(p).delete({ ignoreNotFound: true });
      const [history] = await b.getFiles({ prefix: `pending-sites-history/${safe}/` });
      for (const f of history) await f.delete({ ignoreNotFound: true });
      await b.file(`pending-sites/${safe}.json`).delete({ ignoreNotFound: true });
    },
  };
}
