import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ subPrice: 'price_base', subFail: false, stripe: [] as any[], group: null as string | null, groupErr: null as any, ents: [] as any[] }));

vi.mock('../../lib/webApp/webAppServer.js', () => ({
  APP_ORIGIN: () => 'https://app.test',
  webAppCors: () => false,
  webAppCheckoutOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  stripeCall: async (path: string, body: any) => { h.stripe.push({ path, body }); if (path.startsWith('subscriptions/')) { if (h.subFail) throw new Error('stripe 500'); } if (path.startsWith('subscriptions/')) return { id: 'sub_1', items: { data: [{ price: { id: h.subPrice } }] } }; return { url: 'https://portal.test/x', id: 'in_1', hosted_invoice_url: null }; },
  sbRest: async (path: string) => {
    if (path.startsWith('web_app_price_groups')) { if (h.groupErr) throw h.groupErr; return h.group ? [{ price_group: h.group }] : []; }
    if (path.startsWith('web_app_entitlements')) return h.ents;
    return [];
  },
}));

import portal from '../../api/web-app/portal.js';
import { updateUrlFor } from '../../lib/webApp/dunning.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const callPortal = async () => { const r = res(); await portal({ method: 'POST', headers: { authorization: 'Bearer t' } }, r); return r; };
const sessionCall = () => h.stripe.find((c) => c.path === 'billing_portal/sessions');

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
  vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG', 'bpc_base');
  vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G10', 'bpc_g10');
  vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G20', 'bpc_g20');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_WEBSITE_MONTH', 'price_base');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_G10_WEBSITE_MONTH', 'price_g10');
  h.stripe = []; h.group = null; h.groupErr = null; h.subFail = false; h.subPrice = 'price_base'; h.ents = [{ stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', status: 'active' }];
});

describe('portal: configuration per price group', () => {
  it('no stored group: base configuration', async () => {
    const r = await callPortal();
    expect(r.code).toBe(200); expect(sessionCall().body.configuration).toBe('bpc_base');
  });
  it('g10 and g20 subscribers get their own configuration', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PRICE_G20_WEBSITE_MONTH', 'price_g20');
    h.group = 'g10'; h.subPrice = 'price_g10'; await callPortal(); expect(sessionCall().body.configuration).toBe('bpc_g10');
    h.stripe = []; h.group = 'g20'; h.subPrice = 'price_g20'; await callPortal(); expect(sessionCall().body.configuration).toBe('bpc_g20');
  });
  it('stored group differing from the subscription price group: 409 price_group_mismatch, no portal session', async () => {
    h.group = 'g10'; h.subPrice = 'price_base';
    const r = await callPortal();
    expect(r.code).toBe(409); expect(r.body).toEqual({ error: 'price_group_mismatch' });
    expect(sessionCall()).toBeUndefined();
    h.group = null; h.subPrice = 'price_g10'; // no stored group = base, but the sub is g10
    expect((await callPortal()).code).toBe(409);
  });
  it('unrecognised price + no stored group: unchanged base behaviour (base configuration)', async () => {
    h.subPrice = 'price_old_base';
    const r = await callPortal();
    expect(r.code).toBe(200); expect(sessionCall().body.configuration).toBe('bpc_base');
  });
  it('unrecognised price + stored test group: fails closed (409), no session', async () => {
    h.subPrice = 'price_old_base'; h.group = 'g10';
    const r = await callPortal();
    expect(r.code).toBe(409); expect(sessionCall()).toBeUndefined();
  });
  it('base subscriber: a Stripe subscription lookup failure still gets the base configuration', async () => {
    h.subFail = true;
    const r = await callPortal();
    expect(r.code).toBe(200); expect(sessionCall().body.configuration).toBe('bpc_base');
  });
  it('g10 with the group configuration missing fails closed, never the base configuration', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G10', '');
    h.group = 'g10'; h.subPrice = 'price_g10';
    const r = await callPortal();
    expect(r.code).toBe(500); expect(r.body).toEqual({ error: 'portal_not_configured' });
    expect(sessionCall()).toBeUndefined();
  });
  it('base with no configuration still fails closed as before', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG', '');
    expect((await callPortal()).body).toEqual({ error: 'portal_not_configured' });
  });
  it('a missing price-groups table (404) reads as base', async () => {
    h.groupErr = Object.assign(new Error('supabase 404'), { status: 404 });
    const r = await callPortal();
    expect(r.code).toBe(200); expect(sessionCall().body.configuration).toBe('bpc_base');
  });
  it('another lookup failure is 502 portal_failed (no guess)', async () => {
    h.groupErr = Object.assign(new Error('supabase 500'), { status: 500 });
    const r = await callPortal();
    expect(r.code).toBe(502); expect(sessionCall()).toBeUndefined();
  });
});

describe('dunning portal link: configuration follows the subscription price group', () => {
  const sub = (price: string) => ({ customer: 'cus_1', latest_invoice: 'in_1', items: { data: [{ price: { id: price } }] } });
  it('g10 price -> g10 configuration', async () => {
    await updateUrlFor(sub('price_g10'));
    expect(sessionCall().body.configuration).toBe('bpc_g10');
  });
  it('g10 price with its configuration missing -> no link, no session, never base', async () => {
    vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG_G10', '');
    expect(await updateUrlFor(sub('price_g10'))).toBeNull();
    expect(sessionCall()).toBeUndefined();
  });
  it('base price -> base configuration; with none set the default portal is still used', async () => {
    await updateUrlFor(sub('price_base'));
    expect(sessionCall().body.configuration).toBe('bpc_base');
    h.stripe = []; vi.stubEnv('STRIPE_WEBAPP_PORTAL_CONFIG', '');
    await updateUrlFor(sub('price_base'));
    expect(sessionCall().body).toEqual({ customer: 'cus_1' });
  });
});
