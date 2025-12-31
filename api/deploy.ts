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
      .replace(/^-|-$/g, '');

    const fullProjectName = `${projectName}-barber-site`;

    // Deploy to Vercel
    console.log('Deploying to Vercel...');
    const vercelResponse = await axios.post(
      'https://api.vercel.com/v13/deployments',
      {
        name: fullProjectName,
        files: [
          {
            file: 'index.html',
            data: htmlContent
          }
        ],
        projectSettings: {
          framework: null,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const deploymentUrl = `https://${vercelResponse.data.url}`;

    return res.status(200).json({
      success: true,
      deploymentUrl,
      message: 'Website deployed successfully to Vercel!',
    });

  } catch (error: any) {
    console.error('Deployment error:', error);
    return res.status(500).json({
      error: 'Deployment failed',
      details: error.response?.data || error.message || 'Unknown error occurred',
    });
  }
}
