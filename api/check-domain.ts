export default async function handler(req: any, res: any) {
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
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'Missing domain' });
    }

    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) {
      return res.status(500).json({ error: 'Server configuration error: missing VERCEL_TOKEN' });
    }

    // Check availability
    const availResponse = await fetch(
      `https://api.vercel.com/v5/domains/${encodeURIComponent(domain)}/check`,
      {
        headers: { Authorization: `Bearer ${vercelToken}` },
      }
    );

    if (!availResponse.ok) {
      const errData = await availResponse.json().catch(() => ({}));
      console.error('[CheckDomain] Availability check failed:', availResponse.status, errData);
      return res.status(400).json({ available: false, error: 'Failed to check domain availability' });
    }

    const availData = await availResponse.json();

    if (!availData.available) {
      return res.status(200).json({ available: false });
    }

    // Get price
    const priceResponse = await fetch(
      `https://api.vercel.com/v1/registrar/domains/${encodeURIComponent(domain)}/price`,
      {
        headers: { Authorization: `Bearer ${vercelToken}` },
      }
    );

    let price = 0;
    let renewalPrice = 0;

    if (priceResponse.ok) {
      const priceData = await priceResponse.json();
      price = priceData.price || 0;
      renewalPrice = priceData.renewalPrice || priceData.price || 0;
    }

    return res.status(200).json({
      available: true,
      price,
      renewalPrice,
    });
  } catch (error: any) {
    console.error('[CheckDomain] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
