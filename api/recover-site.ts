import { Storage } from '@google-cloud/storage';

// /recover endpoint — finds a customer's already-deployed site when
// the post-payment flow failed to surface it.
//
// Flow:
//   1. POST { email | sessionId } from the /recover page
//   2. Look up the Stripe Checkout Session
//        - sessionId given: fetch directly
//        - email given:    Stripe Search API by customer_email
//   3. Verify the session is paid + extract client_reference_id (siteId)
//   4. Read the pending-site backup from GCS at
//        pending-sites/${siteId}.json
//      (preparePendingSite wrote this BEFORE the Stripe modal opened,
//      so it exists for every customer who got as far as paying)
//   5. Build the SiteInstance payload the client needs to hydrate
//      activeSite + return the deployedUrl computed from the siteId.
//
// This endpoint does NOT touch Supabase. The client takes the
// returned payload, sets it as activeSite, and runs the normal
// AuthModal signup flow — handleAuthSuccess then upserts the recovered
// SiteInstance into Supabase under the new user.id automatically.

interface RecoverBody {
  email?: string;
  sessionId?: string;
}

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({ ok: false, error: 'Server configuration error: missing STRIPE_SECRET_KEY' });
  }

  const { email, sessionId } = (req.body || {}) as RecoverBody;
  if (!email && !sessionId) {
    return res.status(400).json({ ok: false, error: 'Provide either email or sessionId' });
  }

  try {
    // 1. Resolve the Stripe session.
    let session: any = null;
    if (sessionId) {
      const resp = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
        { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
      );
      if (!resp.ok) {
        return res.status(404).json({ ok: false, error: 'Stripe session not found' });
      }
      session = await resp.json();
    } else if (email) {
      // Search the most recent paid sessions for this email. The
      // Search API supports `customer_email` queries. We sort by
      // created desc and pick the most recent paid one — for the
      // recovery use-case this is what the customer means by "my
      // session".
      // Stripe has NO /checkout/sessions/search endpoint (the old code
      // called one and 502'd on every request — recover-by-email never
      // worked). The real API: list sessions filtered by
      // customer_details[email], with a Customers-search fallback for
      // sessions created against a Customer whose email was set there.
      const sessions: any[] = [];
      const listResp = await fetch(
        `https://api.stripe.com/v1/checkout/sessions?customer_details%5Bemail%5D=${encodeURIComponent(email)}&limit=100`,
        { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
      );
      if (listResp.ok) {
        const listBody = await listResp.json();
        sessions.push(...(listBody?.data || []));
      } else {
        const errBody = await listResp.json().catch(() => ({}));
        console.error('[recover-site] Stripe session list error:', listResp.status, errBody);
      }
      if (sessions.length === 0) {
        // Fallback: find the Customer by email (Customers ARE searchable),
        // then list their sessions.
        const custResp = await fetch(
          `https://api.stripe.com/v1/customers/search?query=${encodeURIComponent(`email:'${email.replace(/'/g, "\\'")}'`)}&limit=5`,
          { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
        );
        if (custResp.ok) {
          const custBody = await custResp.json();
          for (const cust of custBody?.data || []) {
            const byCust = await fetch(
              `https://api.stripe.com/v1/checkout/sessions?customer=${encodeURIComponent(cust.id)}&limit=100`,
              { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
            );
            if (byCust.ok) {
              const byCustBody = await byCust.json();
              sessions.push(...(byCustBody?.data || []));
            }
          }
        }
      }
      const paid = sessions
        .filter(s => s.payment_status === 'paid')
        .sort((a, b) => (b.created || 0) - (a.created || 0));
      if (paid.length === 0) {
        return res.status(404).json({ ok: false, error: 'No paid Stripe sessions found for that email' });
      }
      session = paid[0];
    }

    if (!session) {
      return res.status(404).json({ ok: false, error: 'No matching session' });
    }
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ ok: false, error: 'Payment is not in a paid state' });
    }

    const siteIdRaw: string | null =
      (typeof session.client_reference_id === 'string' && session.client_reference_id) ||
      (session.metadata && typeof session.metadata.siteId === 'string' && session.metadata.siteId) ||
      null;
    if (!siteIdRaw) {
      return res.status(404).json({ ok: false, error: 'No siteId on the Stripe session — cannot recover automatically' });
    }
    const siteId = slugify(siteIdRaw);
    if (!siteId) {
      return res.status(404).json({ ok: false, error: 'Invalid siteId on session' });
    }

    // 2. Pull the pending-site backup from GCS.
    const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
    const bucketName = process.env.GCS_BUCKET_NAME;
    if (!credentialsJson || !bucketName) {
      return res.status(500).json({ ok: false, error: 'Server configuration error: GCS credentials missing' });
    }
    const credentials = JSON.parse(credentialsJson);
    const storage = new Storage({ credentials, projectId: credentials.project_id });
    const file = storage.bucket(bucketName).file(`pending-sites/${siteId}.json`);

    const [exists] = await file.exists();
    if (!exists) {
      // Include what Stripe knows so manual/backfill recovery can still
      // locate the deployed Vercel project even without the backup.
      return res.status(404).json({
        ok: false,
        error: 'Pending-site backup not found on the server — site may need manual recovery',
        siteId,
        sessionCreated: session.created || null,
        amountTotal: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
      });
    }
    const [buf] = await file.download();
    let backup: any;
    try {
      backup = JSON.parse(buf.toString('utf-8'));
    } catch {
      return res.status(500).json({ ok: false, error: 'Pending-site backup is corrupted' });
    }

    const pending = backup?.data;
    if (!pending?.siteData || !pending?.imageUrlMap) {
      return res.status(500).json({ ok: false, error: 'Pending-site backup missing required fields' });
    }

    // 3. Compute the deployed Vercel URL (deterministic from siteId).
    // Prefer the URL the deploy API actually resolved (the post-deploy
    // backup refresh stamps it onto the pending payload). The computed
    // `https://<siteId>.vercel.app` fallback is unsafe — Vercel suffixes
    // collided project names, so the slug URL can 404 or belong to a
    // stranger's project.
    const deployedUrl = pending.deployedUrl || `https://${siteId}.vercel.app`;

    // 4. Build the SiteInstance payload the client expects. Mirror the
    //    same shape handleStripeReturn produces on success (lines
    //    528-562 in App.tsx) so the existing dashboard + editor render
    //    it without surprises.
    const imageUrlMap: Record<string, string> = pending.imageUrlMap || {};
    const siteData = pending.siteData || {};
    const fullSiteData = {
      ...siteData,
      hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] || siteData.hero?.imageUrl || '' },
      about: { ...siteData.about, imageUrl: imageUrlMap['about'] || siteData.about?.imageUrl || '' },
      gallery: (siteData.gallery || []).map((_: any, i: number) =>
        imageUrlMap[`gallery${i}`] || ''
      ),
      craftImages: (siteData.craftImages || []).map((_: any, i: number) =>
        imageUrlMap[`craft${i}`] || ''
      ),
      staff: (siteData.staff || []).map((s: any, i: number) => ({
        ...s,
        photo: imageUrlMap[`staff${i}`] || s.photo || '',
      })),
    };

    const siteInstance = {
      id: pending.existingSiteId || siteId,
      data: fullSiteData,
      lastSaved: Date.now(),
      formInputs: {
        shopName: siteData.shopName,
        area: siteData.area,
        phone: siteData.phone,
      },
      deployedUrl,
      deploymentStatus: 'deployed' as const,
      customDomain: null,
      domainOrderId: null,
    };

    return res.status(200).json({
      ok: true,
      siteId,
      deployedUrl,
      customerEmail: session.customer_details?.email || session.customer_email || null,
      shopName: siteData.shopName || null,
      siteInstance,
    });
  } catch (error: any) {
    console.error('[recover-site] Error:', error);
    return res.status(500).json({ ok: false, error: error.message || 'Internal error' });
  }
}
