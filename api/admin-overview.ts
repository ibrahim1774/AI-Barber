import { createClient } from '@supabase/supabase-js';

/*
 * /admin data feed — one JSON payload joining Stripe subscriptions,
 * Supabase auth users, and the sites table by customer email.
 *
 * Auth: Authorization: Bearer <supabase access token>. The token's user
 * must be ADMIN_EMAIL — hardcoded on purpose (owner asked for no env
 * config). Everyone else gets 403 and no data.
 *
 * Env (already on the Vercel project):
 *   STRIPE_SECRET_KEY / STRIPE_LIVE_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_URL (falls back to VITE_SUPABASE_URL)
 */

const ADMIN_EMAIL = 'ibrahim3709@gmail.com';

interface SubRow {
  subId: string;
  email: string;
  name: string | null;
  stripePhone: string | null;
  product: string;
  amount: number;          // dollars per billing interval
  amountMonthly: number;   // normalized to $/month
  interval: string;
  status: string;          // stripe status: active | past_due | canceled | ...
  created: number;
  canceledAt: number | null;
  cancelAtPeriodEnd: boolean;
  family: 'aibarber' | 'primehub' | 'other-biz' | 'unknown';
  isCustomDesign: boolean;
}

const familyOf = (product: string): SubRow['family'] => {
  if (/ariya|haelabs|faceforge|nurplix/i.test(product)) return 'other-biz';
  if (/aibarber|prime barber/i.test(product)) return 'aibarber';
  if (/primehub/i.test(product)) return 'primehub';
  return 'unknown';
};

async function fetchAllSubscriptions(stripeKey: string): Promise<any[]> {
  const subs: any[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: '100', status: 'all' });
    params.append('expand[]', 'data.plan.product');
    params.append('expand[]', 'data.customer');
    if (startingAfter) params.set('starting_after', startingAfter);
    const resp = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!resp.ok) throw new Error(`Stripe subscriptions list failed (${resp.status})`);
    const data = await resp.json();
    subs.push(...(data.data || []));
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return subs;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_LIVE_KEY;
  if (!supabaseUrl || !serviceKey || !stripeKey) {
    return res.status(500).json({ ok: false, error: 'Server missing configuration' });
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'Sign in required' });

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: caller, error: authError } = await admin.auth.getUser(token);
  if (authError || caller?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: 'Not authorized' });
  }

  try {
    // Three sources in parallel: Stripe subs, auth users, sites rows.
    const [stripeSubs, users, sitesResult] = await Promise.all([
      fetchAllSubscriptions(stripeKey),
      (async () => {
        const all: any[] = [];
        for (let page = 1; page <= 20; page++) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          all.push(...data.users);
          if (data.users.length < 200) break;
        }
        return all;
      })(),
      admin.from('sites').select('id, user_id, deployed_url, site_data, created_at'),
    ]);
    if (sitesResult.error) throw sitesResult.error;

    // email -> account summary; userId -> sites
    const accountByEmail = new Map<string, any>();
    for (const u of users) {
      const email = (u.email || '').toLowerCase();
      if (!email) continue;
      const meta = u.user_metadata || {};
      accountByEmail.set(email, {
        userId: u.id,
        email,
        signupPhone: u.phone || meta.phone || meta.phone_number || null,
        fullName: meta.full_name || null,
        signedUp: u.created_at,
        lastSignIn: u.last_sign_in_at,
        sites: [] as any[],
      });
    }
    for (const s of sitesResult.data || []) {
      const owner = [...accountByEmail.values()].find((a) => a.userId === s.user_id);
      if (!owner) continue;
      const sd = s.site_data || {};
      owner.sites.push({
        siteId: s.id,
        url: s.deployed_url || sd.deployedUrl || null,
        shopName: sd.shopName || sd.name || null,
        sitePhone: sd.phone || sd.phoneNumber || null,
        created: s.created_at,
      });
    }

    const emailsWithSubs = new Set<string>();
    const subs: any[] = [];
    for (const s of stripeSubs) {
      const customer = typeof s.customer === 'object' && s.customer ? s.customer : {};
      const email = (customer.email || '').toLowerCase();
      const plan = s.plan || {};
      const product = typeof plan.product === 'object' && plan.product ? plan.product.name : 'Unknown product';
      const amount = (plan.amount || 0) / 100;
      const interval = plan.interval || 'month';
      if (email) emailsWithSubs.add(email);
      const row: SubRow & { account: any } = {
        subId: s.id,
        email: email || '(no email)',
        name: customer.name || null,
        stripePhone: customer.phone || null,
        product,
        amount,
        amountMonthly: interval === 'year' ? Math.round((amount / 12) * 100) / 100 : amount,
        interval,
        status: s.status,
        created: s.created,
        canceledAt: s.canceled_at || null,
        cancelAtPeriodEnd: !!s.cancel_at_period_end,
        family: familyOf(product),
        isCustomDesign: /custom website design/i.test(product),
        account: accountByEmail.get(email) || null,
      };
      subs.push(row);
    }

    // Accounts that never bought anything — visible so ghosts don't hide.
    const accountsOnly = [...accountByEmail.values()].filter((a) => !emailsWithSubs.has(a.email));

    return res.status(200).json({ ok: true, generatedAt: Date.now(), subs, accountsOnly });
  } catch (err: any) {
    console.error('[admin-overview]', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to build overview' });
  }
}
