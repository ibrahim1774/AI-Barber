import { describe, it, expect, vi } from 'vitest';
import { buildCustomerRows, type CustomerSources, type MainData } from '../../lib/admin/customers.js';

const NOW = Date.parse('2026-11-08T00:00:00Z');
const empty = (): MainData => ({ users: [], webEntitlements: [], webCustomers: [], webSites: [], siteOwners: [], iosPurchases: [], iosDomains: [], legacySites: [], usersProfile: [], contacts: [] });
const user = (id: string, email: string, extra: any = {}) => ({ id, email, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: '2026-11-01T00:00:00Z', identities: [{ provider: 'email', identity_data: { email } }], ...extra });
const sub = (id: string, cus: any, product: string, over: any = {}) => ({ id, status: 'active', created: 1_760_000_000, customer: cus, plan: { interval: 'month', product: { name: product } }, ...over });

function sources(over: any = {}): CustomerSources {
  const { main, ...rest } = over;
  return {
    now: NOW, main: { ...empty(), ...main }, stripe: { customers: [], subs: [] },
    siteUrlOf: async (slug) => `https://${slug}.vercel.app`, status: { auth: 'ok' }, ...rest,
  } as CustomerSources;
}
const byKey = (rows: any[], k: string) => rows.find((r) => r.key === k);

