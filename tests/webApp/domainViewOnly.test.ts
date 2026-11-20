// POST /api/web-app/domain buy and checkout with WEB_APPLE_VIEW_ONLY: an Apple account is refused (403 app-store-account); off or any other kind is unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ kind: 'apple', fails: false, kindCalls: 0, reached: [] as string[] }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true, authOutage: () => false, APP_ORIGIN: () => 'https://app.test',
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
}));
vi.mock('../../lib/webApp/priceGroup.js', () => ({ isFree: async () => false }));
vi.mock('../../lib/deployAuth.js', () => ({ authorizeSiteOwner: async () => ({ ok: true }), liveDeployAuthDeps: () => ({}) }));
vi.mock('../../lib/webDomains.js', () => ({ createDomainCheckout: async () => { st.reached.push('checkout'); return { status: 200, body: { url: 'u' } }; }, purchaseDomain: async () => ({ status: 200, body: {} }), webDomainPanelStatus: async () => ({ status: 200, body: {} }), webDomainPortal: async () => ({ status: 200, body: {} }), webDomainRenewal: async () => ({ status: 200, body: {} }) }));
vi.mock('../../lib/webApp/domainOneClick.js', () => ({ oneClickCard: async () => ({ status: 200, body: {} }), oneClickDomainPurchase: async () => { st.reached.push('buy'); return { status: 200, body: { ok: true } }; } }));
vi.mock('../../lib/webApp/domainOneClickLive.js', () => ({ liveOneClickDeps: () => ({}), livePanelDeps: () => ({}), webPlanOf: async () => null }));
vi.mock('../../lib/ios/domainLive.js', () => ({ liveWebDomainDeps: () => ({}) }));
vi.mock('../../lib/ios/vercelDomains.js', () => ({ liveVercelDomains: () => ({}), registrantContact: () => ({}) }));
vi.mock('../../lib/ios/domainsRepo.js', () => ({ supabaseDomains: () => ({}) }));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}) }));
vi.mock('../../lib/account/webViewOnly.js', () => ({ webKindOf: async () => { st.kindCalls++; if (st.fails) throw new Error('db'); return st.kind; } }));

import handler from '../../api/web-app/domain.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const call = async (action: string) => { const r = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action, siteId: 'fresh-cuts', domain: 'a.com' } }, r); return r; };

beforeEach(() => {
  vi.unstubAllEnvs(); vi.stubEnv('STRIPE_SECRET_KEY', 'sk'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  Object.assign(st, { kind: 'apple', fails: false, kindCalls: 0, reached: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe('domain buy and checkout for an Apple account', () => {
  it('switch off: unchanged, the kind is never read', async () => {
    expect((await call('buy')).code).toBe(200); expect((await call('checkout')).code).toBe(200);
    expect(st.kindCalls).toBe(0);
  });
  it('switch on: buy and checkout refused for kind apple, nothing reached', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    for (const a of ['buy', 'checkout']) { const r = await call(a); expect(r.code).toBe(403); expect(r.body).toEqual({ error: 'app-store-account' }); }
    expect(st.reached).toEqual([]);
  });
  it('switch on: other kinds, other actions and a failed lookup go through as today', async () => {
    vi.stubEnv('WEB_APPLE_VIEW_ONLY', '1');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const k of ['web', 'mixed', 'neither']) { st.kind = k; expect((await call('buy')).code).toBe(200); }
    st.kind = 'apple'; expect((await call('status')).code).toBe(200);
    st.fails = true; expect((await call('buy')).code).toBe(200);
    err.mockRestore();
  });
});
