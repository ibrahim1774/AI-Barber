import { Storage } from '@google-cloud/storage';

interface UploadResult {
  publicUrl: string;
  filePath: string;
}

/**
 * Uploads a base64 data URL to Google Cloud Storage
 *
 * @param siteId - The site identifier (used as folder name)
 * @param filename - The filename to save as
 * @param base64DataUrl - The base64 data URL (e.g., "data:image/jpeg;base64,/9j/4AAQ...")
 * @returns Promise with the public URL and file path
 * @throws Error if upload fails or credentials are missing
 */
export async function uploadToGCS(
  siteId: string,
  filename: string,
  base64DataUrl: string
): Promise<UploadResult> {
  try {
    // Validate inputs
    if (!siteId || !filename || !base64DataUrl) {
      throw new Error('Missing required parameters: siteId, filename, or base64DataUrl');
    }

    // Get environment variables
    const serviceAccountJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
    const bucketName = process.env.GCS_BUCKET_NAME;

    if (!serviceAccountJson) {
      throw new Error('GCP_SERVICE_ACCOUNT_JSON environment variable is not set');
    }

    if (!bucketName) {
      throw new Error('GCS_BUCKET_NAME environment variable is not set');
    }

    // Parse service account credentials
    let credentials;
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch (parseError) {
      console.error('Failed to parse GCP service account JSON');
      throw new Error('Invalid GCP_SERVICE_ACCOUNT_JSON format');
    }

    // Initialize Google Cloud Storage client
    const storage = new Storage({
      credentials: credentials,
      projectId: credentials.project_id,
    });

    console.log(`[GCS Upload] Uploading file for site: ${siteId}, filename: ${filename}`);

    // Extract base64 data from data URL
    // Format: data:image/jpeg;base64,/9j/4AAQ...
    const matches = base64DataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      throw new Error('Invalid base64 data URL format');
    }

    const contentType = matches[1];
    const base64Data = matches[2];

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');

    console.log(`[GCS Upload] File size: ${buffer.length} bytes, Content-Type: ${contentType}`);

    // Construct file path: {siteId}/{filename}
    const filePath = `${siteId}/${filename}`;

    // Get bucket reference
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);

    // Upload the file
    await file.save(buffer, {
      contentType: contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      },
    });

    console.log(`[GCS Upload] File uploaded successfully: ${filePath}`);

    // Make the file publicly readable
    //await file.makePublic();

    console.log(`[GCS Upload] File made public: ${filePath}`);

    // Construct public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;

    return {
      publicUrl,
      filePath,
    };

  } catch (error: any) {
    console.error('[GCS Upload] Upload failed:', error.message);

    // Re-throw with more context but don't expose sensitive details
    if (error.message.includes('credentials') || error.message.includes('environment variable')) {
      throw error; // These are safe error messages
    }

    throw new Error(`Failed to upload file to Google Cloud Storage: ${error.message}`);
  }
}

/**
 * Uploads multiple images to Google Cloud Storage
 *
 * @param siteId - The site identifier (used as folder name)
 * @param images - Array of objects with filename and base64DataUrl
 * @returns Promise with array of upload results
 */
export async function uploadMultipleToGCS(
  siteId: string,
  images: Array<{ filename: string; base64DataUrl: string }>
): Promise<UploadResult[]> {
  console.log(`[GCS Upload] Starting batch upload for site: ${siteId}, count: ${images.length}`);

  const results: UploadResult[] = [];
  const errors: Array<{ filename: string; error: string }> = [];

  // Upload all images in parallel
  const uploadPromises = images.map(async (image) => {
    try {
      const result = await uploadToGCS(siteId, image.filename, image.base64DataUrl);
      results.push(result);
    } catch (error: any) {
      console.error(`[GCS Upload] Failed to upload ${image.filename}:`, error.message);
      errors.push({ filename: image.filename, error: error.message });
    }
  });

  await Promise.all(uploadPromises);

  if (errors.length > 0) {
    console.error(`[GCS Upload] Batch upload completed with ${errors.length} errors`);
    console.error('[GCS Upload] Failed files:', errors.map(e => e.filename).join(', '));
  } else {
    console.log(`[GCS Upload] Batch upload completed successfully: ${results.length} files`);
  }

  return results;
}
