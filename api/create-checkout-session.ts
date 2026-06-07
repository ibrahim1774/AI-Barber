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

    // `five`     = /5 launch-special ($5/mo).
    // `seven`    = /7 launch-special ($7/mo).
    // `custom`   = "Don't like this? Get a custom website design" ($19/mo).
    // `custom25` = legacy alias for the custom-design upsell — same $19/mo
    //              price now, kept so old client links don't break.
    // `custom15` = /5-deal-only custom-design upsell ($15/mo). Keeps the
    //              relative gap between $5 hosting and the custom-build
    //              upsell small on the /5 launch-special page.
    // All custom plans route to the same Google Form after checkout.
    const isYearly = plan === 'yearly';
    // 'yearly-booksy' = /booksy yearly (20% off $5/mo × 12 = $48/yr).
    const isYearlyBooksy = plan === 'yearly-booksy';
    // 'yearly-free' = /free-barber yearly ($48/yr — same math as
    // booksy, but tracked separately for analytics + product name).
    const isYearlyFree = plan === 'yearly-free';
    const isFive = plan === 'five';
    const isSeven = plan === 'seven';
    const isMonthlyBooksy = plan === 'monthly-booksy';
    // 'monthly-free' = /free-barber monthly ($5/mo).
    const isMonthlyFree = plan === 'monthly-free';
    const isCustom = plan === 'custom';
    const isCustom25 = plan === 'custom25';
    const isCustom15 = plan === 'custom15';
    // `custom-booksy` = /booksy import flow custom-design upsell ($19/mo).
    // Routes to the same Google Form post-checkout as the other custom
    // plans — only the price differs.
    const isCustomBooksy = plan === 'custom-booksy';
    const isCustomAny = isCustom || isCustom25 || isCustom15 || isCustomBooksy;

    let unitAmount: string;
    let interval: 'month' | 'year';
    let productName: string;
    if (isYearly) {
      // Standard yearly: 20% off $9/mo × 12 = $86/yr.
      unitAmount = '8600';
      interval = 'year';
      productName = 'Prime Barber AI - Yearly Hosting ($86/yr)';
    } else if (isYearlyBooksy) {
      // /booksy yearly: 20% off $5/mo × 12 = $48/yr.
      unitAmount = '4800';
      interval = 'year';
      productName = 'Prime Barber AI Booksy - Yearly Hosting ($48/yr)';
    } else if (isYearlyFree) {
      // /free-barber yearly: 20% off $7/mo × 12 = $67.20/yr → $67.
      unitAmount = '6700';
      interval = 'year';
      productName = 'Prime Barber AI Free - Yearly Hosting ($67/yr)';
    } else if (isFive) {
      unitAmount = '500';
      interval = 'month';
      productName = 'Prime Barber AI - Launch Special Hosting ($5/mo)';
    } else if (isSeven) {
      unitAmount = '700';
      interval = 'month';
      productName = 'Prime Barber AI - Launch Special Hosting ($7/mo)';
    } else if (isMonthlyBooksy) {
      unitAmount = '500';
      interval = 'month';
      productName = 'Prime Barber AI Booksy - Monthly Hosting ($5/mo)';
    } else if (isMonthlyFree) {
      // /free-barber monthly: $7/mo.
      unitAmount = '700';
      interval = 'month';
      productName = 'Prime Barber AI Free - Monthly Hosting ($7/mo)';
    } else if (isCustom15) {
      unitAmount = '1500';
      interval = 'month';
      productName = 'Prime Barber AI - Custom Website Design ($15/mo)';
    } else if (isCustomBooksy) {
      unitAmount = '1500';
      interval = 'month';
      productName = 'Prime Barber AI Booksy - Custom Website Design ($15/mo)';
    } else if (isCustom || isCustom25) {
      unitAmount = '1500';
      interval = 'month';
      productName = 'Prime Barber AI - Custom Website Design ($15/mo)';
    } else {
      unitAmount = '900';
      interval = 'month';
      productName = 'Prime Barber AI - Monthly Hosting';
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
    params.append('success_url', successUrl);
    params.append('cancel_url', `${origin}?stripe_cancelled=true`);
    params.append('line_items[0][price_data][currency]', 'usd');
    params.append('line_items[0][price_data][product_data][name]', productName);
    params.append('line_items[0][price_data][unit_amount]', unitAmount);
    params.append('line_items[0][price_data][recurring][interval]', interval);
    params.append('line_items[0][quantity]', '1');
    params.append('client_reference_id', siteId);
    params.append('metadata[type]', isCustomAny ? 'custom_design' : 'site_hosting');
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
