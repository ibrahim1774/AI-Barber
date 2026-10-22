import { Storage } from '@google-cloud/storage';
import { imageFilename, imageFolder } from '../lib/uploadTarget.js';

// Signed PUT URLs for image uploads (the iOS app): POST { siteId: folder, filenames } -> { urls }.
// Unauthenticated, and the bucket also holds the server's own JSON, so the folder and names are
// restricted to image paths (lib/uploadTarget.ts), and a name that already exists is refused
// (409): a signed URL must never overwrite a live site's image. The shipped app does not send
// an x-goog-if-generation-match header, so the URL itself cannot carry that precondition.
const MAX_FILES = 20;

// Initialize with your existing environment variables
const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
// Moved storage initialization inside handler for better error handling

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

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { siteId, filenames } = req.body || {};
    const folder = imageFolder(siteId);
    if (!folder || !Array.isArray(filenames) || filenames.length === 0 || filenames.length > MAX_FILES) {
      return res.status(400).json({ error: 'Invalid siteId or filenames' });
    }
    const names = filenames.map(imageFilename);
    if (names.some((n) => !n)) {
      return res.status(400).json({ error: 'Invalid siteId or filenames' });
    }

    if (!credentialsJson) {
      console.error('Missing Google Cloud credentials (GCP_SERVICE_ACCOUNT_JSON or GCS_CREDENTIALS)');
      return res.status(500).json({ error: 'Server configuration error: Missing Google Cloud credentials' });
    }

    let credentials;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch (e) {
      console.error('Failed to parse Google Cloud credentials:', e);
      return res.status(500).json({ error: 'Server configuration error: Invalid Google Cloud credentials format' });
    }

    const storage = new Storage({
      credentials
    });

    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      console.error('Missing GCS_BUCKET_NAME env var');
      return res.status(500).json({ error: 'Server configuration error: Missing proper bucket name configuration' });
    }

    const bucket = storage.bucket(bucketName);

    // CORS is configured on the bucket via GCP Console (service account lacks storage.buckets.update)

    // Generate a signed URL and public URL for each image
    const existing = await Promise.all(names.map(async (name) => (await bucket.file(`${folder}/${name}`).exists())[0]));
    if (existing.some(Boolean)) {
      return res.status(409).json({ error: 'File already exists' });
    }

    const urls = await Promise.all(names.map(async (name: string) => {
      const file = bucket.file(`${folder}/${name}`);
      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // Valid for 15 minutes
        contentType: 'image/jpeg', // Matches the AI output format
      });

      // Construct public URL
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${folder}/${name}`;

      return {
        filename: name,
        signedUrl,
        publicUrl
      };
    }));

    return res.status(200).json({ urls });
  } catch (error: any) {
    console.error('API Error in get-upload-urls:', error?.message || error);
    return res.status(500).json({ error: 'Could not create upload URLs' });
  }
}