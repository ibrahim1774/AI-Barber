import { uploadToGCS } from '../src/lib/gcsUpload';
import { deployToVercel } from '../src/lib/vercelDeploy';

interface DeploymentRequest {
  siteId: string;
  html: string;
  css?: string;
  images?: Array<{
    key: string;
    filename: string;
    base64: string;
  }>;
  imageUrls?: Record<string, string>; // Map of image keys to public URLs
}

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust this in production if needed
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
  }

  try {
    const body: DeploymentRequest = req.body;

    // Validate required inputs
    if (!body.siteId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required field: siteId'
      });
    }

    if (!body.html) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required field: html'
      });
    }

    console.log(`[Deploy Site] Starting deployment for siteId: ${body.siteId}`);

    // Step 1: Handle image URLs (either from client-side upload or server-side upload)
    let imageUrlMap: Record<string, string> = {};
    const uploadedImages: Record<string, string> = {};

    if (body.imageUrls && Object.keys(body.imageUrls).length > 0) {
      // Images were already uploaded client-side, use provided URLs
      // Note: Files are already public due to bucket configuration (allUsers access)
      console.log(`[Deploy Site] Using ${Object.keys(body.imageUrls).length} pre-uploaded image URLs`);

      imageUrlMap = body.imageUrls;
      Object.assign(uploadedImages, body.imageUrls);
    } else if (body.images && body.images.length > 0) {
      // Fallback: Upload images server-side (for backward compatibility)
      console.log(`[Deploy Site] Uploading ${body.images.length} images to GCS (server-side)...`);
      const uploadErrors: Array<{ key: string; error: string }> = [];

      // Upload images sequentially to avoid overwhelming GCS
      for (const image of body.images) {
        if (!image.key || !image.filename || !image.base64) {
          console.warn(`[Deploy Site] Skipping invalid image: missing key, filename, or base64 data`);
          uploadErrors.push({ key: image.key || 'unknown', error: 'Missing required fields' });
          continue;
        }

        try {
          // Convert base64 to data URL format if not already
          let base64DataUrl = image.base64;
          if (!base64DataUrl.startsWith('data:')) {
            // Assume it's a JPEG if no MIME type provided
            const extension = image.filename.split('.').pop()?.toLowerCase();
            const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
            base64DataUrl = `data:${mimeType};base64,${image.base64}`;
          }

          // Extract base64 data length for logging
          const base64Data = base64DataUrl.split(',')[1] || '';
          const estimatedSizeKB = (base64Data.length * 3) / 4 / 1024;
          console.log(`[Deploy Site] Uploading ${image.key} (${image.filename}, ~${estimatedSizeKB.toFixed(2)} KB)...`);

          const result = await uploadToGCS(
            body.siteId,
            image.filename,
            base64DataUrl
          );

          imageUrlMap[image.key] = result.publicUrl;
          uploadedImages[image.key] = result.publicUrl;

          console.log(`[Deploy Site] ✓ Uploaded ${image.key} -> ${result.publicUrl}`);

        } catch (uploadError: any) {
          console.error(`[Deploy Site] ✗ Failed to upload image ${image.key}:`, uploadError.message);
          uploadErrors.push({ key: image.key, error: uploadError.message });
          // Continue with other images even if one fails
        }
      }

      const successCount = Object.keys(uploadedImages).length;
      const failCount = uploadErrors.length;
      console.log(`[Deploy Site] Image upload complete: ${successCount} succeeded, ${failCount} failed`);

      if (failCount > 0 && successCount === 0) {
        // If ALL images failed, we should still proceed but warn
        console.warn('[Deploy Site] Warning: All image uploads failed. Deployment will proceed with placeholder URLs.');
      }
    } else {
      console.log('[Deploy Site] No images to process');
    }

    // Step 2: Replace placeholders in HTML with actual URLs
    let processedHtml = body.html;

    // Replace all placeholders with GCS URLs
    for (const [key, url] of Object.entries(imageUrlMap)) {
      // Replace {{key}} with the actual URL
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
      processedHtml = processedHtml.replace(regex, url);
    }

    // Verify all placeholders were replaced (warn if any remain)
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
      // Remove base64 images to prevent deployment size issues
      processedHtml = processedHtml.replace(base64ImagePattern, '');
    }

    // Step 5: Prepare files for Vercel deployment (ONLY HTML and CSS, NO images)
    const htmlBuffer = Buffer.from(processedHtml, 'utf-8');
    const cssBuffer = Buffer.from(cssContent, 'utf-8');

    const files = [
      {
        file: 'index.html',
        data: htmlBuffer.toString('base64'),
        encoding: 'base64' as const
      },
      {
        file: 'styles.css',
        data: cssBuffer.toString('base64'),
        encoding: 'base64' as const
      }
    ];

    // Calculate total payload size
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

    // Return 500 for deployment failures
    return res.status(500).json({
      ok: false,
      error: 'Deployment failed',
      details: error.message
    });
  }
}
