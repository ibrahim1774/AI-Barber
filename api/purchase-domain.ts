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
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const vercelToken = process.env.VERCEL_TOKEN;

    if (!stripeSecretKey || !vercelToken) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Step 1: Retrieve and verify Stripe session
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${sessionId}`,
      {
        headers: { 'Authorization': `Bearer ${stripeSecretKey}` },
      }
    );

    if (!stripeResponse.ok) {
      return res.status(400).json({ error: 'Invalid checkout session' });
    }

    const session = await stripeResponse.json();

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: `Payment not completed: ${session.payment_status}` });
    }

    const domain = session.metadata?.domain;
    const projectName = session.metadata?.projectName;

    if (!domain || !projectName) {
      return res.status(400).json({ error: 'Missing domain or projectName in session metadata' });
    }

    // Step 2: Test mode check — skip actual purchase
    if (stripeSecretKey.startsWith('sk_test_')) {
      console.log(`[PurchaseDomain] TEST MODE: Skipping real purchase for ${domain}`);
      return res.status(200).json({
        success: true,
        domain,
        orderId: `test_order_${Date.now()}`,
      });
    }

    // Step 3: Buy domain via Vercel
    const buyResponse = await fetch(
      `https://api.vercel.com/v1/registrar/domains/${encodeURIComponent(domain)}/buy`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          autoRenew: true,
          years: 1,
        }),
      }
    );

    if (!buyResponse.ok) {
      const errData = await buyResponse.json().catch(() => ({}));
      console.error('[PurchaseDomain] Vercel buy error:', buyResponse.status, errData);
      return res.status(400).json({ error: `Domain purchase failed: ${errData.error?.message || 'Unknown error'}` });
    }

    const buyData = await buyResponse.json();

    // Step 4: Add domain to project
    const addDomainResponse = await fetch(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(projectName)}/domains`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${vercelToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      }
    );

    if (!addDomainResponse.ok) {
      const errData = await addDomainResponse.json().catch(() => ({}));
      console.error('[PurchaseDomain] Add domain to project error:', addDomainResponse.status, errData);
      // Non-fatal: domain is purchased but not yet linked
    }

    return res.status(200).json({
      success: true,
      domain,
      orderId: buyData.orderId || buyData.id || `order_${Date.now()}`,
    });
  } catch (error: any) {
    console.error('[PurchaseDomain] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
