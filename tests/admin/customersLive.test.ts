import { describe, it, expect, vi, beforeEach } from 'vitest';

const failing = new Set<string>();
const urls: string[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string) => {
    urls.push(url);
    return {
      auth: { admin: { listUsers: async () => (failing.has('auth') ? { data: null, error: new Error('boom') } : { data: { users: [{ id: 'u1', email: 'a@x.com' }] }, error: null }) } },
      from: (table: string) => ({
        select: () => ({
          range: async () => (failing.has(table) ? { data: null, error: { message: 'relation missing' } } : { data: table === 'web_app_entitlements' ? [{ user_id: 'u1' }] : [], error: null }),
        }),
      }),
    };
  },
}));
const sweeps: string[] = [];
const accounts: Record<string, string> = {};
vi.mock('../../lib/admin/stripeSweep.js', () => ({
  fetchAccountId: vi.fn(async (k: string) => { if (!accounts[k]) throw new Error('no'); return accounts[k]; }),
  sweepCustomers: vi.fn(async (k: string) => { sweeps.push(`c:${k}`); if (failing.has('stripe')) throw new Error('stripe 500'); return { items: [{ id: 'cus_1' }], truncated: failing.has('truncate') }; }),
  sweepSubscriptions: vi.fn(async (k: string) => { sweeps.push(`s:${k}`); return { items: [], truncated: false }; }),
}));
vi.mock('../../lib/ios/siteUrlFor.js', () => ({ stampedSiteUrl: async (s: string) => `https://${s}.vercel.app` }));

import { loadCustomerSources } from '../../lib/admin/customersLive.js';
import { buildCustomerRows } from '../../lib/admin/customers.js';

const ENV = { SUPABASE_URL: 'https://main.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', STRIPE_SECRET_KEY: 'sk_test_x' };
beforeEach(() => { failing.clear(); urls.length = 0; sweeps.length = 0; for (const k of Object.keys(accounts)) delete accounts[k]; });

describe('loadCustomerSources', () => {
  it('everything up: all sources ok, Pro skipped without env', async () => {
    const s = await loadCustomerSources(ENV);
    expect(s.status).toMatchObject({ auth: 'ok', webEntitlements: 'ok', iosPurchases: 'ok', contacts: 'ok', stripe: 'ok', pro: 'skipped', proStripe: 'skipped' });
    expect(s.main.users).toHaveLength(1);
    expect(s.main.webEntitlements).toHaveLength(1);
  });

  it('partial failures are reported per source, do not throw, and the rest still builds rows', async () => {
    failing.add('ios_purchases'); failing.add('customer_contacts'); failing.add('stripe');
    const s = await loadCustomerSources(ENV);
    expect(s.status).toMatchObject({ iosPurchases: 'error', contacts: 'error', stripe: 'error', auth: 'ok', webEntitlements: 'ok' });
    const rows = await buildCustomerRows(s);
    expect(rows.map((r) => r.key)).toEqual(['main:u1']);
  });

  it('a failing auth listing yields no rows but no throw', async () => {
    failing.add('auth');
    const s = await loadCustomerSources(ENV);
    expect(s.status.auth).toBe('error');
    expect(await buildCustomerRows(s)).toEqual([]);
  });

  it('missing main config marks every main source as error instead of throwing', async () => {
    const s = await loadCustomerSources({});
    expect(s.status.auth).toBe('error');
    expect(s.status.stripe).toBe('error');
  });

  it('Pro is read from its own project when configured; one failing Pro table marks pro as error', async () => {
    const ok = await loadCustomerSources({ ...ENV, PRIMEHUB_PRO_SUPABASE_URL: 'https://pro.supabase.co', PRIMEHUB_PRO_SUPABASE_SERVICE_ROLE_KEY: 'pk' });
    expect(ok.status.pro).toBe('ok');
    expect(ok.pro?.users).toHaveLength(1);
    expect(urls).toContain('https://pro.supabase.co');
    failing.add('pro_sites');
    const bad = await loadCustomerSources({ ...ENV, PRIMEHUB_PRO_SUPABASE_URL: 'https://pro.supabase.co', PRIMEHUB_PRO_SUPABASE_SERVICE_ROLE_KEY: 'pk' });
    expect(bad.status.pro).toBe('error');
    expect(bad.status.proContacts).toBe('ok');
  });

  it('a separate Pro Stripe key is swept only when it differs from the main key', async () => {
    const same = await loadCustomerSources({ ...ENV, STRIPE_PRIMEHUB_PRO_SECRET_KEY: 'sk_test_x' });
    expect(same.status.proStripe).toBe('skipped');
    const diff = await loadCustomerSources({ ...ENV, STRIPE_PRIMEHUB_PRO_SECRET_KEY: 'sk_test_pro' });
    expect(diff.status.proStripe).toBe('ok');
  });

  it('keys that open the same Stripe account are swept once (grouped by acct id), incl. the Pro key', async () => {
    Object.assign(accounts, { sk_a: 'acct_1', sk_b: 'acct_1', sk_pro: 'acct_1', sk_other: 'acct_2' });
    const s = await loadCustomerSources({ ...ENV, STRIPE_SECRET_KEY: 'sk_a', STRIPE_WEBAPP_SECRET_KEY: 'sk_b', STRIPE_PRIMEHUB_PRO_SECRET_KEY: 'sk_pro' });
    expect(sweeps.sort()).toEqual(['c:sk_a', 's:sk_a']);
    expect(s.status.proStripe).toBe('skipped');
    sweeps.length = 0;
    const t = await loadCustomerSources({ ...ENV, STRIPE_SECRET_KEY: 'sk_a', STRIPE_PRIMEHUB_PRO_SECRET_KEY: 'sk_other' });
    expect(sweeps.sort()).toEqual(['c:sk_a', 'c:sk_other', 's:sk_a', 's:sk_other']);
    expect(t.status.proStripe).toBe('ok');
  });

  it('when the account lookup fails, distinct keys are swept separately (fallback: key equality)', async () => {
    await loadCustomerSources({ ...ENV, STRIPE_SECRET_KEY: 'sk_a', STRIPE_WEBAPP_SECRET_KEY: 'sk_b' });
    expect(sweeps.filter((x) => x.startsWith('c:')).sort()).toEqual(['c:sk_a', 'c:sk_b']);
  });

  it('a truncated sweep reports stripe as partial', async () => {
    failing.add('truncate');
    const s = await loadCustomerSources(ENV);
    expect(s.status.stripe).toBe('partial');
  });
});
