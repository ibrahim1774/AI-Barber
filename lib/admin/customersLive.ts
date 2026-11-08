// Real sources for lib/admin/customers.ts: Supabase (service role) for the main and PrimeHub Pro
// projects, Stripe list sweeps. Used by api/admin/customers.ts only; never shipped to the browser.
// Every source is read on its own: one failing table marks that source 'error' and the rest still load.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY / STRIPE_LIVE_KEY, optional
// STRIPE_WEBAPP_SECRET_KEY, and for PrimeHub Pro PRIMEHUB_PRO_SUPABASE_URL +
// PRIMEHUB_PRO_SUPABASE_SERVICE_ROLE_KEY (+ optional STRIPE_PRIMEHUB_PRO_SECRET_KEY).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { stampedSiteUrl } from '../ios/siteUrlFor.js';
import { fetchAccountId, sweepCustomers, sweepSubscriptions } from './stripeSweep.js';
import type { AuthUserLite, CustomerSources, SourceState, SourceStatus, StripePool } from './customers.js';

type Env = Record<string, string | undefined>;

async function selectAll(sb: SupabaseClient, table: string, cols: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function listUsers(sb: SupabaseClient): Promise<AuthUserLite[]> {
  const all: AuthUserLite[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    all.push(...(data.users as AuthUserLite[]));
    if (data.users.length < 200) break;
  }
  return all;
}

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function loadCustomerSources(env: Env = process.env, now = Date.now()): Promise<CustomerSources> {
  const status: SourceStatus = {};
  const run = async <T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
    try { const v = await fn(); status[name] = 'ok'; return v; } catch (e: any) {
      status[name] = 'error';
      console.error(`[admin/customers] source ${name} failed:`, String(e?.message || e).slice(0, 200));
      return fallback;
    }
  };

  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const main = url && key ? client(url, key) : null;
  const need = <T>(f: (sb: SupabaseClient) => Promise<T>) => async () => { if (!main) throw new Error('not configured'); return f(main); };

  const mainKeys = [...new Set([env.STRIPE_SECRET_KEY || env.STRIPE_LIVE_KEY, env.STRIPE_WEBAPP_SECRET_KEY].filter((k): k is string => !!k))];
  const proKeyRaw = env.STRIPE_PRIMEHUB_PRO_SECRET_KEY || null;

  // Each Stripe ACCOUNT is swept once. Different keys can open the same account (STRIPE_SECRET_KEY and
  // STRIPE_WEBAPP_SECRET_KEY do), so every distinct key asks GET /v1/account for its acct_ id and keys are
  // grouped by it. If that lookup fails the key stands for its own account (worst case: one duplicate sweep).
  // The sweeps of different accounts, and the customers/subscriptions sweeps of one account, run in parallel.
  let stripeTruncated = false;
  const accountIds = new Map<string, string>();
  const accountOf = async (k: string) => {
    if (!accountIds.has(k)) accountIds.set(k, await fetchAccountId(k).catch(() => `key:${k}`));
    return accountIds.get(k)!;
  };
  const uniqueByAccount = async (keys: string[], skip = new Set<string>()): Promise<string[]> => {
    const ids = await Promise.all(keys.map(accountOf));
    const seen = new Set(skip);
    const out: string[] = [];
    keys.forEach((k, i) => { if (!seen.has(ids[i])) { seen.add(ids[i]); out.push(k); } });
    return out;
  };
  const stripePool = async (keys: string[]): Promise<StripePool> => {
    const results = await Promise.all(keys.map(async (k) => {
      const [c, s] = await Promise.all([sweepCustomers(k), sweepSubscriptions(k)]);
      if (c.truncated || s.truncated) stripeTruncated = true;
      return { c: c.items, s: s.items };
    }));
    return { customers: results.flatMap((r) => r.c), subs: results.flatMap((r) => r.s) };
  };
  const mainAccountKeys = mainKeys.length ? await uniqueByAccount(mainKeys) : [];
  const mainAccountIds = new Set(await Promise.all(mainAccountKeys.map(accountOf)));
  const proKeys = proKeyRaw ? await uniqueByAccount([proKeyRaw], mainAccountIds) : [];

  const proUrl = env.PRIMEHUB_PRO_SUPABASE_URL;
  const proKey = env.PRIMEHUB_PRO_SUPABASE_SERVICE_ROLE_KEY;
  const proSb = proUrl && proKey ? client(proUrl, proKey) : null;

  const [users, webEntitlements, webCustomers, webSites, siteOwners, iosPurchases, iosDomains, legacySites, usersProfile, contacts, stripe, pro, proStripe] = await Promise.all([
    run('auth', [] as AuthUserLite[], need(listUsers)),
    run('webEntitlements', [] as any[], need((sb) => selectAll(sb, 'web_app_entitlements', 'stripe_subscription_id,stripe_customer_id,user_id,site_slug,tier,billing_interval,status,environment,created_at'))),
    run('webCustomers', [] as any[], need((sb) => selectAll(sb, 'web_app_customers', 'user_id,environment,stripe_customer_id'))),
    // contact_phone arrives with migration 032: fall back to the old columns until it is applied.
    run('webSites', [] as any[], need(async (sb) => {
      try { return await selectAll(sb, 'web_app_sites', 'slug,user_id,environment,removed_at,stripe_subscription_id,contact_phone'); } catch {
        return selectAll(sb, 'web_app_sites', 'slug,user_id,environment,removed_at,stripe_subscription_id');
      }
    })),
    run('siteOwners', [] as any[], need((sb) => selectAll(sb, 'site_owners', 'slug,user_id,claim_email,owner_email'))),
    run('iosPurchases', [] as any[], need((sb) => selectAll(sb, 'ios_purchases', 'original_transaction_id,product_id,environment,site_slug,user_id,expires_at,revoked_at,created_at'))),
    run('iosDomains', [] as any[], need((sb) => selectAll(sb, 'ios_domains', 'site_slug,domain,state'))),
    run('legacySites', [] as any[], need((sb) => selectAll(sb, 'sites', 'user_id,deployed_url,phone,custom_domain'))),
    run('usersProfile', [] as any[], need((sb) => selectAll(sb, 'users_profile', 'id,phone,stripe_customer_id'))),
    run('contacts', [] as any[], need((sb) => selectAll(sb, 'customer_contacts', 'user_id,phone_e164'))),
    run('stripe', { customers: [], subs: [] } as StripePool, async () => { if (!mainAccountKeys.length) throw new Error('not configured'); return stripePool(mainAccountKeys); }),
    (async () => {
      if (!proSb) { status.pro = 'skipped'; status.proContacts = 'skipped'; return undefined; }
      const p = proSb;
      let failed = false;
      const part = async <T>(fb: T, fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch (e: any) { failed = true; console.error('[admin/customers] pro source failed:', String(e?.message || e).slice(0, 200)); return fb; } };
      const [users, sites, entitlements, customers, domains] = await Promise.all([
        part([] as AuthUserLite[], () => listUsers(p)),
        part([] as any[], () => selectAll(p, 'pro_sites', 'id,user_id,environment,slug,status,paid,plan,removed_at,published_host,deployed_host,vercel_host,custom_domain')),
        part([] as any[], () => selectAll(p, 'pro_entitlements', 'stripe_subscription_id,stripe_customer_id,user_id,site_id,plan,status,environment,billing_interval,created_at')),
        part([] as any[], () => selectAll(p, 'pro_customers', 'user_id,environment,stripe_customer_id')),
        part([] as any[], () => selectAll(p, 'pro_domains', 'site_id,user_id,domain,status')),
      ]);
      const data = { users, sites, entitlements, customers, domains, contacts: [] as any[] };
      status.pro = (failed ? 'error' : 'ok') as SourceState;
      // pro_contacts arrives with the Pro phone migration (0010); until then it is simply absent.
      try { data.contacts = await selectAll(p, 'pro_contacts', 'user_id,phone_e164'); status.proContacts = 'ok'; } catch { status.proContacts = 'error'; }
      return data;
    })(),
    run('proStripe', undefined as StripePool | undefined, async () => {
      if (!proKeys.length) { status.proStripe = 'skipped'; return undefined; }
      return stripePool(proKeys);
    }),
  ]);
  if (!proKeys.length) status.proStripe = 'skipped';
  // Page caps hit: the pool is incomplete, so say so instead of looking complete.
  if (stripeTruncated) { if (status.stripe === 'ok') status.stripe = 'partial'; if (status.proStripe === 'ok') status.proStripe = 'partial'; }

  return {
    now,
    main: { users, webEntitlements, webCustomers, webSites, siteOwners, iosPurchases, iosDomains, legacySites, usersProfile, contacts },
    stripe, pro, proStripe,
    siteUrlOf: (slug) => stampedSiteUrl(slug),
    status,
  };
}
