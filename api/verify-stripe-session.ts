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
      return res.status(200).json({
        verified: true,
        customerEmail: session.customer_details?.email || null,
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
