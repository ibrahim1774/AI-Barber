// WEB_APPLE_VIEW_ONLY on the drafted publish endpoint: an Apple account (even one that also pays a card plan) gets 403 app-store-account
// before any intent row or lease exists. Off: nothing new is read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ios: [] as any[], sites: [] as any[], ent: [] as any[], calls: [] as string[], failIos: false, prepared: 0, ran: 0 }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<any>()),
  webAppEntitlementsOn: () => true, authOutage: () => false,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  sbRest: async (path: string, init: any = {}) => {
    h.calls.push(`${init.method ?? 'GET'} ${path}`);
    if (path.startsWith('ios_purchases?')) { if (h.failIos) throw new Error('down'); return h.ios; }
    if (path.startsWith('web_app_sites?')) return h.sites;
    if (path.startsWith('web_app_entitlements?')) return h.ent.length ? [h.ent[0]] : [];
    if (path.startsWith('web_app_price_groups?')) return [{ price_group: 'base' }];
    if (path.startsWith('web_app_publish_intents?')) return [{ status: 'live', result: { body: { ok: true } } }];
    return [];
  },
}));
vi.mock('../../lib/webApp/reliability.js', async (orig) => ({
  ...(await orig<any>()),
  reliabilityOn: () => true,
  readDraft: async () => null,
  prepareIntent: async () => { h.prepared++; return { id: 'job1' }; },
}));
vi.mock('../../lib/webApp/publishJobs.js', () => ({ runJob: async () => { h.ran++; }, dispatchJob: () => {} }));
vi.mock('../../lib/bookings/rateLimit.js', () => ({ clientIp: () => '1.1.1.1', iosLimiter: { allow: async () => true } }));

import publish from '../../api/web-app/publish.js';

const P = 'com.ibrahim1774.aibarber.';
const apple = () => ({ original_transaction_id: '2000000000001', product_id: `${P}bookings.monthly`, environment: 'Production', user_id: 'u1', site_slug: 'fresh-cuts', published_at: '2026-10-01', expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), revoked_at: null, taken_down_at: null, removed_at: null, last_notification: null });
const card = () => ({ stripe_subscription_id: 'sub_1', status: 'active', tier: 'bookings', billing_interval: 'month', current_period_end: new Date(Date.now() + 10 * 86_400_000).toISOString(), created_at: '2026-10-01' });
const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const post = async () => { const r = res(); await publish({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { draftId: 'd1', revision: 1 } }, r); return r; };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_x'); vi.stubEnv('WEB_APP_RELIABILITY', '1'); vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  Object.assign(h, { ios: [], sites: [], ent: [], calls: [], failIos: false, prepared: 0, ran: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe('drafted publish endpoint and the view-only guard', () => {
  it('switch on: an Apple account that also pays a card plan gets 403 app-store-account, no intent prepared, none written, no job run', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    h.ios = [apple()]; h.ent = [card()];
    const r = await post();
    expect(r.code).toBe(403); expect(r.body).toEqual({ error: 'app-store-account' });
    expect(h.prepared).toBe(0); expect(h.ran).toBe(0);
    expect(h.calls.some((c) => c.includes('web_app_publish_intents'))).toBe(false);
  });
  it('switch on: a kind lookup error answers the existing 503, no intent prepared', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.ent = [card()]; h.failIos = true;
    const r = await post();
    expect(r.code).toBe(503); expect(r.body).toEqual({ error: 'temporarily-unavailable' });
    expect(h.prepared).toBe(0);
    err.mockRestore();
  });
  it('switch on: a web account still publishes (intent prepared, job run)', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    h.sites = [{ slug: 'web-cuts', published_at: '2026-10-02', removed_at: null, taken_down_at: null }]; h.ent = [card()];
    const r = await post();
    expect(r.code).toBe(200);
    expect(h.prepared).toBe(1); expect(h.ran).toBe(1);
  });
  it('switch off: an Apple account with a card plan is not asked about its kind and publishes as before', async () => {
    h.ios = [apple()]; h.ent = [card()];
    const r = await post();
    expect(r.code).toBe(200);
    expect(h.prepared).toBe(1);
    expect(h.calls.some((c) => c.startsWith('GET ios_purchases?'))).toBe(false);
  });
});
