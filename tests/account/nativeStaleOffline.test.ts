// The keep-content take offline could not clear the draft's live address (the clear failed, or the draft engine was off) and WEB_APP_RELIABILITY is turned on later:
// native draft GET/PUT never report the old address, and a native publish is a republish, not answered from the old live record. The web (no header) is unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ draft: null as any, siteRow: null as any, siteFails: false, prepare: [] as any[], calls: [] as string[] }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true, callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }),
  sbRest: async (path: string, init: any = {}) => {
    db.calls.push(path.split('?')[0]);
    if (path.startsWith('web_app_sites')) { if (db.siteFails) throw Object.assign(new Error('supabase 500'), { status: 500 }); return db.siteRow ? [db.siteRow] : []; }
    if (path.startsWith('web_app_drafts')) { if ((init.method ?? 'GET') === 'GET') return [JSON.parse(JSON.stringify(db.draft))]; return [{ ...db.draft, ...(init.body ?? {}) }]; }
    if (path.startsWith('web_app_entitlements')) return [{ stripe_subscription_id: 'sub_1' }];
    if (path.startsWith('web_app_publish_intents')) return [{ status: 'live', result: { body: { siteId: 's' } } }];
    return [];
  },
}));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<typeof import('../../lib/bookings/rateLimit.js')>()), clientIp: () => '1', iosLimiter: { allow: async () => true } }));
vi.mock('../../lib/webApp/publishFlow.js', () => ({ liveWebPublishDeps: () => ({}), runWebPublish: async () => ({ status: 200, body: {} }) }));
vi.mock('../../lib/webApp/publishJobs.js', () => ({ runJob: async () => {}, dispatchJob: () => {} }));
vi.mock('../../lib/webApp/priceGroup.js', () => ({ entitlementOrFree: async () => null, isFreeSubscriptionId: () => false }));
vi.mock('../../lib/webApp/contactPhoneLive.js', () => ({ savedPhoneState: async () => ({ phone: '1', contactsOk: true }) }));
vi.mock('../../lib/account/nativePublish.js', () => ({ bookingInputsFrom: () => ({}), nativePublication: async () => ({}) }));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => 'web' }));
// the real reliability module for readDraft / modeOf; prepareIntent is observed
vi.mock('../../lib/webApp/reliability.js', async (orig) => ({ ...(await orig<typeof import('../../lib/webApp/reliability.js')>()), prepareIntent: async (...a: any[]) => { db.prepare.push(a); return { id: 'job1' }; } }));

import draft from '../../api/web-app/draft.js';
import publish from '../../api/web-app/publish.js';
import { webSiteOffline } from '../../lib/account/siteOffline.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
const send = async (h: any, headers: any, method = 'GET', body?: any) => { const r = res(); await h({ method, headers: { authorization: 'Bearer t', ...headers }, body }, r); return r; };
const HDR = { 'x-pb-build': '57' };
beforeEach(() => {
  for (const [k, v] of Object.entries({ WEB_APP_RELIABILITY: '1', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', ACCOUNT_DRAFTS_IOS: 'all' })) vi.stubEnv(k, v);
  db.prepare = []; db.calls = []; db.siteFails = false;
  db.draft = { user_id: 'u1', environment: 'test', draft_id: 'd1', revision: 2, site_data: { shopName: 'X', staff: [] }, deployed_url: 'https://old.vercel.app', published_binding: { slug: 'old' }, updated_at: 'x', suspended: false };
  db.siteRow = { removed_at: '2026-11-17T00:00:00Z', taken_down_at: '2026-11-17T00:00:00Z' };
});
afterEach(() => vi.unstubAllEnvs());

describe('a stale live address after a take offline', () => {
  it('webSiteOffline: removed or taken down means offline; a live row or a failed lookup does not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await webSiteOffline('u1')).toBe(true);
    db.siteRow = { removed_at: null, taken_down_at: '2026-11-17T00:00:00Z' }; expect(await webSiteOffline('u1')).toBe(true);
    db.siteRow = { removed_at: null, taken_down_at: null }; expect(await webSiteOffline('u1')).toBe(false);
    db.siteRow = null; expect(await webSiteOffline('u1')).toBe(false);
    db.siteRow = { removed_at: 'x' }; db.siteFails = true; expect(await webSiteOffline('u1')).toBe(false);
  });
  it('native draft GET does not report the old address or binding; the web (no header) is unchanged and never asks about the site', async () => {
    const n = await send(draft, HDR);
    expect(n.code).toBe(200);
    expect(n.body.draft.deployed_url).toBeNull(); expect(n.body.draft.webBinding).toBeNull();
    db.calls = [];
    const w = await send(draft, {});
    expect(w.body.draft.deployed_url).toBe('https://old.vercel.app'); expect(w.body.draft.webBinding).toEqual({ slug: 'old' });
    expect(db.calls).not.toContain('web_app_sites');
  });
  it('a site that is live is reported as before for native callers too', async () => {
    db.siteRow = { removed_at: null, taken_down_at: null };
    expect((await send(draft, HDR)).body.draft.deployed_url).toBe('https://old.vercel.app');
  });
  it('native draft PUT answers without the old address too', async () => {
    const r = await send(draft, HDR, 'PUT', { id: 'd1', expectedRevision: 2, site_data: { shopName: 'Fresh Cuts', area: 'B', phone: '5', hero: { heading: 'H', tagline: 'T', imageUrl: '' }, about: { heading: 'A', description: ['d'], imageUrl: '' }, services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' } } });
    expect(r.code).toBe(200);
    expect(r.body.draft.deployed_url).toBeNull();
  });
  it('a native publish of an offline site is a republish (never answered from the old live record); the web\'s flag is untouched', async () => {
    const body = { draftId: 'd1', revision: 2 };
    await send(publish, HDR, 'POST', body); // prepareIntent ran; only its argument matters here
    const nativeRepublish = db.prepare[0][6];
    expect(nativeRepublish).toBe(true);
    db.prepare = [];
    await send(publish, {}, 'POST', { ...body, siteData: { shopName: 'X' } });
    expect(db.prepare[0][6]).toBe(false);
    db.prepare = []; db.siteRow = { removed_at: null, taken_down_at: null };
    await send(publish, HDR, 'POST', body);
    expect(db.prepare[0][6]).toBe(false);
  });
});
