// /api/web-app/me: ACCOUNT_PLAN_V2 off is byte-identical to today (and reads nothing extra); on adds kind and source only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({ ent: [] as any[], sites: [] as any[], ios: [] as any[], owners: [] as any[], group: 'base', calls: [] as string[], fail: false }));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => true,
  webAppEntitlementsOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'a@example.com' }),
  sbRest: async (path: string) => {
    db.calls.push(path);
    if (path.startsWith('web_app_entitlements?')) return db.ent;
    if (path.startsWith('web_app_sites?')) { if (db.fail) throw new Error('down'); return db.sites; }
    if (path.startsWith('ios_purchases?')) return db.ios;
    if (path.startsWith('site_owners?')) return db.owners;
    if (path.startsWith('web_app_price_groups?')) return [{ price_group: db.group }];
    return [];
  },
}));

import me from '../../api/web-app/me.js';

const res = () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; return r; };
const get = async () => { const r = res(); await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r); return r; };
const paid = [{ stripe_subscription_id: 's', status: 'active', tier: 'bookings', billing_interval: 'month', created_at: '2026-10-01' }];

beforeEach(() => {
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
  Object.assign(db, { ent: [], sites: [], ios: [], owners: [], group: 'base', calls: [], fail: false });
});
afterEach(() => vi.unstubAllEnvs());

const MIXES: Record<string, () => void> = {
  'paid card plan': () => { db.ent = paid; },
  'no plan': () => {},
  'ended plan': () => { db.ent = [{ ...paid[0], status: 'canceled' }]; },
  'free group': () => { db.group = 'free'; },
};

describe('/api/web-app/me', () => {
  for (const [name, setup] of Object.entries(MIXES)) {
    it(`switch off: ${name} is unchanged and reads no new table`, async () => {
      setup();
      vi.stubEnv('ACCOUNT_PLAN_V2', '');
      const off = await get();
      expect(off.code).toBe(200);
      expect(Object.keys(off.body)).not.toContain('kind');
      expect(Object.keys(off.body)).not.toContain('source');
      expect(db.calls.some((c) => c.startsWith('ios_purchases?') || c.startsWith('site_owners?'))).toBe(false);
      expect(off.body).toMatchSnapshot();
      // On: every old key keeps its value, in the same order, and only kind and source are added.
      vi.stubEnv('ACCOUNT_PLAN_V2', '1');
      const on = await get();
      const { kind, source, ...rest } = on.body;
      expect(JSON.stringify(rest)).toBe(JSON.stringify(off.body));
      expect(typeof kind).toBe('string');
      expect(Object.keys(on.body).slice(-2)).toEqual(['kind', 'source']);
    });
  }
  it('switch on: kind and source', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    db.ent = paid; db.sites = [{ slug: 'x', published_at: '2026-10-02' }];
    expect((await get()).body).toMatchObject({ kind: 'web', source: 'stripe' });
    db.ios = [{ original_transaction_id: '1', product_id: 'com.ibrahim1774.aibarber.bookings.monthly', environment: 'Production', site_slug: 'a-site', user_id: 'u1', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, taken_down_at: null }];
    expect((await get()).body).toMatchObject({ kind: 'mixed', source: 'apple' });
  });
  it('switch on: a failed lookup leaves the old answer', async () => {
    vi.stubEnv('ACCOUNT_PLAN_V2', '1');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.ent = paid; db.fail = true;
    const r = await get();
    expect(r.code).toBe(200);
    expect(Object.keys(r.body)).not.toContain('kind');
    err.mockRestore();
  });
});
