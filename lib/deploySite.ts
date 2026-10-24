// Deploying a rendered site to Vercel — the shared core.
//
// This used to live entirely inside api/deploy-site.ts, reachable only over
// HTTP. That was fine while the browser was the only caller, but the Stripe
// webhook needs it too, and a webhook that self-calls an HTTP endpoint pays a
// second cold start, gets a second timeout budget it cannot observe, and can
// return 200 to Stripe while the publish quietly dies — killing the retry that
// would have saved the customer.
//
// So the work lives here as a plain function. api/deploy-site.ts is now a thin
// HTTP wrapper over it (unchanged contract), and lib/publishSite.ts calls it
// directly.
import { Storage } from '@google-cloud/storage';
import axios from 'axios';
import { siteConfigFile, siteVercelConfig, SITE_CONFIG_FILE, type SiteSubpages } from './siteSubpages.js';
import { stripMarkersText } from './render/markers.js';
import { assertSiteFilePath, type SiteFile } from './render/pages.js';

export type { SiteFile };

export interface DeployImage {
  key: string;
  filename: string;
  base64: string;
}

export interface DeployRenderedSiteInput {
  siteId: string;
  /** The home page. With `pages` it must be the same as pages' index.html (kept for old callers). */
  html: string;
  /**
   * A multi-page site (lib/render/site.ts): every page of the deploy, `index.html` first. Absent:
   * the single page `html`, exactly what a deploy always was (the browser path, api/deploy-site.ts).
   */
  pages?: SiteFile[];
  /** sitemap.xml for a multi-page deploy; null or absent: none is shipped on this publish. */
  sitemap?: string | null;
  css?: string;
  /** Already-uploaded image URLs, keyed the same as the {{placeholders}}. */
  imageUrls?: Record<string, string>;
  /** Raw images to upload server-side first. Used by the legacy browser path. */
  images?: DeployImage[];
  /**
   * The site's /book and /shop pages (lib/siteSubpages.ts): only for a site with a shop. Absent
   * or null: the deploy is exactly what it always was.
   */
  subpages?: SiteSubpages | null;
}

export interface DeployRenderedSiteResult {
  deploymentUrl: string;
  uploadedImages: Record<string, string>;
  /** The Vercel project the deploy landed in (for its domains). */
  projectName?: string;
}

