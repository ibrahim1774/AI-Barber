// Live wiring for removeSite.ts (Supabase, Vercel, GCS). Kept apart so removeSite.ts, deleteAccount.ts
// and takeOffline.ts stay pure and testable over injected deps.
import { createClient } from '@supabase/supabase-js';
import { deployRenderedSite } from '../deploySite.js';
import { findShopForSite } from '../siteSubpages.js';
import { bucket, readPendingSite, slugify } from '../publishSite.js';
import { offlineHtml } from './offlinePage.js';
import { supabasePurchases } from './purchases.js';
import { supabaseDomains } from './domainsRepo.js';
import { liveVercelDomains } from './vercelDomains.js';
import { projectFor, releaseDomainsForRemoval } from './domainFlow.js';
import type { RemoveSiteDeps } from './removeSite.js';
import { isReservedSlug } from './reservedSlugs.js';

/** The object path of one of OUR bucket's public URLs, else null (foreign hosts are never touched). */
export function ourObjectPath(url: unknown, bucketName: string): string | null {
  if (typeof url !== 'string') return null;
  const prefix = `https://storage.googleapis.com/${bucketName}/`;
  if (!url.startsWith(prefix)) return null;
  let path = url.slice(prefix.length).split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { return null; }
  if (!path || path.includes('..') || path.startsWith('/') || path.includes('//')) return null;
  // Never the server's own JSON, whatever a (user supplied) URL says.
  if (/^(pending-sites|pending-sites-history|admin-republish-runs)\//.test(path)) return null;
  return path;
}

// ---- What a removal may delete (App Store 5.1.1(v), review C1) -------------------------------
// Image URLs in a stored copy come from the client, so a URL is NEVER proof of ownership: user A can
// publish a site that points at user B's public photos, then remove their own site. Deletion is
// therefore scoped to places the SERVER binds to this purchase, never to "whatever the copy says":
//   1. everything under `<slug>/`          (the site's own upload folder; the slug is bound to the
//                                           Apple-verified purchase and is what the removal is keyed by).
//                                           NEVER for a reserved slug (ios-drafts, ab-products, ... or a
//                                           UUID-shaped draft folder): that folder is shared/anonymous, so
//                                           the site goes offline but the folder is left alone. Objects
//                                           whose recorded owner (metadata siteId) names another site are
//                                           skipped too.
//   2. everything under `ab-products/<shop id>/`  (the shop row linked to this purchase, from the DB)
//   3. individual `ios-drafts/<draftId>/<file>` photos the stored copy (or its history) uses, ONLY when
//      no other site's stored copy references the same object. A draft folder is anonymous, so this is
//      a best-effort check, not proof; anything else (another site's folder, shared stock photos,
//      foreign hosts, bare `<draftId>/` folders) is left alone. Orphans are for a bucket lifecycle rule.
// Every key is re-validated against this allow-list immediately before it is deleted.

const DRAFT_FILE = /^ios-drafts\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_-]{0,150}\.[A-Za-z0-9]{2,5})$/;
// A logo lives one level deeper: ios-drafts/<draftId>/logo/<file>.(png|jpg|jpeg). Same ownership posture as a draft photo.
const DRAFT_LOGO = /^ios-drafts\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})\/logo\/([A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(?:png|jpe?g))$/i;
const isDraftObject = (p: string): boolean => DRAFT_FILE.test(p) || DRAFT_LOGO.test(p);

/** The prefixes whose objects belong to this purchase; empty when the slug is unusable. */
export function ownedPrefixes(slug: string, shopId?: string | null): string[] {
  const out: string[] = [];
  if (/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) && !isReservedSlug(slug)) out.push(`${slug}/`);
  if (typeof shopId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(shopId)) out.push(`ab-products/${shopId}/`);
  return out;
}

/** True when `key` is a safe object key under one of the allowed prefixes. */
export function underOwnedPrefix(key: string, prefixes: readonly string[]): boolean {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('//')) return false;
  if (/^(pending-sites|pending-sites-history|admin-republish-runs)(\/|$)/.test(key)) return false;
  // Never a whole shared top-level folder or a draft-UUID folder, whatever the prefix list says.
  const safePrefixes = prefixes.filter((p) => p.startsWith('ab-products/') ? p.split('/').length === 3 : !isReservedSlug(p.slice(0, -1)));
  return safePrefixes.some((p) => p.endsWith('/') && key.startsWith(p) && key.length > p.length);
}

/** Draft photos from the copy's URLs that no other site references (the only URL-derived deletions). */
export function draftPhotosToDelete(urls: Iterable<unknown>, bucketName: string, referencedElsewhere: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    const p = ourObjectPath(u, bucketName);
    if (p && isDraftObject(p) && !referencedElsewhere.has(p)) out.add(p);
  }
  return [...out];
}

const urlsOf = (pending: any): unknown[] => {
  const out: unknown[] = pending?.imageUrlMap && typeof pending.imageUrlMap === 'object' ? Object.values(pending.imageUrlMap) : [];
  const inline = pending?.siteData?.logo?.url; // an inline logo URL (admin-set or not yet marker-ised) is as much a reference as the map's
  if (typeof inline === 'string') out.push(inline);
  return out;
};

