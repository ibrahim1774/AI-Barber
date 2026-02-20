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
    const { siteId } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'Missing required field: siteId' });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:3000';

    // Create Stripe Checkout Session for $10/month subscription
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', `${origin}?stripe_session={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${origin}?stripe_cancelled=true`);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', 'Prime Barber AI - Monthly Hosting');
    params.append('line_items[0][price_data][unit_amount]', '1000');
    params.append('line_items[0][price_data][recurring][interval]', 'month');
    params.append('line_items[0][quantity]', '1');
    params.append('client_reference_id', siteId);
    params.append('metadata[type]', 'site_hosting');
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
      console.error('[CreateCheckoutSession] Stripe error:', response.status, errData);
      return res.status(400).json({ error: 'Failed to create checkout session' });
    }

    const session = await response.json();
    return res.status(200).json({ url: session.url });
  } catch (error: any) {
    console.error('[CreateCheckoutSession] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