export interface VercelFile {
  file: string;
  data: string;
  encoding?: 'base64' | 'utf-8';
}
// Inlined from src/lib/gcsUpload.ts (Vercel serverless can't resolve ../src/lib imports)
async function uploadToGCS(siteId: string, filename: string, base64DataUrl: string) {
  const serviceAccountJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
  const bucketName = process.env.GCS_BUCKET_NAME;

  if (!serviceAccountJson) throw new Error('GCP_SERVICE_ACCOUNT_JSON environment variable is not set');
  if (!bucketName) throw new Error('GCS_BUCKET_NAME environment variable is not set');

  const credentials = JSON.parse(serviceAccountJson);
  const storage = new Storage({ credentials, projectId: credentials.project_id });

  const matches = base64DataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) throw new Error('Invalid base64 data URL format');

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const filePath = `${siteId}/${filename}`;

  const bucket = storage.bucket(bucketName);
  const file = bucket.file(filePath);

  await file.save(buffer, {
    contentType,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });

  const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;
  return { publicUrl, filePath };
}
// Inlined from src/lib/vercelDeploy.ts (Vercel serverless can't resolve ../src/lib imports)
async function deployToVercel(projectName: string, files: VercelFile[]) {
  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) throw new Error('VERCEL_TOKEN environment variable is not set');

  // Always use the siteId (derived from shop name) as the project name
  // so each customer site gets its own Vercel project and clean subdomain
  const finalProjectName = projectName;
  const sanitizedProjectName = finalProjectName
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  console.log(`[Vercel Deploy] Deploying project: ${sanitizedProjectName}, files: ${files.map(f => f.file).join(', ')}`);

  const response = await axios.post(
    'https://api.vercel.com/v13/deployments',
    {
      name: sanitizedProjectName,
      files,
      target: 'production',
      projectSettings: { framework: null },
    },
    {
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        'Content-Type': 'application/json',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
    }
  );

  const data = response.data;
  const actualProjectName = (data.name as string | undefined) || sanitizedProjectName;
  // Pick what Vercel actually attached to this project — data.alias[]
  // is the authoritative list. Sort by length and take the shortest
  // alias that mentions our project name. That naturally selects the
  // clean team-scoped form (`ada-pearl-phi.vercel.app`) over the
  // per-deployment URL when both are returned.
  //
  // Constructing `${actualProjectName}.vercel.app` directly is unsafe:
  // for short / common project names ("ada", "joe") that URL lives in
  // Vercel's public namespace and is owned by some unrelated user, so
  // it 404s or sends customers to the wrong site. The alias list is
  // the only source of truth for URLs that actually resolve to THIS
  // project.
  const aliases: string[] = Array.isArray(data?.alias) ? data.alias : [];
  const matchingAliases = aliases
    .filter((a) => typeof a === 'string' && a.toLowerCase().includes(actualProjectName.toLowerCase()))
    .sort((a, b) => a.length - b.length);
  const deploymentUrl = matchingAliases[0]
    ? `https://${matchingAliases[0]}`
    : `https://${actualProjectName}.vercel.app`;

  console.log(`[Vercel Deploy] Success: ${deploymentUrl} (requested slug: ${sanitizedProjectName}, actual project: ${actualProjectName})`);

  // Disable Vercel Authentication so deployed sites are publicly accessible
  try {
    await axios.patch(
      `https://api.vercel.com/v9/projects/${actualProjectName}`,
      {
        passwordProtection: null,
        vercelAuthentication: null,
      },
      {
        headers: {
          Authorization: `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`[Vercel Deploy] Disabled deployment protection for ${actualProjectName}`);
  } catch (e: any) {
    console.warn('[Vercel Deploy] Could not disable deployment protection:', e.message);
  }

  return { deploymentUrl, inspectorUrl: data.inspectorUrl, deploymentId: data.id, actualProjectName };
}
// Re-resolve the cleanest public URL AFTER the deployment is READY.
// The alias[] returned by the deploy-creation POST is incomplete — the
// clean project alias (e.g. `trapp-cutz.vercel.app`) is attached a
// moment later, so at creation time the shortest available is the
// team-scoped form (`trapp-cutz-client-sites-xxxx.vercel.app`) or the
// per-deploy hash URL. Once READY, the deployment's alias[] is fully
// populated; pick the shortest alias that mentions this project so we
// store + show the clean short URL in the dashboard / admin screen.
// Returns null if nothing better is found (caller keeps its fallback).
async function resolveBestAlias(
  deploymentId: string,
  vercelToken: string,
  projectName: string
): Promise<string | null> {
  try {
    const resp = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { alias?: unknown };
    const aliases: string[] = Array.isArray(data?.alias) ? (data.alias as string[]) : [];
    const matching = aliases
      .filter((a) => typeof a === 'string' && a.toLowerCase().includes(projectName.toLowerCase()))
      .sort((a, b) => a.length - b.length);
    return matching[0] ? `https://${matching[0]}` : null;
  } catch (e: any) {
    console.warn('[Vercel Deploy] resolveBestAlias failed (keeping fallback):', e?.message || e);
    return null;
  }
}
// Poll the Vercel deployment until its readyState is READY (or we
// time out). Without this, "Publish" was returning the moment Vercel
// accepted the deploy — but the alias was still pointing at the old
// production deployment for another 5-15s. Users would click the URL
// and see stale content.
async function waitForDeploymentReady(deploymentId: string, vercelToken: string, maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  const pollInterval = 1500;
  while (Date.now() - start < maxWaitMs) {
    let terminal: string | null = null;
    try {
      const resp = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      });
      if (resp.ok) {
        const data = await resp.json() as { readyState?: string };
        if (data.readyState === 'READY') return;
        if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
          terminal = data.readyState.toLowerCase();
        }
      }
    } catch (e: any) {
      // Transient network errors — keep polling until timeout.
      console.warn('[Deploy Poll] transient:', e?.message || e);
    }
    // Surface real Vercel deployment failure to the caller — was
    // previously swallowed by the same catch as transient network
    // errors, so a customer's Vercel-side build failure looked
    // identical to a network blip.
    if (terminal) {
      throw new Error(`Vercel deployment ${terminal}`);
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  console.warn(`[Deploy Poll] Timed out after ${maxWaitMs}ms — proceeding anyway`);
}
// Upload any raw images, swap {{placeholders}} for real URLs, ship HTML+CSS to
// Vercel, and wait until the deployment is actually READY before returning —
// otherwise the caller hands the customer a URL still serving the old build.
// Swap each {{key}} placeholder (they sit inside src="…" attributes) for
// its image URL, escaped so a URL can never break out of the attribute,
// and inserted literally (a replacer function, so "$&" in a URL is not a
// replacement pattern).
export function swapImagePlaceholders(html: string, imageUrlMap: Record<string, string>): string {
  const escapeAttr = (v: string): string =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let out = html;
  for (const [key, url] of Object.entries(imageUrlMap || {})) {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
    const safe = escapeAttr(String(url ?? ''));
    out = out.replace(regex, () => safe);
  }
  return out;
}

/**
 * The pages of a deploy, ready to write: placeholders swapped for the image URLs on EVERY page, and
 * any base64 image that slipped through removed (they belong in GCS and blow the payload limit).
 */
export function finalizePages(pages: SiteFile[], imageUrlMap: Record<string, string>): SiteFile[] {
  const base64ImagePattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g;
  return pages.map((p) => {
    // Last guard: no editor marker (markers.ts) in any shipped page, whatever rendered it.
    let html = stripMarkersText(swapImagePlaceholders(p.html, imageUrlMap));
    const left = html.match(/\{\{[^}]+\}\}/g);
    if (left && left.length > 0) console.warn(`[Deploy Site] Warning: ${left.length} placeholders not replaced on ${p.path}:`, left);
    const b64 = html.match(base64ImagePattern);
    if (b64 && b64.length > 0) {
      console.warn(`[Deploy Site] Warning: Found ${b64.length} base64 images in ${p.path}. These should be replaced with GCS URLs.`);
      html = html.replace(base64ImagePattern, '');
    }
    return { path: p.path, html };
  });
}

