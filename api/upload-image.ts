import { Storage } from '@google-cloud/storage';
import { imageFilename, imageFolder, isImageContentType } from '../lib/uploadTarget.js';
import { isPreconditionFailed } from '../lib/publishSite.js';

// Unauthenticated image upload: POST { siteId, filename, base64 } -> { publicUrl }.
// It writes `${siteId}/${filename}` in the bucket that also holds the server's own JSON, so
// the folder and name are restricted to image paths (lib/uploadTarget.ts), the body must be
// an image, and an existing object is never replaced (ifGenerationMatch: 0 -> 409).

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { siteId, filename, base64 } = req.body;

    if (!siteId || !filename || !base64) {
      return res.status(400).json({ error: 'Missing required fields: siteId, filename, base64' });
    }
    const folder = imageFolder(siteId);
    const name = imageFilename(filename);
    if (!folder || !name || typeof base64 !== 'string') {
      return res.status(400).json({ error: 'Invalid siteId or filename' });
    }

    const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
    if (!credentialsJson) {
      return res.status(500).json({ error: 'Server configuration error: Missing Google Cloud credentials' });
    }

    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!bucketName) {
      return res.status(500).json({ error: 'Server configuration error: Missing bucket name' });
    }

    const credentials = JSON.parse(credentialsJson);
    const storage = new Storage({ credentials, projectId: credentials.project_id });

    // Parse base64 data URL
    let buffer: Buffer;
    let contentType = 'image/jpeg';

    if (base64.startsWith('data:')) {
      const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: 'Invalid base64 data URL format' });
      }
      contentType = matches[1];
      if (!isImageContentType(contentType)) {
        return res.status(400).json({ error: 'Only images can be uploaded' });
      }
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64, 'base64');
    }

    const filePath = `${folder}/${name}`;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);

    try {
      await file.save(buffer, {
        contentType,
        metadata: { cacheControl: 'public, max-age=31536000' },
        // Never replace an object: uploads are uniquely named, and a live site's images
        // must not be swappable by anyone who can read its HTML.
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (e: any) {
      if (isPreconditionFailed(e)) return res.status(409).json({ error: 'File already exists' });
      throw e;
    }

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;

    return res.status(200).json({ publicUrl });
  } catch (error: any) {
    console.error('API Error in upload-image:', error?.message || error);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
