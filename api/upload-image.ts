import { Storage } from '@google-cloud/storage';

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
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64, 'base64');
    }

    const filePath = `${siteId}/${filename}`;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);

    await file.save(buffer, {
      contentType,
      metadata: { cacheControl: 'public, max-age=31536000' },
    });

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${filePath}`;

    return res.status(200).json({ publicUrl });
  } catch (error: any) {
    console.error('API Error in upload-image:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
