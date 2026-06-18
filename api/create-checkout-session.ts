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
    const { siteId, plan = 'monthly', embedded: bodyEmbedded } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'Missing required field: siteId' });
    }

    // Embedded mode swaps the hosted-page redirect for an inline
    // <EmbeddedCheckout> rendered inside our modal. Returns
    // client_secret instead of the hosted url.
    const isEmbedded = bodyEmbedded === true;

    // `custom`        = "Don't like this? Get a custom website design" ($15/mo).
    // `custom25`      = legacy alias for the custom-design upsell — same
    //                   $15/mo price, kept so old client links don't break.
    // `custom-booksy` = /booksy custom-design upsell ($15/mo). Same price
    //                   as the others; separate slug for analytics.
    // All custom plans route to the same Google Form after checkout.
    const isYearly = plan === 'yearly';
    // 'yearly-booksy' = /booksy yearly (flat $59/yr).
    const isYearlyBooksy = plan === 'yearly-booksy';
    // 'yearly-free' = /free-barber yearly (flat $59/yr).
    const isYearlyFree = plan === 'yearly-free';
    const isMonthlyBooksy = plan === 'monthly-booksy';
    // 'monthly-free' = /free-barber monthly ($7/mo).
    const isMonthlyFree = plan === 'monthly-free';
    const isCustom = plan === 'custom';
    const isCustom25 = plan === 'custom25';
    // 'custom-booksy' = /booksy custom-design upsell ($15/mo).
    // Routes to the same Google Form post-checkout as the other custom
    // plans — only the analytics tag differs.
    const isCustomBooksy = plan === 'custom-booksy';
    // 'primebarber' = the standalone /primebarber landing page —
    // $20/mo charged immediately at signup. No free trial. Treated
    // like a custom plan for routing — same Google Form after payment.
    const isPrimeBarber = plan === 'primebarber';
    // 'primebarber-yearly' = the yearly billing option on /primebarber
    // — same full platform as 'primebarber' but billed annually at a
    // 20% discount ($20/mo × 12 × 0.8 = $192 → $192/yr). Same
    // Google Form routing as the monthly plan.
    const isPrimeBarberYearly = plan === 'primebarber-yearly';
    const isCustomAny = isCustom || isCustom25 || isCustomBooksy || isPrimeBarber || isPrimeBarberYearly;

    let unitAmount: string;
    let interval: 'month' | 'year';
    let productName: string;
    if (isYearly) {
      // Standard yearly: flat $59/yr (≈51% off $10/mo × 12).
      unitAmount = '5900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isYearlyBooksy) {
      // /booksy yearly: flat $59/yr (≈30% off $7/mo × 12).
      unitAmount = '5900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting (Booksy)';
    } else if (isYearlyFree) {
      // /free-barber yearly: flat $59/yr (≈30% off $7/mo × 12).
      unitAmount = '5900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting (Free Barber)';
    } else if (isMonthlyBooksy) {
      // /booksy monthly: $7/mo (entry-point discount vs $10 standard).
      unitAmount = '700';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting (Booksy)';
    } else if (isMonthlyFree) {
      // /free-barber monthly: $7/mo.
      unitAmount = '700';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting (Free Barber)';
    } else if (isCustomBooksy) {
      unitAmount = '1900';
      interval = 'month';
      productName = 'aibarber.org — Custom Website Design (Booksy)';
    } else if (isCustom || isCustom25) {
      unitAmount = '1900';
      interval = 'month';
      productName = 'aibarber.org — Custom Website Design';
    } else if (isPrimeBarber) {
      unitAmount = '2000';
      interval = 'month';
      productName = 'aibarber.org — Custom Website Platform (PrimeBarber)';
    } else if (isPrimeBarberYearly) {
      // 20% off $20/mo × 12 = $192 → $192/yr.
      unitAmount = '19200';
      interval = 'year';
      productName = 'aibarber.org — Custom Website Platform (PrimeBarber, Yearly)';
    } else {
      // Standard (home page) monthly: $10/mo.
      unitAmount = '1000';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
    }

    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'http://localhost:3000';

    // Custom-design plans (custom + custom25): after payment we still
    // bounce back through the app first so the Facebook Pixel + CAPI +
    // TikTok pixel Purchase events fire — docs.google.com can't load
    // our pixel. The app reads `redirect` and forwards to the Google
    // Form once tracking has fired. All other plans return to the app
    // and continue straight into the deploy pipeline.
    const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdS2iaBt6ee0AGWv7pQPSLHoicovQuTOKLFktuiEG4tobBIPw/viewform';
    const baseReturn = `${origin}?stripe_session={CHECKOUT_SESSION_ID}&plan=${encodeURIComponent(plan)}`;
    const successUrl = isCustomAny
      ? `${baseReturn}&redirect=${encodeURIComponent(GOOGLE_FORM_URL)}`
      : baseReturn;

    // Create Stripe Checkout Session for subscription
    const params = new URLSearchParams();
    params.append('mode', 'subscription');
    if (isEmbedded) {
      params.append('ui_mode', 'embedded');
      params.append('return_url', successUrl);
    } else {
      params.append('success_url', successUrl);
      params.append('cancel_url', `${origin}?stripe_cancelled=true`);
    }
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][unit_amount]', unitAmount);
    params.append('line_items[0][price_data][recurring][interval]', interval);
    params.append('line_items[0][quantity]', '1');
    params.append('client_reference_id', siteId);
    params.append('metadata[type]', (isPrimeBarber || isPrimeBarberYearly) ? 'primebarber' : isCustomAny ? 'custom_design' : 'site_hosting');
    params.append('metadata[siteId]', siteId);
    params.append('metadata[plan]', plan);
    // /primebarber: $20/mo charged immediately at signup. The 7-day
    // free trial that previously gated the first charge has been
    // removed — customers are billed today, full subscription starts
    // immediately. They can still cancel anytime via the billing portal.

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
    return res.status(200).json(
      isEmbedded
        ? { clientSecret: session.client_secret, sessionId: session.id }
        : { url: session.url },
    );
  } catch (error: any) {
    console.error('[CreateCheckoutSession] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
