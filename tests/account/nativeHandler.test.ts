// POST /api/web-app/publish (native, drafted) with the REAL nativePublication over a fake data layer (sbRest + plan); prepareIntent captures what the intent gets.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ prepare: [] as any[], bookings: true, store: true, shop: { id: 'shop1', bookings_enabled: true, store_enabled: true } as any, members: [] as any[], draft: null as any }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppEntitlementsOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  sbRest: async (path: string) => {
    if (path.startsWith('ab_shops')) return st.shop ? [st.shop] : [];
    if (path.startsWith('ab_members?select=title')) return [];
    if (path.startsWith('ab_members')) return st.members;
    if (path.startsWith('ab_availability') || path.startsWith('ab_service_members')) return [];
    if (path.startsWith('ab_services')) return [{ id: 's1', name: 'Fade' }];
    if (path.startsWith('web_app_entitlements')) return [{ stripe_subscription_id: 'sub_1' }];
    if (path.startsWith('web_app_publish_intents')) return [{ status: 'live', result: { body: { siteId: 's' } } }];
    return [];
  },
}));
vi.mock('../../lib/bookings/rateLimit.js', () => ({ clientIp: () => '1.1.1.1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/webApp/publishFlow.js', () => ({ liveWebPublishDeps: () => ({}), runWebPublish: async () => ({ status: 200, body: {} }) }));
vi.mock('../../lib/webApp/reliability.js', () => ({
  reliabilityOn: () => true, modeOf: () => 'test', enc: encodeURIComponent,
  readDraft: async () => st.draft, prepareIntent: async (...a: any[]) => { st.prepare.push(a); return { id: 'job1' }; },
}));
vi.mock('../../lib/webApp/publishJobs.js', () => ({ runJob: async () => {}, dispatchJob: () => {} }));
vi.mock('../../lib/webApp/priceGroup.js', () => ({ entitlementOrFree: async () => null, isFreeSubscriptionId: () => false }));
vi.mock('../../lib/webApp/contactPhoneLive.js', () => ({ savedPhoneState: async () => ({ phone: '1', contactsOk: true }) }));
vi.mock('../../lib/account/plan.js', () => ({
  defaultKindEnv: () => 'Sandbox',
  accountPlan: async () => ({ active: true, tier: st.store ? 'store' : st.bookings ? 'bookings' : 'website' }),
}));
vi.mock('../../lib/bookings/repo.js', () => ({ serviceClient: () => ({}), supabaseBookingRepo: () => ({ memberProfileLive: async () => true }) }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => 'web' }));

import handler from '../../api/web-app/publish.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const send = async (body: any) => { const r = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer t', 'x-pb-build': '57' }, body }, r); return r; };
const OWN = 'https://booksy.com/fade';
beforeEach(() => {
  vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all'); vi.stubEnv('WEB_APP_RELIABILITY', '1'); vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
  Object.assign(st, { prepare: [], bookings: true, store: true, shop: { id: 'shop1', bookings_enabled: true, store_enabled: true }, members: [],
    draft: { draft_id: 'd1', revision: 2, site_data: { shopName: 'X', bookingUrl: '/book', staff: [{ name: 'Mike', memberId: 'm1' }] } } });
});
afterEach(() => vi.unstubAllEnvs());
const pub = () => st.prepare[0][5];

describe('native drafted publish, real nativePublication', () => {
  it('chose built-in with live bookings: /book and the Shop button when the store is on', async () => {
    expect((await send({ draftId: 'd1', revision: 2, bookingChoice: 'aibarber', ownBookingUrl: OWN })).code).toBe(200);
    expect(pub()).toMatchObject({ bookingUrl: '/book', shopUrl: '/shop' });
  });
  it('bookings lapsed: the own link; store switched off: no Shop button', async () => {
    st.bookings = false; st.store = false; st.shop.store_enabled = false;
    await send({ draftId: 'd1', revision: 2, bookingChoice: 'aibarber', ownBookingUrl: OWN });
    expect(pub().bookingUrl).toBe(OWN);
    expect(pub().shopUrl).toBeUndefined();
  });
  it('no shop row: links still decided, team untouched', async () => {
    st.shop = null;
    await send({ draftId: 'd1', revision: 2 });
    expect(pub().staff).toBeUndefined();
  });
  it('an active member refreshes; a member missing from ab_members drops its card', async () => {
    st.members = [];
    await send({ draftId: 'd1', revision: 2 });
    expect(pub().staff).toEqual([]);
    st.prepare = []; st.members = [{ id: 'm1', display_name: 'Michael', photo_url: null, bio: null, active: true }];
    await send({ draftId: 'd1', revision: 2 });
    expect(pub().staff.map((s: any) => s.name)).toEqual(['Michael']);
  });
  it('invalid booking fields are 400 and nothing is prepared; no draft id is 409; a stale revision is 409', async () => {
    expect((await send({ draftId: 'd1', revision: 2, bookingChoice: 'built-in' })).code).toBe(400);
    expect((await send({ siteData: { shopName: 'phone' } })).code).toBe(409);
    expect((await send({ draftId: 'd1', revision: 1 })).code).toBe(409);
    expect(st.prepare).toHaveLength(0);
  });
  it('an unusable own link is dropped (as none), the publish goes on', async () => {
    st.bookings = false; st.store = false;
    for (const bad of ['https://www.primebarber.org/book', 'https://user:pw@booksy.com/x', 'ftp://x.com', 'not a url']) {
      st.prepare = [];
      expect((await send({ draftId: 'd1', revision: 2, bookingChoice: 'aibarber', ownBookingUrl: bad })).code, bad).toBe(200);
      expect(pub().bookingUrl, bad).toBeUndefined();
    }
  });
});
