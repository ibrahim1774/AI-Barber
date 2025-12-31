import axios from 'axios';

const VERCEL_TOKEN = process.env.VERCEL_TOKEN || '';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { shopName, htmlContent } = req.body;

    if (!shopName || !htmlContent) {
      return res.status(400).json({
        error: 'Missing required fields: shopName and htmlContent'
      });
    }

    if (!VERCEL_TOKEN) {
      return res.status(500).json({
        error: 'Missing Vercel token. Please configure VERCEL_TOKEN environment variable.'
      });
    }

    // Create project name from shop name
    const projectName = shopName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50); // Vercel has name length limits

    const fullProjectName = `${projectName}-barber`;

    // Encode HTML content as base64
    const base64Html = Buffer.from(htmlContent).toString('base64');

    // Deploy to Vercel using correct API format
    console.log('Deploying to Vercel...');
    const vercelResponse = await axios.post(
      'https://api.vercel.com/v13/deployments',
      {
        name: fullProjectName,
        files: [
          {
            file: 'index.html',
            data: base64Html,
            encoding: 'base64'
          }
        ],
        target: 'production'
      },
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const deploymentUrl = vercelResponse.data.url ? `https://${vercelResponse.data.url}` : vercelResponse.data.inspectorUrl;

    return res.status(200).json({
      success: true,
      deploymentUrl,
      message: 'Website deployed successfully to Vercel!',
    });

  } catch (error: any) {
    console.error('Deployment error:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Deployment failed',
      details: error.response?.data?.error?.message || error.message || 'Unknown error occurred',
    });
  }
}
