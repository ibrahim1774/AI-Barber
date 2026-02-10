import { Storage } from '@google-cloud/storage';
import axios from 'axios';

interface DeploymentRequest {
  siteId: string;
  html: string;
  css?: string;
  images?: Array<{
    key: string;
    filename: string;
    base64: string;
  }>;
  imageUrls?: Record<string, string>;
}

interface VercelFile {
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
  // Prefer the production alias (clean subdomain like project-name.vercel.app)
  // over the hash-based unique deployment URL
  let deploymentUrl = (data.alias?.length > 0) ? `https://${data.alias[0]}` :
    (data.url ? `https://${data.url}` : data.inspectorUrl || 'Unknown');

  console.log(`[Vercel Deploy] Success: ${deploymentUrl}`);

  // Disable Vercel Authentication so deployed sites are publicly accessible
  try {
    await axios.patch(
      `https://api.vercel.com/v9/projects/${sanitizedProjectName}`,
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
    console.log(`[Vercel Deploy] Disabled deployment protection for ${sanitizedProjectName}`);
  } catch (e: any) {
    console.warn('[Vercel Deploy] Could not disable deployment protection:', e.message);
  }

  return { deploymentUrl, inspectorUrl: data.inspectorUrl, deploymentId: data.id };
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body: DeploymentRequest = req.body;

    if (!body.siteId) {
      return res.status(400).json({ ok: false, error: 'Missing required field: siteId' });
    }
    if (!body.html) {
      return res.status(400).json({ ok: false, error: 'Missing required field: html' });
    }

    console.log(`[Deploy Site] Starting deployment for siteId: ${body.siteId}`);

    // Step 1: Handle image URLs (either from client-side upload or server-side upload)
    let imageUrlMap: Record<string, string> = {};
    const uploadedImages: Record<string, string> = {};

    if (body.imageUrls && Object.keys(body.imageUrls).length > 0) {
      console.log(`[Deploy Site] Using ${Object.keys(body.imageUrls).length} pre-uploaded image URLs`);
      imageUrlMap = body.imageUrls;
      Object.assign(uploadedImages, body.imageUrls);
    } else if (body.images && body.images.length > 0) {
      console.log(`[Deploy Site] Uploading ${body.images.length} images to GCS (server-side)...`);
      const uploadErrors: Array<{ key: string; error: string }> = [];

      for (const image of body.images) {
        if (!image.key || !image.filename || !image.base64) {
          console.warn(`[Deploy Site] Skipping invalid image: missing key, filename, or base64 data`);
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

          const result = await uploadToGCS(body.siteId, image.filename, base64DataUrl);
          imageUrlMap[image.key] = result.publicUrl;
          uploadedImages[image.key] = result.publicUrl;
          console.log(`[Deploy Site] Uploaded ${image.key} -> ${result.publicUrl}`);
        } catch (uploadError: any) {
          console.error(`[Deploy Site] Failed to upload ${image.key}:`, uploadError.message);
          uploadErrors.push({ key: image.key, error: uploadError.message });
        }
      }

      const successCount = Object.keys(uploadedImages).length;
      const failCount = uploadErrors.length;
      console.log(`[Deploy Site] Image upload: ${successCount} succeeded, ${failCount} failed`);

      if (failCount > 0 && successCount === 0) {
        console.warn('[Deploy Site] Warning: All image uploads failed. Deployment will proceed with placeholder URLs.');
      }
    } else {
      console.log('[Deploy Site] No images to process');
    }

    // Step 2: Replace placeholders in HTML with actual URLs
    let processedHtml = body.html;
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

    // Step 3: Prepare CSS file (blank if not provided)
    const cssContent = body.css || `/* No custom styles */`;

    // Step 4: Validate that HTML doesn't contain base64 images (should only have GCS URLs)
    const base64ImagePattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g;
    const base64Matches = processedHtml.match(base64ImagePattern);
    if (base64Matches && base64Matches.length > 0) {
      console.warn(`[Deploy Site] Warning: Found ${base64Matches.length} base64 images in HTML. These should be replaced with GCS URLs.`);
      processedHtml = processedHtml.replace(base64ImagePattern, '');
    }

    // Step 5: Prepare files for Vercel deployment (ONLY HTML and CSS, NO images)
    const htmlBuffer = Buffer.from(processedHtml, 'utf-8');
    const cssBuffer = Buffer.from(cssContent, 'utf-8');

    const files: VercelFile[] = [
      { file: 'index.html', data: htmlBuffer.toString('base64'), encoding: 'base64' },
      { file: 'styles.css', data: cssBuffer.toString('base64'), encoding: 'base64' }
    ];

    const totalSize = htmlBuffer.length + cssBuffer.length;
    const totalSizeMB = totalSize / (1024 * 1024);
    console.log(`[Deploy Site] Deployment payload size: ${totalSizeMB.toFixed(2)} MB (HTML: ${(htmlBuffer.length / 1024).toFixed(2)} KB, CSS: ${(cssBuffer.length / 1024).toFixed(2)} KB)`);

    if (totalSizeMB > 4.5) {
      console.warn(`[Deploy Site] Warning: Payload size (${totalSizeMB.toFixed(2)} MB) exceeds Vercel's recommended limit of 4.5 MB`);
    }

    console.log('[Deploy Site] Deploying to Vercel...');

    // Step 6: Deploy to Vercel (only lightweight HTML/CSS files)
    const vercelResult = await deployToVercel(body.siteId, files);

    console.log(`[Deploy Site] Deployment successful: ${vercelResult.deploymentUrl}`);

    // Step 7: Return success response
    return res.status(200).json({
      ok: true,
      deploymentUrl: vercelResult.deploymentUrl,
      uploadedImages: uploadedImages,
      stripeLink: process.env.STRIPE_PAYMENT_LINK || null
    });

  } catch (error: any) {
    console.error('[Deploy Site] Deployment failed:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Deployment failed',
      details: error.message
    });
  }
}
