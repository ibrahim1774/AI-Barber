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

export interface DeployImage {
  key: string;
  filename: string;
  base64: string;
}

export interface DeployRenderedSiteInput {
  siteId: string;
  html: string;
  css?: string;
  /** Already-uploaded image URLs, keyed the same as the {{placeholders}}. */
  imageUrls?: Record<string, string>;
  /** Raw images to upload server-side first. Used by the legacy browser path. */
  images?: DeployImage[];
}

export interface DeployRenderedSiteResult {
  deploymentUrl: string;
  uploadedImages: Record<string, string>;
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
export async function deployRenderedSite(
  input: DeployRenderedSiteInput,
): Promise<DeployRenderedSiteResult> {
  const { siteId, html } = input;
  if (!siteId) throw new Error('Missing required field: siteId');
  if (!html) throw new Error('Missing required field: html');

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

  // Step 2: swap {{key}} placeholders for the resolved URLs.
  let processedHtml = html;
  for (const [key, url] of Object.entries(imageUrlMap)) {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
    processedHtml = processedHtml.replace(regex, url);
  }

  const remainingPlaceholders = processedHtml.match(/\{\{[^}]+\}\}/g);
  if (remainingPlaceholders && remainingPlaceholders.length > 0) {
    console.warn(`[Deploy Site] Warning: ${remainingPlaceholders.length} placeholders not replaced:`, remainingPlaceholders);
  }
  console.log(`[Deploy Site] HTML placeholders replaced. Processed HTML size: ${processedHtml.length} bytes`);

  // Step 3-4: CSS, and strip any base64 images that slipped through (they
  // belong in GCS, and they blow the deployment payload limit).
  const cssContent = input.css || '/* No custom styles */';
  const base64ImagePattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g;
  const base64Matches = processedHtml.match(base64ImagePattern);
  if (base64Matches && base64Matches.length > 0) {
    console.warn(`[Deploy Site] Warning: Found ${base64Matches.length} base64 images in HTML. These should be replaced with GCS URLs.`);
    processedHtml = processedHtml.replace(base64ImagePattern, '');
  }

  // Step 5: build the file set. Cache-Control on the HTML so a republish is
  // visible immediately instead of being served stale from the CDN.
  const htmlBuffer = Buffer.from(processedHtml, 'utf-8');
  const cssBuffer = Buffer.from(cssContent, 'utf-8');
  const vercelConfig = JSON.stringify({
    headers: [
      { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
      { source: '/', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    ],
  });
  const files: VercelFile[] = [
    { file: 'index.html', data: htmlBuffer.toString('base64'), encoding: 'base64' },
    { file: 'styles.css', data: cssBuffer.toString('base64'), encoding: 'base64' },
    { file: 'vercel.json', data: Buffer.from(vercelConfig, 'utf-8').toString('base64'), encoding: 'base64' },
  ];

  const totalSizeMB = (htmlBuffer.length + cssBuffer.length) / (1024 * 1024);
  console.log(`[Deploy Site] Deployment payload size: ${totalSizeMB.toFixed(2)} MB (HTML: ${(htmlBuffer.length / 1024).toFixed(2)} KB, CSS: ${(cssBuffer.length / 1024).toFixed(2)} KB)`);
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
  return { deploymentUrl: finalUrl, uploadedImages };
}
