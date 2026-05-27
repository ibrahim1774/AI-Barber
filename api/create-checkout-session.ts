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
    const { siteId, plan = 'monthly' } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'Missing required field: siteId' });
    }

    // `five` = /5 launch-special ($5/mo). `custom` = /5 "Don't like this?
    // Get a custom website design" upsell ($20/mo) — visitor completes
    // checkout, then is sent to a Google Form to share preferences.
    const isYearly = plan === 'yearly';
    const isFive = plan === 'five';
    const isCustom = plan === 'custom';

    let unitAmount: string;
    let interval: 'month' | 'year';
    let productName: string;
    if (isYearly) {
      unitAmount = '7200';
      interval = 'year';
      productName = 'Prime Barber AI - Yearly Hosting';
    } else if (isFive) {
      unitAmount = '500';
      interval = 'month';
      productName = 'Prime Barber AI - Launch Special Hosting ($5/mo)';
    } else if (isCustom) {
      unitAmount = '2000';
      interval = 'month';
      productName = 'Prime Barber AI - Custom Website Design ($20/mo)';
    } else {
      unitAmount = '1000';
      interval = 'month';
      productName = 'Prime Barber AI - Monthly Hosting';
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:3000';

    // Custom-design plan: after payment send the visitor to the Google Form
    // so we can collect their design preferences (look they like, booking
    // provider, photos, etc). All other plans return to the app to continue
    // the deploy pipeline.
    const successUrl = isCustom
      ? 'https://docs.google.com/forms/d/e/1FAIpQLSdS2iaBt6ee0AGWv7pQPSLHoicovQuTOKLFktuiEG4tobBIPw/viewform'
      : `${origin}?stripe_session={CHECKOUT_SESSION_ID}`;

    // Create Stripe Checkout Session for subscription
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', successUrl);
    params.append('cancel_url', `${origin}?stripe_cancelled=true`);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][unit_amount]', unitAmount);
    params.append('line_items[0][price_data][recurring][interval]', interval);
    params.append('line_items[0][quantity]', '1');
    params.append('client_reference_id', siteId);
    params.append('metadata[type]', isCustom ? 'custom_design' : 'site_hosting');
    params.append('metadata[siteId]', siteId);
    params.append('metadata[plan]', plan);

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
