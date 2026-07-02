// Dedicated checkout endpoint for the /prime-barber sample-site funnel.
//
// Fully self-contained — intentionally shares NO logic with
// create-checkout-session.ts so the Prime Barber System funnel can never
// affect any other subpage's pricing or checkout. One product only:
//
//   Prime Barber System — $97/month, 7-day free trial.
//
// Nothing deploys. After the trial starts, Stripe sends the customer
// straight to the Go High Level onboarding/video walkthrough.

const PRIME_BARBER_GHL_URL = 'https://app.gohighlevel.com/v2/preview/4Cfl2ya9UdYFoYuW868F';

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
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:3000';

    // 7-day free trial, then $97/month. On success → Go High Level.
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    params.append('success_url', PRIME_BARBER_GHL_URL);
    params.append('cancel_url', `${origin}/prime-barber?cancelled=true`);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', 'Prime Barber System — All-in-One Barbershop Platform');
    params.append('line_items[0][price_data][unit_amount]', '9700');
    params.append('line_items[0][price_data][recurring][interval]', 'month');
    params.append('line_items[0][quantity]', '1');
    params.append('subscription_data[trial_period_days]', '7');
    params.append('client_reference_id', 'prime-barber-system');
    params.append('metadata[app]', 'aibarber');
    params.append('metadata[type]', 'prime_barber_system');
    params.append('metadata[plan]', 'prime-barber');

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
      console.error('[PrimeBarberCheckout] Stripe error:', response.status, errData);
      return res.status(400).json({ error: 'Failed to create checkout session' });
    }

    const session = await response.json();
    return res.status(200).json({ url: session.url });
  } catch (error: any) {
    console.error('[PrimeBarberCheckout] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