/**
 * The deployment's files: every page (`index.html`, `<page>/index.html`, `<group>/<slug>/index.html`),
 * its CSS, vercel.json (Cache-Control headers, plus the closed /book and /shop rewrite list for a site
 * with a shop), /ab-site.json (which shop the pages are) and, when given, sitemap.xml.
 *
 * Every path is checked here, at the layer that writes files: exactly one index.html, no duplicates,
 * segments of [a-z0-9-], and no reserved top segment (a book/index.html would sit ahead of the /book
 * proxy rewrite).
 */
export function buildSiteFiles(
  pages: SiteFile[],
  css: string | undefined,
  subpages: SiteSubpages | null,
  extra: { sitemap?: string | null } = {},
): VercelFile[] {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error('a deploy needs at least the home page');
  const seen = new Set<string>();
  for (const p of pages) {
    assertSiteFilePath(p?.path);
    if (seen.has(p.path)) throw new Error(`duplicate site file: ${p.path}`);
    seen.add(p.path);
  }
  if (!seen.has('index.html')) throw new Error('a deploy needs an index.html');
  const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
  const home = pages.find((p) => p.path === 'index.html') as SiteFile;
  const files: VercelFile[] = [
    { file: 'index.html', data: b64(home.html), encoding: 'base64' },
    ...pages.filter((p) => p !== home).map((p): VercelFile => ({ file: p.path, data: b64(p.html), encoding: 'base64' })),
    { file: 'styles.css', data: b64(css || '/* No custom styles */'), encoding: 'base64' },
    { file: 'vercel.json', data: b64(JSON.stringify(siteVercelConfig(subpages, { nestedPages: pages.length > 1 }))), encoding: 'base64' },
  ];
  if (subpages?.mode === 'full') {
    files.push({ file: SITE_CONFIG_FILE.replace(/^\//, ''), data: b64(siteConfigFile(subpages.shopSlug)), encoding: 'base64' });
  }
  if (typeof extra.sitemap === 'string' && extra.sitemap) files.push({ file: 'sitemap.xml', data: b64(stripMarkersText(extra.sitemap)), encoding: 'base64' });
  return files;
}

export async function deployRenderedSite(
  input: DeployRenderedSiteInput,
): Promise<DeployRenderedSiteResult> {
  const { siteId, html } = input;
  if (!siteId) throw new Error('Missing required field: siteId');
  const inputPages: SiteFile[] = input.pages && input.pages.length > 0 ? input.pages : [{ path: 'index.html', html }];
  if (!html && !(input.pages && input.pages.length > 0)) throw new Error('Missing required field: html');

  console.log(`[Deploy Site] Starting deployment for siteId: ${siteId}`);

  // Step 1: resolve image URLs — pre-uploaded by the client, or uploaded here.
  let imageUrlMap: Record<string, string> = {};
  const uploadedImages: Record<string, string> = {};

  if (input.imageUrls && Object.keys(input.imageUrls).length > 0) {
    console.log(`[Deploy Site] Using ${Object.keys(input.imageUrls).length} pre-uploaded image URLs`);
    imageUrlMap = { ...input.imageUrls };
    Object.assign(uploadedImages, input.imageUrls);
  } else if (input.images && input.images.length > 0) {
    console.log(`[Deploy Site] Uploading ${input.images.length} images to GCS (server-side)...`);
    const uploadErrors: Array<{ key: string; error: string }> = [];

    for (const image of input.images) {
      if (!image.key || !image.filename || !image.base64) {
        console.warn('[Deploy Site] Skipping invalid image: missing key, filename, or base64 data');
        uploadErrors.push({ key: image.key || 'unknown', error: 'Missing required fields' });
        continue;
      }
      try {
        let base64DataUrl = image.base64;
        if (!base64DataUrl.startsWith('data:')) {
          const extension = image.filename.split('.').pop()?.toLowerCase();
          const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
          base64DataUrl = `data:${mimeType};base64,${image.base64}`;
        }
        const result = await uploadToGCS(siteId, image.filename, base64DataUrl);
        imageUrlMap[image.key] = result.publicUrl;
        uploadedImages[image.key] = result.publicUrl;
        console.log(`[Deploy Site] Uploaded ${image.key} -> ${result.publicUrl}`);
      } catch (uploadError: any) {
        console.error(`[Deploy Site] Failed to upload ${image.key}:`, uploadError.message);
        uploadErrors.push({ key: image.key, error: uploadError.message });
      }
    }

    const successCount = Object.keys(uploadedImages).length;
    console.log(`[Deploy Site] Image upload: ${successCount} succeeded, ${uploadErrors.length} failed`);
    if (uploadErrors.length > 0 && successCount === 0) {
      console.warn('[Deploy Site] Warning: All image uploads failed. Deployment will proceed with placeholder URLs.');
    }
  } else {
    console.log('[Deploy Site] No images to process');
  }

  // Step 2: swap {{key}} placeholders for the resolved URLs on every page, and strip any base64
  // images that slipped through (they belong in GCS, and they blow the deployment payload limit).
  const finalPages = finalizePages(inputPages, imageUrlMap);
  const cssContent = input.css || '/* No custom styles */';

  // Step 5: build the file set. Cache-Control on the HTML so a republish is
  // visible immediately instead of being served stale from the CDN.
  const files = buildSiteFiles(finalPages, cssContent, input.subpages ?? null, { sitemap: input.sitemap });
  const htmlBytes = finalPages.reduce((n, p) => n + Buffer.byteLength(p.html, 'utf-8'), 0);
  const cssBuffer = Buffer.from(cssContent, 'utf-8');

  const totalSizeMB = (htmlBytes + cssBuffer.length) / (1024 * 1024);
  console.log(`[Deploy Site] Deployment payload size: ${totalSizeMB.toFixed(2)} MB (${finalPages.length} page${finalPages.length === 1 ? '' : 's'}, HTML: ${(htmlBytes / 1024).toFixed(2)} KB, CSS: ${(cssBuffer.length / 1024).toFixed(2)} KB)`);
  if (totalSizeMB > 4.5) {
    console.warn(`[Deploy Site] Warning: Payload size (${totalSizeMB.toFixed(2)} MB) exceeds Vercel's recommended limit of 4.5 MB`);
  }

  // Step 6: deploy, then wait for READY and re-resolve the clean alias.
  console.log('[Deploy Site] Deploying to Vercel...');
  const vercelResult = await deployToVercel(siteId, files);
  console.log(`[Deploy Site] Deployment created: ${vercelResult.deploymentUrl}, waiting for READY...`);

  let finalUrl = vercelResult.deploymentUrl;
  if (process.env.VERCEL_TOKEN) {
    await waitForDeploymentReady(vercelResult.deploymentId, process.env.VERCEL_TOKEN);
    const best = await resolveBestAlias(
      vercelResult.deploymentId,
      process.env.VERCEL_TOKEN,
      vercelResult.actualProjectName,
    );
    if (best) finalUrl = best;
  }

  console.log(`[Deploy Site] Deployment ready: ${finalUrl}`);
  return { deploymentUrl: finalUrl, uploadedImages, projectName: vercelResult.actualProjectName };
}
