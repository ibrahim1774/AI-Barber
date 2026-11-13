// Re-host imported photos at publish time (authenticated web-app publish only). A site built by "Import from existing
// website" hot-links its photos from the shop's old site or a booking CDN (Booksy's cloudfront); if that account is
// suspended the photos vanish. Here each foreign http(s) image is fetched through the SSRF-guarded image fetch and copied to
// the project's GCS bucket, and the image map points at the copy.
//
// Scope: only a draft stamped importedFrom: 'website' (the importer's marker, carried on siteData through the publish
// request). Everything else is returned untouched. Never throws and never fails a publish: any problem with one image
// (fetch, type, size, upload, budget) keeps that image's original URL.
// Repeats: the object name is a hash of the source URL, so a later publish finds the copy with one exists() call and
// does not fetch the source again.
import { createHash } from 'node:crypto';
import { fetchPublicImage, MAX_IMAGE_BYTES, IMAGE_TIMEOUT_MS } from './scrapers/safeFetch.js';
import { isStockImage } from './stockImages.js';

export const REHOST_MAX_IMAGES = 30;
export const REHOST_CONCURRENCY = 5;
export const REHOST_BUDGET_MS = 25_000;
/** Host suffixes that are this product's own sites (no copy needed). */
const OWN_HOST_SUFFIXES = ['.vercel.app', 'aibarber.org', 'primebarber.org'];

export interface RehostDeps {
  fetchImage(url: string, o: { signal: AbortSignal; timeoutMs: number; maxBytes: number }): Promise<{ buffer: Buffer; contentType: string }>;
  /** True when the object (siteId/filename) already exists. */
  exists(siteId: string, filename: string): Promise<boolean>;
  /** Stores the bytes and returns the public URL. */
  upload(siteId: string, filename: string, buffer: Buffer, contentType: string): Promise<string>;
  /** Public URL of an object that exists. */
  urlOf(siteId: string, filename: string): string;
  bucketName?: string | null;
  budgetMs?: number;
}

export const rehostFilename = (url: string): string => `rehost-${createHash('sha256').update(url).digest('hex').slice(0, 32)}`;

function isOwnUrl(raw: string, bucketName?: string | null): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return true; }
  const host = u.hostname.toLowerCase();
  if (host === 'storage.googleapis.com' && (!bucketName || u.pathname.startsWith(`/${bucketName}/`))) return true;
  return OWN_HOST_SUFFIXES.some((s) => (s.startsWith('.') ? host.endsWith(s) : host === s || host.endsWith(`.${s}`)));
}

/** True when the draft says it was imported from a website. */
export const isWebsiteImport = (sd: { importedFrom?: unknown } | null | undefined): boolean => sd?.importedFrom === 'website';

export async function rehostImageMap(
  siteId: string,
  sd: { importedFrom?: unknown } | null | undefined,
  map: Record<string, string>,
  deps: RehostDeps,
): Promise<Record<string, string>> {
  if (!isWebsiteImport(sd)) return map;
  try {
    const out = { ...map };
    // One job per distinct source URL (the same photo can fill several slots).
    const sources = [...new Set(Object.values(map).filter((u) => /^https?:\/\//i.test(u) && !isStockImage(u) && !isOwnUrl(u, deps.bucketName)))].slice(0, REHOST_MAX_IMAGES);
    if (!sources.length) { console.info(`[rehost] ${siteId}: 0 copied, 0 reused, 0 kept`); return map; }
    const controller = new AbortController();
    const started = Date.now();
    const budget = deps.budgetMs ?? REHOST_BUDGET_MS;
    const timer = setTimeout(() => controller.abort(), budget);
    const hosted = new Map<string, string>();
    let reused = 0;
    const left = () => budget - (Date.now() - started);
    // Rejects when the budget ends, even if the underlying work does not stop.
    const guard = <T>(p: Promise<T>): Promise<T> => new Promise<T>((res, rej) => {
      if (controller.signal.aborted) return rej(new Error('budget'));
      const onAbort = () => rej(new Error('budget'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      p.then(res, rej).finally(() => controller.signal.removeEventListener('abort', onAbort));
    });
    const one = async (src: string) => {
      try {
        if (left() <= 0) return;
        const name = rehostFilename(src);
        if (await guard(deps.exists(siteId, name).catch(() => false))) { hosted.set(src, deps.urlOf(siteId, name)); reused++; return; }
        const img = await guard(deps.fetchImage(src, { signal: controller.signal, timeoutMs: Math.min(IMAGE_TIMEOUT_MS, Math.max(1, left())), maxBytes: MAX_IMAGE_BYTES }));
        if (img.buffer.byteLength > MAX_IMAGE_BYTES) return;
        hosted.set(src, await guard(deps.upload(siteId, name, img.buffer, img.contentType)));
      } catch (e) {
        console.warn(`[rehost] ${siteId}: keeping the original for ${src} (${(e as Error)?.message || e})`);
      }
    };
    try {
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(REHOST_CONCURRENCY, sources.length) }, async () => {
        while (next < sources.length && !controller.signal.aborted) await one(sources[next++]);
      }));
    } finally { clearTimeout(timer); controller.abort(); }
    for (const [k, v] of Object.entries(out)) if (hosted.has(v)) out[k] = hosted.get(v)!;
    // One line per publish so the platform logs show what happened (kept = fetch/upload failed, over budget or over the cap).
    console.info(`[rehost] ${siteId}: ${hosted.size - reused} copied, ${reused} reused, ${sources.length - hosted.size} kept`);
    return out;
  } catch (e) {
    console.warn(`[rehost] ${siteId}: skipped (${(e as Error)?.message || e})`);
    return map;
  }
}

/** The real dependencies: SSRF-guarded fetch, GCS upload (deploySite's uploadToGCS) and exists() on the project bucket. */
export async function realRehostDeps(): Promise<RehostDeps> {
  const { bucket } = await import('./publishSite.js');
  const { uploadToGCS } = await import('./deploySite.js');
  const bucketName = process.env.GCS_BUCKET_NAME || null;
  const urlOf = (siteId: string, filename: string) => `https://storage.googleapis.com/${bucketName}/${siteId}/${filename}`;
  return {
    bucketName,
    fetchImage: (url, o) => fetchPublicImage(url, o),
    exists: async (siteId, filename) => (await bucket().file(`${siteId}/${filename}`).exists())[0],
    upload: async (siteId, filename, buffer, contentType) =>
      (await uploadToGCS(siteId, filename, `data:${contentType};base64,${buffer.toString('base64')}`)).publicUrl,
    urlOf,
  };
}