/** Object paths every OTHER site's stored copy points at. Throws when a copy cannot be read (fail closed). */
async function pathsReferencedByOthers(b: ReturnType<typeof bucket>, ownSlug: string): Promise<Set<string>> {
  const [files] = await b.getFiles({ prefix: 'pending-sites/' });
  const refs = new Set<string>();
  const others = files.filter((f: any) => f.name !== `pending-sites/${ownSlug}.json` && f.name.endsWith('.json'));
  for (let i = 0; i < others.length; i += 16) {
    await Promise.all(others.slice(i, i + 16).map(async (f: any) => {
      const [buf] = await f.download();
      let parsed: any;
      try { parsed = JSON.parse(buf.toString('utf-8')); } catch { return; } // unreadable JSON cannot reference anything
      for (const u of urlsOf(parsed?.data ?? parsed)) {
        const p = ourObjectPath(u, b.name);
        if (p) refs.add(p);
      }
    }));
  }
  return refs;
}


export function liveRemoveDeps(): RemoveSiteDeps {
  const purchases = supabasePurchases();
  return {
    now: () => Date.now(),
    markRemoved: (otid, at) => purchases.markRemoved(otid, at),
    markTakenDown: (otid, at) => purchases.markTakenDown(otid, at),
    async deployOffline(slug) {
      // Same page and same manage/order-link rule as the lapse sweep (api/ios/sweep.ts).
      const shop = await findShopForSite(slug);
      await deployRenderedSite({ siteId: slug, html: offlineHtml(), subpages: shop ? { mode: 'manage-only' } : null });
    },
    async releaseDomains(slug) {
      await releaseDomainsForRemoval(slug, { repo: supabaseDomains(), vercel: liveVercelDomains(), now: () => Date.now() });
    },
    async deleteContent(slug) {
      const b = bucket();
      const safe = slugify(slug);
      const shop = await findShopForSite(safe); // DB-bound to this purchase, never client supplied
      // Fail closed: a slug that is not already canonical is not the recorded one; delete no folder for it.
      const prefixes = ownedPrefixes(safe === slug ? safe : '', shop?.id);
      const del = async (key: string) => {
        if (!underOwnedPrefix(key, prefixes) && !isDraftObject(key)) return; // last lock
        await b.file(key).delete({ ignoreNotFound: true });
      };

      // 1. Draft photos named by the stored copy and its history (read BEFORE they are deleted, so a
      //    retry after a failure still finds the list). Only never-shared ios-drafts objects.
      const urls: unknown[] = urlsOf(await readPendingSite(safe));
      const [history] = await b.getFiles({ prefix: `pending-sites-history/${safe}/` });
      for (const f of history) {
        try {
          const [buf] = await f.download();
          const parsed = JSON.parse(buf.toString('utf-8'));
          urls.push(...urlsOf(parsed?.data ?? parsed));
        } catch { /* an unreadable snapshot just has no list */ }
      }
      const candidates = draftPhotosToDelete(urls, b.name, new Set());
      if (candidates.length) {
        const elsewhere = await pathsReferencedByOthers(b, safe);
        for (const key of draftPhotosToDelete(candidates.map((k) => `https://storage.googleapis.com/${b.name}/${k}`), b.name, elsewhere)) await del(key);
      }

      // 2. The purchase's own folders, whole.
      for (const prefix of prefixes) {
        const [objs] = await b.getFiles({ prefix });
        for (const o of objs) {
          // An object stamped with a different owner is never ours, whatever folder it sits in.
          const owner = (o as any).metadata?.metadata?.siteId;
          if (typeof owner === 'string' && owner && owner !== safe && !prefix.startsWith('ab-products/')) continue;
          await del(o.name);
        }
      }

      // 3. History, then the copy itself last (so a failure above is retried with the list intact).
      for (const f of history) await f.delete({ ignoreNotFound: true });
      await b.file(`pending-sites/${safe}.json`).delete({ ignoreNotFound: true });
    },
  };
}

/** The ids of `sites` rows whose live URL is this slug's site (`https://<slug>.<host>`), never any other. */
export function siteRowIdsForSlug(rows: Array<{ id: unknown; deployed_url?: unknown }>, slug: string): string[] {
  const want = slug.toLowerCase();
  const ids: string[] = [];
  for (const r of rows) {
    if (typeof r.id !== 'string' || typeof r.deployed_url !== 'string') continue;
    const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#:]+)/i.exec(r.deployed_url.trim());
    const host = m ? m[1].toLowerCase() : '';
    if (host && host.split('.')[0] === want) ids.push(r.id);
  }
  return ids;
}

/** Deletes the owner's `sites` rows for a removed slug (take-offline), so the app cannot reload the site. */
export async function liveDeleteAccountRows(userId: string, slug: string): Promise<void> {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase configuration');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.from('sites').select('id, deployed_url').eq('user_id', userId);
  if (error) throw new Error(error.message);
  const ids = siteRowIdsForSlug(data ?? [], slug);
  if (!ids.length) return;
  const del = await admin.from('sites').delete().eq('user_id', userId).in('id', ids);
  if (del.error) throw new Error(del.error.message);
}
