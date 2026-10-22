import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { purchaseDomain, supabaseWebPurchases } from '../lib/webDomains.js';
import { liveVercelDomains, registrantContact } from '../lib/ios/vercelDomains.js';
import { authorizeSiteOwner, liveDeployAuthDeps } from '../lib/deployAuth.js';
import { setFirstPartyCors } from '../lib/webCors.js';

// POST { sessionId, domain? } + Authorization: Bearer <Supabase access token of the site's owner>
// after a paid domain Checkout: buys the domain on Vercel and adds it to the site's project.
// Owner of the session's own metadata.siteId only (lib/deployAuth.ts authorizeSiteOwner). Single-use per paid session (web_domain_purchases, migration 012): a replayed
// session id returns the stored result and never buys again. Price and project come only from
// the session metadata we wrote at checkout (lib/webDomains.ts).
let sb: SupabaseClient | undefined;
const db = () => (sb ??= createClient(
  (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } },
));

export default async function handler(req: any, res: any) {
  const origin = setFirstPartyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(origin ? 200 : 403).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Server configuration error' });
    }
    const authDeps = liveDeployAuthDeps();
    const r = await purchaseDomain(req.body, req.headers?.authorization, {
      authorize: (siteId, authorization) => authorizeSiteOwner({ siteId, authorization }, authDeps),
      async getStripeSession(sessionId) {
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
          headers: { Authorization: `Bearer ${stripeSecretKey}` },
        });
        return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) };
      },
      repo: supabaseWebPurchases(db),
      vercel: liveVercelDomains(),
      contact: registrantContact(),
      testMode: stripeSecretKey.startsWith('sk_test_'),
    });
    return res.status(r.status).json(r.body);
  } catch (error: any) {
    console.error('[PurchaseDomain] Error:', error?.message || error);
    return res.status(500).json({ error: 'Internal error' });
  }
}
