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
    const { siteId, plan = 'monthly', embedded: bodyEmbedded, page } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'Missing required field: siteId' });
    }

    // Path the checkout was opened from, sent by the client. Sanitized
    // rather than trusted: it only ever lands in our own metadata, but a
    // junk value there is noise in every dashboard that reads it. Query
    // and hash are dropped so /15?utm_source=… collapses to /15.
    const sourcePage: string =
      typeof page === 'string' && page.startsWith('/')
        ? page.split(/[?#]/)[0].slice(0, 100)
        : '';

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
    // /booking entry: $10/mo + $59/yr.
    const isMonthlyBooking = plan === 'monthly-booking';
    const isYearlyBooking = plan === 'yearly-booking';
    // /generate entry ("Customize Your Barbershop Site"): $10/mo + $59/yr.
    const isMonthlyGenerate = plan === 'monthly-generate';
    const isYearlyGenerate = plan === 'yearly-generate';
    // '/home-2' price test: exact homepage funnel at $19/mo + $99/yr.
    const isMonthlyHome2 = plan === 'monthly-home2';
    const isYearlyHome2 = plan === 'yearly-home2';
    // '/15' price test: exact homepage funnel at $15/mo + $144/yr (same as home).
    const isMonthly15 = plan === 'monthly-15';
    const isYearly15 = plan === 'yearly-15';
    // '/20' price test: exact homepage funnel at $20/mo + $192/yr
    // (20% off $20/mo × 12 = $240). Custom upsell stays custom25 ($29).
    const isMonthly20 = plan === 'monthly-20';
    const isYearly20 = plan === 'yearly-20';
    // '/7' price test: exact homepage funnel at $7/mo + $67/yr.
    const isMonthly7 = plan === 'monthly-7';
    const isYearly7 = plan === 'yearly-7';
    // '/9' price test: exact homepage funnel at $19/mo + $137/yr (40% off); custom $19 (custom-15).
    const isMonthly9 = plan === 'monthly-9';
    const isYearly9 = plan === 'yearly-9';
    // '/barber-generate' hosting: $15/mo + $144/yr (20% off $15 × 12).
    const isMonthlyBargen = plan === 'monthly-bargen';
    const isYearlyBargen = plan === 'yearly-bargen';
    // '/barber-generate' custom build: flat $29/mo, no yearly.
    const isCustomBargen = plan === 'custom-bargen';
    // 'monthly-custom10' = the /custom-10 pay-first funnel — standard
    // $10/mo hosting, but the booking link is collected AFTER payment in
    // the account. Normal deploy routing (NOT the Google Form): the page
    // metadata is what marks the source subpage.
    const isMonthlyCustom10 = plan === 'monthly-custom10';
    const isCustom = plan === 'custom';
    const isCustom25 = plan === 'custom25';
    // 'custom-booksy' = /booksy custom-design upsell ($15/mo).
    // Routes to the same Google Form post-checkout as the other custom
    // plans — only the analytics tag differs.
    const isCustomBooksy = plan === 'custom-booksy';
    // '/15' custom-design upsell — $19/mo price test (vs $29 elsewhere).
    const isCustom15 = plan === 'custom-15';
    // 'primebarber' = the standalone /primebarber landing page —
    // $20/mo charged immediately at signup. No free trial. Treated
    // like a custom plan for routing — same Google Form after payment.
    const isPrimeBarber = plan === 'primebarber';
    // 'primebarber-yearly' = the yearly billing option on /primebarber
    // — same full platform as 'primebarber' but billed annually at a
    // 20% discount ($20/mo × 12 × 0.8 = $192 → $192/yr). Same
    // Google Form routing as the monthly plan.
    const isPrimeBarberYearly = plan === 'primebarber-yearly';
    // '/custom-design' + '/custom-design-29' — custom-design-only funnels
    // ($29/mo, no hosting or yearly option on the page). Two slugs for one
    // price so the two page variants stay comparable in Stripe/analytics
    // even though they bill under the same product name.
    const isCustomDesignPage = plan === 'custom-design';
    const isCustomDesign29 = plan === 'custom-design-29';
    const isCustomAny =
      isCustom || isCustom25 || isCustomBooksy || isCustom15 ||
      isCustomBargen ||
      isCustomDesignPage || isCustomDesign29 || isPrimeBarber || isPrimeBarberYearly;

    let unitAmount: string;
    let interval: 'month' | 'year';
    let productName: string;
    if (isYearly) {
      // Standard yearly: $144/yr (20% off $15/mo × 12 = $180).
      unitAmount = '14400';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isYearlyBooksy) {
      // /booksy yearly: flat $59/yr (≈51% off $10/mo × 12).
      unitAmount = '5900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isYearlyFree) {
      // /free-barber yearly: flat $49/yr (≈42% off $7/mo × 12).
      unitAmount = '4900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthlyBooksy) {
      // /booksy monthly: $10/mo.
      unitAmount = '1000';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isMonthlyFree) {
      // /free-barber monthly: $7/mo.
      unitAmount = '700';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearlyBooking) {
      // /booking yearly: $59/yr.
      unitAmount = '5900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthlyBooking) {
      // /booking monthly: $10/mo.
      unitAmount = '1000';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearlyGenerate) {
      // /generate yearly: $59/yr.
      unitAmount = '5900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthlyGenerate) {
      // /generate monthly: $10/mo.
      unitAmount = '1000';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearlyHome2) {
      // /home-2 yearly: $99/yr (≈57% off $19/mo × 12).
      unitAmount = '9900';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthlyHome2) {
      // /home-2 monthly: $19/mo.
      unitAmount = '1900';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearly9) {
      // /9 yearly: $137/yr (40% off $19/mo x 12 = $228).
      unitAmount = '13700';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthlyCustom10) {
      // /custom-10: standard $10/mo hosting under its own slug so the
      // pay-first funnel is separable in Stripe/admin/pixels.
      unitAmount = '1000';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isMonthly9) {
      // /9 monthly: $19/mo.
      unitAmount = '1900';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearly7) {
      // /7 yearly: $67/yr (20% off $7/mo x 12 = $84).
      unitAmount = '6700';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthly7) {
      // /7 monthly: $7/mo.
      unitAmount = '700';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearly15) {
      // /15 yearly: $144/yr (20% off $15/mo × 12 — matches the homepage).
      unitAmount = '14400';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthly15) {
      // /15 monthly: $15/mo.
      unitAmount = '1500';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearly20) {
      // /20 yearly: $192/yr (20% off $20/mo × 12).
      unitAmount = '19200';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isMonthly20) {
      // /20 monthly: $20/mo.
      unitAmount = '2000';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isMonthlyBargen) {
      // /barber-generate monthly: $15/mo.
      unitAmount = '1500';
      interval = 'month';
      productName = 'aibarber.org — Monthly Website Hosting';
    } else if (isYearlyBargen) {
      // /barber-generate yearly: $144/yr (20% off $15/mo × 12).
      unitAmount = '14400';
      interval = 'year';
      productName = 'aibarber.org — Yearly Website Hosting';
    } else if (isCustomBargen) {
      // /barber-generate custom build: $29/mo.
      unitAmount = '2900';
      interval = 'month';
      productName = 'aibarber.org — Website Hosting (Custom)';
    } else if (isCustom15) {
      // /7 + /9 custom design: $19/mo (slug kept from the old /15 test;
      // /15 now upsells the standard $29 custom25).
      unitAmount = '1900';
      interval = 'month';
      productName = 'aibarber.org — Website Hosting (Custom)';
    } else if (isCustomBooksy) {
      unitAmount = '2900';
      interval = 'month';
      productName = 'aibarber.org — Website Hosting (Custom)';
    } else if (isCustom || isCustom25 || isCustomDesignPage || isCustomDesign29) {
      unitAmount = '2900';
      interval = 'month';
      productName = 'aibarber.org — Website Hosting (Custom)';
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
      // Standard (home page) monthly: $15/mo.
      unitAmount = '1500';
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
    // `app` lets the Stripe webhook (api/stripe-webhook) attribute the
    // server-side Purchase to this app and ignore another app's sessions
    // if AI-Barber + PrimeHub ever share one Stripe account.
    params.append('metadata[app]', 'aibarber');
    params.append('metadata[type]', (isPrimeBarber || isPrimeBarberYearly) ? 'primebarber' : isCustomAny ? 'custom_design' : 'site_hosting');
    params.append('metadata[siteId]', siteId);
    params.append('metadata[plan]', plan);
    // Which subpage this checkout was opened from (/15, /custom-design-29,
    // /booksy…). Product names deliberately no longer encode the page —
    // the customer's receipt shouldn't advertise which price test they
    // landed on — so this is the only page signal, and it has to live on
    // the SUBSCRIPTION too (mirrored below): /admin reads subscriptions,
    // and session metadata isn't visible from the Stripe subscription view.
    if (sourcePage) params.append('metadata[page]', sourcePage);

    // Mirror the identifying keys onto the subscription. Without this the
    // Stripe subscription page shows no metadata at all and a sale can't
    // be traced back to its funnel after the fact.
    params.append('subscription_data[metadata][app]', 'aibarber');
    params.append('subscription_data[metadata][plan]', plan);
    params.append('subscription_data[metadata][siteId]', siteId);
    if (sourcePage) params.append('subscription_data[metadata][page]', sourcePage);

    // Ad attribution — stamp which Facebook campaign/ad drove this purchase
    // onto the Stripe session metadata (visible on the payment, and available
    // to the Stripe webhook + Triple Whale order push). Read from the aib_attr
    // cookie set by services/adAttribution.ts on the landing page, so we don't
    // have to thread the params through every client checkout call. tw_source,
    // tw_adid, tw_campaign, utm_*, etc. Stripe caps: ≤50 keys, ≤40-char keys,
    // ≤500-char values — we forward a bounded, sanitized subset.
    try {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith('aib_attr='));
      if (match) {
        const attr = JSON.parse(decodeURIComponent(match.slice('aib_attr='.length)));
        if (attr && typeof attr === 'object') {
          Object.entries(attr)
            .filter(([k, v]) => typeof v === 'string' && v && /^[a-z0-9_]{1,36}$/i.test(k))
            .slice(0, 20)
            .forEach(([k, v]) => params.append(`metadata[${k}]`, String(v).slice(0, 500)));
        }
      }
    } catch { /* attribution is best-effort — never block checkout */ }
    // First-touch set (aib_attr_f) — the ad that ORIGINALLY brought this
    // visitor. Stamped under an fc_ prefix so /tracking can offer both
    // first-click and last-click attribution models.
    try {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith('aib_attr_f='));
      if (match) {
        const attr = JSON.parse(decodeURIComponent(match.slice('aib_attr_f='.length)));
        if (attr && typeof attr === 'object') {
          Object.entries(attr)
            .filter(([k, v]) => typeof v === 'string' && v && /^[a-z0-9_]{1,33}$/i.test(k))
            .slice(0, 12)
            .forEach(([k, v]) => params.append(`metadata[fc_${k}]`, String(v).slice(0, 500)));
        }
      }
    } catch { /* first-touch is best-effort too */ }
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
