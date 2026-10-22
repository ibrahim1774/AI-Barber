import { STRIPE_API_VERSION } from '../lib/stripeVersion.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolvePortalCustomer } from '../lib/portalAuth.js';
import { FIRST_PARTY_ORIGINS, setFirstPartyCors } from '../lib/webCors.js';

// POST {} + Authorization: Bearer <Supabase access token> → { url } of the Stripe billing portal
// for the CALLER's own Stripe customer (matched server-side by the caller's verified email).
// A customerId from the browser is ignored, except from the admin. Lookups fail closed (503).
let sb: SupabaseClient | undefined;
const db = () => (sb ??= createClient(
  (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false } },
));

export default async function handler(req: any, res: any) {
  const origin = setFirstPartyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(origin ? 200 : 403).end();
    return;
  }
  if (req.method !== 'POST') return res.status(405).end();

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const auth = await resolvePortalCustomer({ authorization: req.headers?.authorization, customerId: req.body?.customerId }, {
      async userOf(token) {
        const { data, error } = await db().auth.getUser(token);
        if (error) {
          const status = (error as any).status;
          if (typeof status === 'number' && status >= 400 && status < 500) return null;
          throw new Error(`auth.getUser failed: ${error.message}`);
        }
        const u = data?.user;
        return u ? { id: u.id, email: u.email ?? null, emailVerified: !!u.email_confirmed_at } : null;
      },
      async customersByEmail(email) {
        const r = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=10`, {
          headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Stripe-Version': STRIPE_API_VERSION },
          signal: AbortSignal.timeout(8_000),
        });
        if (!r.ok) throw new Error(`Stripe customers ${r.status}`);
        const data: any = await r.json();
        return (data?.data || []).map((c: any) => ({ id: String(c.id), created: Number(c.created) || 0 }));
      },
    });
    if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });

    const params = new URLSearchParams({ customer: auth.customer, return_url: origin || FIRST_PARTY_ORIGINS[0] });
    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION },
      body: params.toString(),
    });
    if (!response.ok) {
      console.error('[CreatePortalSession] Stripe error:', response.status);
      return res.status(502).json({ error: 'Failed to create portal session' });
    }
    const session = await response.json();
    return res.status(200).json({ url: session.url });
  } catch (error: any) {
    console.error('[CreatePortalSession] Error:', error?.message || error);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
