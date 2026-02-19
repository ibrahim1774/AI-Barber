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
    const { domain, vercelPrice, siteId, projectName } = req.body;

    if (!domain || !vercelPrice || !siteId || !projectName) {
      return res.status(400).json({ error: 'Missing required fields: domain, vercelPrice, siteId, projectName' });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }

    // Price in USD with $5 markup, convert to cents
    const priceInCents = Math.round((vercelPrice + 5) * 100);

    // Determine origin for success/cancel URLs
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:3000';

    // Create Stripe Checkout Session using the API directly
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `${origin}?domain_payment=success&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${origin}?domain_payment=cancelled`);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', `Domain Registration - ${domain}`);
    params.append('line_items[0][price_data][unit_amount]', String(priceInCents));
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[type]', 'domain_purchase');
    params.append('metadata[domain]', domain);
    params.append('metadata[projectName]', projectName);
    params.append('metadata[siteId]', siteId);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[CreateDomainCheckout] Stripe error:', response.status, errData);
      return res.status(400).json({ error: 'Failed to create checkout session' });
    }

    const session = await response.json();
    return res.status(200).json({ url: session.url });
  } catch (error: any) {
    console.error('[CreateDomainCheckout] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
