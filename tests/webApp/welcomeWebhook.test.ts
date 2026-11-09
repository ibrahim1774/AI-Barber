import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sb = vi.hoisted(() => ({ calls: [] as any[], mode: 'reject' as 'reject' | 'hang' }));
const sent = vi.hoisted(() => ({ send: vi.fn(async () => 'id'), welcome: vi.fn((i: any) => ({ subject: 's', html: '', text: '', i })) }));

vi.mock('../../lib/webApp/emails.js', () => ({ sendMail: sent.send, welcomeEmail: sent.welcome }));
vi.mock('../../lib/webApp/duplicates.js', () => ({ handleDuplicates: vi.fn(async () => ({})), liveDupDeps: () => ({}) }));
vi.mock('../../lib/ios/siteUrlFor.js', () => ({ stampedSiteUrl: async (s: string) => `https://${s}.vercel.app` }));
vi.mock('../../lib/webApp/stripeCore.js', async (orig) => ({ ...(await orig<any>()), verifyStripeSignature: () => true }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true,
  readRawBody: async () => JSON.stringify({ type: 'customer.subscription.created', livemode: false, data: { object: { id: 'sub_1', metadata: { app: 'aibarber-app' } } } }),
  stripeCall: async () => ({ id: 'sub_1', status: 'active', customer: 'cus_1', livemode: false, metadata: { app: 'aibarber-app', user_id: 'u1', tier: 'bookings' }, items: { data: [{ price: { id: 'price_x' } }] } }),
  sbRest: async (path: string, init: any = {}) => {
    sb.calls.push({ path, ...init });
    if (path.startsWith('web_app_sites?')) { if (sb.mode === 'hang') return new Promise(() => {}); throw new Error('db down'); }
    if (path.includes('welcome_sent_at=is.null')) return [{}];
    return [];
  },
}));

import webhook from '../../api/web-app/webhook.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('STRIPE_WEBAPP_WEBHOOK_SECRET', 'whsec');
  vi.stubEnv('STRIPE_WEBAPP_PRICE_BOOKINGS_MONTH', 'price_x');
  vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ email: 'a@b.co', user_metadata: {} }) })));
  sb.calls.length = 0; sent.send.mockClear(); sent.welcome.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const post = async () => { const r = res(); await webhook({ method: 'POST', headers: { 'stripe-signature': 't' } }, r); return r; };

describe('welcome mail in the Stripe webhook when the live-site lookup is down', () => {
  it('lookup rejects: 200, welcome sent without a site link, lookup scoped to user + test env', async () => {
    sb.mode = 'reject';
    const r = await post();
    expect(r.code).toBe(200);
    expect(sent.welcome).toHaveBeenCalledTimes(1);
    expect(sent.welcome.mock.calls[0][0]).toMatchObject({ email: 'a@b.co', siteUrl: null, tier: 'bookings' });
    expect(sent.send).toHaveBeenCalledTimes(1);
    const q = sb.calls.find((c) => c.path.startsWith('web_app_sites?'))!.path as string;
    expect(q).toContain('user_id=eq.u1'); expect(q).toContain('environment=eq.test');
  });
  it('lookup hangs: after ~3 s the webhook still answers 200 and the welcome goes out without the link', async () => {
    sb.mode = 'hang'; vi.useFakeTimers();
    const p = post();
    await vi.advanceTimersByTimeAsync(3_100);
    const r = await p;
    expect(r.code).toBe(200);
    expect(sent.welcome.mock.calls[0][0]).toMatchObject({ siteUrl: null });
    expect(sent.send).toHaveBeenCalledTimes(1);
  });
});
