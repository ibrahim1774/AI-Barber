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
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ verified: false, reason: 'Missing sessionId' });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return res.status(500).json({ verified: false, reason: 'Server configuration error' });
    }

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      {
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
        },
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[Stripe Verify] API error:', response.status, errData);
      return res.status(400).json({ verified: false, reason: 'Invalid session' });
    }

    const session = await response.json();

    if (session.payment_status === 'paid') {
      // amount_total is in the smallest currency unit (cents for USD)
      const amountTotal = typeof session.amount_total === 'number' ? session.amount_total / 100 : null;
      const cd = session.customer_details || {};
      const addr = cd.address || {};
      return res.status(200).json({
        verified: true,
        customerEmail: cd.email || null,
        customerPhone: cd.phone || null,
        customerName: cd.name || null,
        customerAddress: {
          city: addr.city || null,
          state: addr.state || null,
          zip: addr.postal_code || null,
          country: addr.country || null,
        },
        amountTotal,
        currency: (session.currency || 'usd').toUpperCase(),
        plan: session.metadata?.plan || null,
      });
    }

    return res.status(200).json({
      verified: false,
      reason: `Payment status: ${session.payment_status}`,
    });
  } catch (error: any) {
    console.error('[Stripe Verify] Error:', error);
    return res.status(500).json({ verified: false, reason: error.message || 'Internal error' });
  }
}
