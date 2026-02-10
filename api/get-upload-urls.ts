import { Storage } from '@google-cloud/storage';

// Initialize with your existing environment variables
const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
// Moved storage initialization inside handler for better error handling

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { siteId, filenames } = req.body;

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

    // Generate a signed URL and public URL for each image
    const urls = await Promise.all(filenames.map(async (name: string) => {
      const file = bucket.file(`${siteId}/${name}`);
      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000, // Valid for 15 minutes
        contentType: 'image/jpeg', // Matches the AI output format
      });

      // Construct public URL
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${siteId}/${name}`;

      return {
        filename: name,
        signedUrl,
        publicUrl
      };
    }));

    return res.status(200).json({ urls });
  } catch (error: any) {
    console.error('API Error in get-upload-urls:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}