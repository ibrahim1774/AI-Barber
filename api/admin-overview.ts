import { createClient } from '@supabase/supabase-js';
import { checkAdmin, supabaseEmailOf } from '../lib/admin/auth.js';
import { MANUAL_IDENTITIES, CLIENT_SITE_CONTACTS } from '../lib/admin/manualIdentities.js';
import { fetchAllSubscriptions } from '../lib/admin/stripeSweep.js';
import { familyOf, isCustomDesignProduct } from '../lib/admin/families.js';

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
  page: string;            // subpage the checkout was opened from ('' pre-dates the change)
  isCustomDesign: boolean;
  paidCount: number;       // successfully paid non-zero invoices
}

// Count of successfully-paid, non-zero invoices per subscription — one
// global sweep over paid invoices instead of a call per subscription.
async function fetchPaidCounts(stripeKey: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let startingAfter: string | null = null;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: '100', status: 'paid' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const resp = await fetch(`https://api.stripe.com/v1/invoices?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!resp.ok) throw new Error(`Stripe invoices list failed (${resp.status})`);
    const data = await resp.json();
    for (const inv of data.data || []) {
      if (inv.subscription && (inv.amount_paid || 0) > 0) {
        counts[inv.subscription] = (counts[inv.subscription] || 0) + 1;
      }
    }
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return counts;
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

  const admin = createClient(supabaseUrl, serviceKey);
  const auth = await checkAdmin(req.headers.authorization, supabaseEmailOf(admin));
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  try {
    // Three sources in parallel: Stripe subs, auth users, sites rows.
    const [stripeSubs, paidCounts, users, sitesResult] = await Promise.all([
      fetchAllSubscriptions(stripeKey),
      fetchPaidCounts(stripeKey),
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

    // Hand-verified identities for generic-named subs (owner-confirmed
    // 2026-07-18 by matching each phone against the live site's tel: buttons).
    // These customers paid via Stripe but have no Supabase account under that
    // email, so the email join can't fill phone/site — filled manually.

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
      const row: SubRow & { account: any; manualPhone: string | null; manualSite: string | null; manualLabel: string | null } = {
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
        // Which subpage the sale came from. Product names no longer encode
        // it (receipts shouldn't advertise the price test), so this is the
        // signal — present only on subscriptions created after that change.
        page: s.metadata?.page || '',
        isCustomDesign: isCustomDesignProduct(product),
        paidCount: paidCounts[s.id] || 0,
        account: accountByEmail.get(email) || null,
        manualPhone: MANUAL_IDENTITIES[email]?.phone || null,
        manualSite: MANUAL_IDENTITIES[email]?.site || null,
        manualLabel: MANUAL_IDENTITIES[email]?.label || null,
      };
      subs.push(row);
    }

    // Accounts that never bought anything — visible so ghosts don't hide.
    const accountsOnly = [...accountByEmail.values()].filter((a) => !emailsWithSubs.has(a.email));

    // Client Sites portal (/edit) logins. These accounts are created FOR the
    // client during onboarding, so the password we issued is stored on the
    // row — this is the only place it can be looked up again. Service-role
    // read: the credential columns are revoked from `authenticated`, so they
    // never reach a client's browser. Non-fatal if the table/columns are
    // missing (the SQL migration may not have been run yet).
    let clientSites: any[] = [];
    try {
      const { data: csRows } = await admin
        .from('client_sites')
        .select('slug, name, live_url, owner, portal_password, password_issued_at, created_at')
        .order('created_at', { ascending: true });
      const userById = new Map(users.map((u: any) => [u.id, u]));
      // Contact person + mobile per portal site (owner-supplied; the table
      // has no contact columns, so this lives here like MANUAL_IDENTITIES).
      clientSites = (csRows || []).map((r: any) => {
        const owner = r.owner ? userById.get(r.owner) : null;
        return {
          slug: r.slug,
          contact: CLIENT_SITE_CONTACTS[r.slug]?.contact || null,
          phone: CLIENT_SITE_CONTACTS[r.slug]?.phone || null,
          name: r.name,
          liveUrl: r.live_url,
          email: owner?.email || null,
          password: r.portal_password || null,
          passwordIssuedAt: r.password_issued_at || null,
          lastSignIn: owner?.last_sign_in_at || null,
          onboardedAt: r.created_at,
        };
      });
    } catch (csErr: any) {
      console.warn('[admin-overview] client_sites read skipped:', csErr?.message);
    }

    return res.status(200).json({ ok: true, generatedAt: Date.now(), subs, accountsOnly, clientSites });
  } catch (err: any) {
    console.error('[admin-overview]', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to build overview' });
  }
}