describe('buildCustomerRows', () => {
  it('web buyer with a custom domain: domain beats the stamped address, web plan beats a legacy sub', async () => {
    const siteUrlOf = vi.fn(async (s: string) => `https://${s}.vercel.app`);
    const rows = await buildCustomerRows(sources({
      siteUrlOf,
      main: {
        users: [user('u1', 'mike@x.com')],
        webEntitlements: [{ stripe_subscription_id: 'sub_w', stripe_customer_id: 'cus_1', user_id: 'u1', site_slug: 'fade-lab', tier: 'bookings', billing_interval: 'year', status: 'active', environment: 'live' }],
        webSites: [{ slug: 'fade-lab', user_id: 'u1', environment: 'live', removed_at: null }],
        iosDomains: [{ site_slug: 'fade-lab', domain: 'Fadelab.com', state: 'live' }],
      },
      stripe: { customers: [{ id: 'cus_1', email: 'billing@x.com' }], subs: [sub('sub_w', 'cus_1', 'Prime Barber Bookings'), sub('sub_old', 'cus_1', 'AI Barber Website', { status: 'canceled' })] },
    }));
    const r = byKey(rows, 'main:u1');
    expect(r).toMatchObject({ family: 'primebarber-web', plan: 'bookings', interval: 'year', status: 'active', customDomain: 'fadelab.com', siteUrl: 'https://fadelab.com', siteSlug: 'fade-lab',
      accountEmail: 'mike@x.com', stripeEmail: 'billing@x.com', contactEmail: 'billing@x.com', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_w', authKind: 'password' });
    expect(r.stripeCustomerUrl).toBe('https://dashboard.stripe.com/customers/cus_1');
    expect(r.alsoPlans).toEqual([{ source: 'legacy', plan: 'AI Barber Website', interval: 'month', status: 'canceled' }]);
    expect(siteUrlOf).not.toHaveBeenCalled(); // custom domain: no stamp lookup
  });

  it('domain states: only live / attached / manual_live count; otherwise the stamped address', async () => {
    const mk = (state: string) => sources({ main: {
      users: [user('u1', 'a@x.com')],
      webEntitlements: [{ stripe_subscription_id: 's', stripe_customer_id: 'c', user_id: 'u1', site_slug: 'a-site', tier: 'website', billing_interval: 'month', status: 'active', environment: 'live' }],
      webSites: [{ slug: 'a-site', user_id: 'u1', removed_at: null }],
      iosDomains: [{ site_slug: 'a-site', domain: 'a.com', state }],
    } });
    expect((await buildCustomerRows(mk('manual_live')))[0].siteUrl).toBe('https://a.com');
    expect((await buildCustomerRows(mk('attached')))[0].siteUrl).toBe('https://a.com');
    expect((await buildCustomerRows(mk('failed')))[0].siteUrl).toBe('https://a-site.vercel.app');
  });

  it('iOS buyer: plan from ios_purchases, expiry decides status, iOS slug gives the address', async () => {
    const rows = await buildCustomerRows(sources({ main: {
      users: [user('u2', 'ios@x.com', { phone: '15125550100' })],
      iosPurchases: [{ original_transaction_id: 'otid', product_id: 'store_monthly', environment: 'Production', site_slug: 'ios-shop', user_id: 'u2', expires_at: '2026-12-01T00:00:00Z', revoked_at: null }],
    } }));
    expect(rows[0]).toMatchObject({ family: 'ios', plan: 'store_monthly', status: 'active', siteSlug: 'ios-shop', siteUrl: 'https://ios-shop.vercel.app', stripeSubscriptionId: null, phone: '+15125550100', phoneSource: 'auth' });
    const expired = await buildCustomerRows(sources({ main: { users: [user('u2', 'ios@x.com')], iosPurchases: [{ original_transaction_id: 'o', product_id: 'p', environment: 'Production', user_id: 'u2', expires_at: '2026-01-01T00:00:00Z' }] } }));
    expect(expired[0].status).toBe('expired');
  });

  it('web beats iOS when both are live; the other shows in alsoPlans', async () => {
    const rows = await buildCustomerRows(sources({ main: {
      users: [user('u1', 'both@x.com')],
      webEntitlements: [{ stripe_subscription_id: 's', stripe_customer_id: 'c', user_id: 'u1', site_slug: 'w', tier: 'website', billing_interval: 'month', status: 'active', environment: 'live' }],
      iosPurchases: [{ original_transaction_id: 'o', product_id: 'p', environment: 'Production', site_slug: 'i', user_id: 'u1', expires_at: '2027-01-01T00:00:00Z' }],
    } }));
    expect(rows[0].family).toBe('primebarber-web');
    expect(rows[0].alsoPlans).toEqual([{ source: 'ios', plan: 'p', interval: null, status: 'active' }]);
  });

  it('legacy site customer joins Stripe by email, takes the legacy phone and deployed_url, family from the product', async () => {
    const rows = await buildCustomerRows(sources({
      main: { users: [user('u3', 'Old@Shop.com')], legacySites: [{ user_id: 'u3', phone: '555 123 4567', deployed_url: 'https://old-shop.vercel.app', custom_domain: null }] },
      stripe: { customers: [{ id: 'cus_o', email: 'old@shop.com' }], subs: [sub('sub_o', 'cus_o', 'AI Barber Website')] },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ family: 'aibarber-legacy', plan: 'AI Barber Website', phone: '+15551234567', phoneSource: 'legacy-site', siteUrl: 'https://old-shop.vercel.app', stripeCustomerId: 'cus_o', accountEmail: 'old@shop.com' });
  });

  it('PrimeHub and custom-design products classify; other businesses on the account are ignored', async () => {
    const rows = await buildCustomerRows(sources({
      stripe: { customers: [{ id: 'c1', email: 'a@x.com' }, { id: 'c2', email: 'b@x.com' }, { id: 'c3', email: 'c@x.com' }], subs: [
        sub('s1', 'c1', 'PrimeHub Website'), sub('s2', 'c2', 'Custom website design'), sub('s3', 'c3', 'Ariya Salon'),
      ] },
    }));
    expect(rows.map((r) => r.family).sort()).toEqual(['custom-design', 'primehub-legacy']);
  });

  it('Stripe-only customer gets its own no-account row with the manual phone and site; abandoned checkouts (no sub) are skipped', async () => {
    const rows = await buildCustomerRows(sources({
      stripe: { customers: [{ id: 'cus_m', email: 'medrano8@gmail.com' }, { id: 'cus_nosub', email: 'ghost@x.com' }], subs: [sub('sub_m', { id: 'cus_m', email: 'medrano8@gmail.com' }, 'AI Barber Website')] },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'main:stripe:cus_m', userId: null, phone: '+18572057123', phoneSource: 'manual', siteUrl: 'https://www.euphoriabarbers.com', authKind: 'none' });
    expect(rows[0].flags).toContain('no-account');
  });

  it('phone precedence: contact > auth > metadata > web site > legacy site > profile > stripe > manual', async () => {
    const mk = (parts: { contact?: string; auth?: string; meta?: string; site?: string; legacy?: string; profile?: string; stripe?: string }) => buildCustomerRows(sources({
      main: {
        users: [user('u', 'medrano8@gmail.com', { phone: parts.auth, user_metadata: { phone: parts.meta } })],
        contacts: parts.contact ? [{ user_id: 'u', phone_e164: parts.contact }] : [],
        webSites: parts.site ? [{ slug: 's', user_id: 'u', removed_at: null, contact_phone: parts.site }] : [],
        legacySites: parts.legacy ? [{ user_id: 'u', phone: parts.legacy }] : [],
        usersProfile: parts.profile ? [{ id: 'u', phone: parts.profile }] : [],
      },
      stripe: { customers: parts.stripe ? [{ id: 'c', email: 'medrano8@gmail.com', phone: parts.stripe }] : [], subs: [] },
    }));
    const chain: Array<[Record<string, string>, string, string]> = [
      [{ contact: '+12025550001', auth: '12025550002', meta: '2025550003' }, '+12025550001', 'contact'],
      [{ auth: '12025550002', meta: '2025550003' }, '+12025550002', 'auth'],
      [{ meta: '(202) 555-0003', site: '2025550004' }, '+12025550003', 'metadata'],
      [{ site: '2025550004', legacy: '2025550005' }, '+12025550004', 'site'],
      [{ legacy: '2025550005', profile: '2025550006' }, '+12025550005', 'legacy-site'],
      [{ profile: '2025550006', stripe: '2025550007' }, '+12025550006', 'profile'],
      [{ stripe: '2025550007' }, '+12025550007', 'stripe'],
      [{}, '+18572057123', 'manual'],
    ];
    for (const [parts, phone, src] of chain) {
      const rows = await mk(parts);
      expect([rows[0].phone, rows[0].phoneSource]).toEqual([phone, src]);
    }
    const none = await buildCustomerRows(sources({ main: { users: [user('n', 'none@x.com')] } }));
    expect(none[0]).toMatchObject({ phone: null, phoneSource: null });
    expect(none[0].flags).toContain('no-phone');
  });

  it('PrimeHub Pro buyer is its own project row; separate from a same-email main account; OTP login', async () => {
    const rows = await buildCustomerRows(sources({
      main: { users: [user('m1', 'pro@x.com')] },
      stripe: { customers: [{ id: 'cus_p', email: 'pro@x.com', phone: '2025550100' }], subs: [] },
      pro: {
        users: [user('p1', 'pro@x.com')],
        sites: [{ id: 'site1', user_id: 'p1', status: 'published', paid: true, slug: 'joes-roofing', published_host: 'joes-roofing.primehub.site', custom_domain: null }],
        entitlements: [{ stripe_subscription_id: 'sub_p', stripe_customer_id: 'cus_p', user_id: 'p1', site_id: 'site1', plan: 'leads', status: 'active', environment: 'live', billing_interval: 'month' }],
        customers: [], domains: [], contacts: [],
      },
    }));
    expect(rows.map((r) => r.key).sort()).toEqual(['main:m1', 'pro:p1']);
    const p = byKey(rows, 'pro:p1');
    expect(p).toMatchObject({ family: 'primehub-pro', project: 'pro', plan: 'leads', status: 'active', siteUrl: 'https://joes-roofing.primehub.site', siteSlug: 'joes-roofing', authKind: 'otp', phone: '+12025550100', phoneSource: 'stripe', stripeSubscriptionId: 'sub_p' });
    expect(byKey(rows, 'main:m1').family).toBe('account-only');
    expect(byKey(rows, 'main:m1').stripeCustomerId).toBeNull(); // the Pro customer is not claimed by the main account
  });

  it('a Pro custom domain from pro_domains wins over the published host', async () => {
    const rows = await buildCustomerRows(sources({
      pro: { users: [user('p1', 'a@x.com')], sites: [{ id: 's1', user_id: 'p1', status: 'published', slug: 'abc', published_host: 'abc.primehub.site' }], entitlements: [], customers: [], contacts: [], domains: [{ site_id: 's1', status: 'live', domain: 'abc.com' }] },
    }));
    expect(rows[0]).toMatchObject({ customDomain: 'abc.com', siteUrl: 'https://abc.com' });
  });

  it('duplicate contact emails are flagged on every row of the group', async () => {
    const rows = await buildCustomerRows(sources({
      main: { users: [user('a', 'same@x.com'), user('b', 'SAME@x.com'), user('c', 'other@x.com')] },
    }));
    expect(byKey(rows, 'main:a').flags).toContain('dup-email');
    expect(byKey(rows, 'main:b').flags).toContain('dup-email');
    expect(byKey(rows, 'main:c').flags).not.toContain('dup-email');
  });

  it('signup email: first identity, then metadata, then the site owner claim email', async () => {
    const rows = await buildCustomerRows(sources({ main: {
      users: [
        user('a', 'acct@x.com', { identities: [{ provider: 'google', identity_data: { email: 'g@x.com' } }] }),
        user('b', 'b@x.com', { identities: [], user_metadata: { email: 'meta@x.com' } }),
        user('c', 'c@x.com', { identities: [] }),
      ],
      siteOwners: [{ slug: 's', user_id: 'c', claim_email: 'Claim@x.com' }],
    } }));
    expect(byKey(rows, 'main:a')).toMatchObject({ signupEmail: 'g@x.com', authKind: 'google' });
    expect(byKey(rows, 'main:b').signupEmail).toBe('meta@x.com');
    expect(byKey(rows, 'main:c').signupEmail).toBe('claim@x.com');
  });

  it('site address lookups are cached per slug and run at most 8 at a time; a failing lookup falls through', async () => {
    let live = 0, peak = 0;
    const calls: string[] = [];
    const siteUrlOf = async (slug: string) => {
      calls.push(slug); live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5)); live--;
      if (slug === 'boom') throw new Error('gcs down');
      return `https://${slug}.vercel.app`;
    };
    const users = Array.from({ length: 20 }, (_, i) => user(`u${i}`, `u${i}@x.com`));
    const ios = users.map((u, i) => ({ original_transaction_id: `o${i}`, product_id: 'p', environment: 'Production', site_slug: i === 0 ? 'boom' : `s${i % 10}`, user_id: u.id, expires_at: '2027-01-01T00:00:00Z' }));
    const rows = await buildCustomerRows(sources({ siteUrlOf, main: { users, iosPurchases: ios, legacySites: [{ user_id: 'u0', deployed_url: 'https://legacy-u0.vercel.app' }] } }));
    expect(peak).toBeLessThanOrEqual(8);
    expect(new Set(calls).size).toBe(calls.length); // one call per distinct slug
    expect(byKey(rows, 'main:u0').siteUrl).toBe('https://legacy-u0.vercel.app');
  });

  it('never carries secrets from source rows into the output', async () => {
    const rows = await buildCustomerRows(sources({ main: {
      users: [user('a', 'a@x.com', { app_metadata: { provider: 'email', secret: 'APPSECRET' }, user_metadata: { portal_password: 'hunter2', phone: '2025550100' } })],
      legacySites: [{ user_id: 'a', phone: '', deployed_url: 'https://s.vercel.app', portal_password: 'hunter3', api_key: 'sk_live_x' }],
    } }));
    const s = JSON.stringify(rows);
    for (const bad of ['hunter2', 'hunter3', 'sk_live_x', 'APPSECRET']) expect(s).not.toContain(bad);
  });

  it('free-text phones are skipped down the chain; a manual note is kept; all-junk gives no-phone', async () => {
    const rows = await buildCustomerRows(sources({
      main: { users: [user('u', 'x@x.com', { user_metadata: { phone: 'n/a' } }), user('v', 'v@x.com', { user_metadata: { phone: '123' } })],
        legacySites: [{ user_id: 'u', phone: '2025550009' }] },
    }));
    expect(byKey(rows, 'main:u')).toMatchObject({ phone: '+12025550009', phoneSource: 'legacy-site' });
    expect(byKey(rows, 'main:v')).toMatchObject({ phone: null, phoneSource: null });
    expect(byKey(rows, 'main:v').flags).toContain('no-phone');
  });

  it('degraded sources: no Stripe-only rows when auth failed, no legacy reclassification when entitlements failed, no primehub-legacy when Pro failed', async () => {
    const stripe = { customers: [{ id: 'c1', email: 'a@x.com' }, { id: 'c2', email: 'b@x.com' }], subs: [sub('s1', 'c1', 'PrimeHub Website'), sub('s2', 'c2', 'AI Barber Website')] };
    expect(await buildCustomerRows(sources({ stripe, status: { auth: 'error' } }))).toEqual([]);
    expect(await buildCustomerRows(sources({ stripe, status: { auth: 'ok', webEntitlements: 'error' } }))).toEqual([]);
    const pro = await buildCustomerRows(sources({ stripe, status: { auth: 'ok', pro: 'error' } }));
    expect(pro.map((r) => r.family)).toEqual(['aibarber-legacy']);
    // web sub whose entitlement table is down must not appear as a legacy plan on the user
    const rows = await buildCustomerRows(sources({
      main: { users: [user('u1', 'a@x.com')], webCustomers: [{ user_id: 'u1', stripe_customer_id: 'c2' }] },
      stripe, status: { auth: 'ok', webEntitlements: 'error' },
    }));
    expect(rows[0].plan).toBeNull();
  });

  it('isDegraded: error and partial count, skipped and ok do not', async () => {
    const { isDegraded } = await import('../../lib/admin/customers.js');
    expect(isDegraded({ a: 'ok', b: 'skipped' })).toBe(false);
    expect(isDegraded({ a: 'ok', b: 'partial' })).toBe(true);
    expect(isDegraded({ b: 'error' })).toBe(true);
  });
});
