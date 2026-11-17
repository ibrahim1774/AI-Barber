import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ row: null as any, groups: [] as any[], groupsMissing: false }));
vi.mock('../../lib/webApp/webAppServer.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/webApp/webAppServer.js')>()),
  webAppCors: () => false, webAppCheckoutOn: () => true, callerFrom: async () => ({ id: 'u1', email: 'a@b.co' }),
  sbRest: async (path: string, init: any = {}) => {
    if (path.startsWith('web_app_price_groups')) { if (db.groupsMissing) throw Object.assign(new Error('supabase 404'), { status: 404 }); return db.groups; }
    if (path.startsWith('web_app_drafts')) {
      const m = init.method ?? 'GET';
      if (m === 'GET') return db.row ? [JSON.parse(JSON.stringify(db.row))] : [];
      if (m === 'PATCH') { db.row.deployed_url = null; /* a take offline lands between the read and this write */ Object.assign(db.row, init.body); return [JSON.parse(JSON.stringify(db.row))]; }
    }
    return [];
  },
}));
vi.mock('../../lib/account/kind.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/kind.js')>()), accountKind: async () => 'web' }));

import { isFreeOrUnknown, webPlanLive, type PlanLiveDeps } from '../../lib/account/planLive.js';
import draft from '../../api/web-app/draft.js';

afterEach(() => vi.unstubAllEnvs());

describe('webPlanLive: one source for "does the account still have a plan"', () => {
  const ent = (status: string, sid = 'sub_1') => ({ status, stripe_subscription_id: sid });
  const deps = (o: { ents?: any[]; free?: boolean; entFails?: boolean; freeFails?: boolean } = {}): PlanLiveDeps & { modes: string[] } => {
    const modes: string[] = [];
    return { modes, entitlements: async (_u, m) => { modes.push(m); if (o.entFails) throw new Error('db'); return o.ents ?? []; }, isFree: async () => { if (o.freeFails) throw new Error('db'); return !!o.free; } };
  };
  it('a live card plan or Free is live; none is ended; Production reads live mode and Sandbox reads test mode', async () => {
    expect(await webPlanLive('u', 'Production', deps({ ents: [ent('active')] }))).toBe(true);
    expect(await webPlanLive('u', 'Production', deps({ ents: [ent('past_due')] }))).toBe(true);
    expect(await webPlanLive('u', 'Production', deps({ free: true }))).toBe(true);
    expect(await webPlanLive('u', 'Production', deps({ ents: [ent('canceled')] }))).toBe(false);
    expect(await webPlanLive('u', 'Production', deps())).toBe(false);
    const p = deps(); await webPlanLive('u', 'Production', p); const s = deps(); await webPlanLive('u', 'Sandbox', s);
    expect([p.modes[0], s.modes[0]]).toEqual(['live', 'test']);
  });
  it('an in-memory free: id never counts as a card plan', async () => {
    expect(await webPlanLive('u', 'Production', deps({ ents: [ent('active', 'free:u')] }))).toBe(false);
  });
  it('a failed read counts as live (never "ended" on a guess)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await webPlanLive('u', 'Production', deps({ entFails: true }))).toBe(true);
    expect(await webPlanLive('u', 'Production', deps({ freeFails: true }))).toBe(true);
  });
  it('isFreeOrUnknown: free group true, base group false, a missing price-group table (404) true, other errors throw', async () => {
    db.groupsMissing = false; db.groups = [{ price_group: 'free' }]; expect(await isFreeOrUnknown('u')).toBe(true);
    db.groups = [{ price_group: 'base' }]; expect(await isFreeOrUnknown('u')).toBe(false);
    db.groups = []; expect(await isFreeOrUnknown('u')).toBe(false);
    db.groupsMissing = true; expect(await isFreeOrUnknown('u')).toBe(true);
    db.groupsMissing = false;
  });
});

describe('a stale draft PUT can never bring the old live address back', () => {
  const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
  const site = () => ({ shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555', hero: { heading: 'H', tagline: 'T', imageUrl: '' }, about: { heading: 'A', description: ['d'], imageUrl: '' }, services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' } });
  const put = async (headers: any) => { const r = res(); await draft({ method: 'PUT', headers: { authorization: 'Bearer t', ...headers }, body: { id: 'd1', expectedRevision: 1, site_data: site() } }, r); return r; };
  beforeEach(() => {
    vi.stubEnv('WEB_APP_RELIABILITY', '1'); vi.stubEnv('WEB_APP_CHECKOUT', '1'); vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    db.row = { user_id: 'u1', environment: 'test', draft_id: 'd1', revision: 1, site_data: { ...site(), source: 'web-app', shopName: 'Old' }, deployed_url: 'https://old.vercel.app', published_binding: null, updated_at: 'x', suspended: true, suspension_reason: 'offline' };
  });
  it('native (X-PB-Build): deployed_url stays null, whatever DRAFT_PUT_KEEPS_LIVE_URL says, and the answer shows null', async () => {
    for (const keeps of ['', '1']) {
      db.row.deployed_url = 'https://old.vercel.app'; db.row.revision = 1; db.row.site_data = { ...site(), source: 'web-app', shopName: 'Old' }; vi.stubEnv('DRAFT_PUT_KEEPS_LIVE_URL', keeps);
      const r = await put({ 'x-pb-build': '57' });
      expect(r.code).toBe(200);
      expect(db.row.deployed_url).toBeNull();
      expect(r.body.draft.deployed_url ?? r.body.draft.deployedUrl ?? null).toBeNull();
    }
  });
  it('the web (no header) is byte-identical to today: with the switch off it still writes back what it read', async () => {
    vi.stubEnv('DRAFT_PUT_KEEPS_LIVE_URL', '');
    const r = await put({});
    expect(r.code).toBe(200);
    expect(db.row.deployed_url).toBe('https://old.vercel.app');
  });
});
