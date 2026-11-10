import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ group: null as string | null, err: null as any }));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false,
  webAppCheckoutOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'a@example.com' }),
  sbRest: async (path: string) => {
    if (path.startsWith('web_app_price_groups')) { if (h.err) throw h.err; return h.group ? [{ price_group: h.group }] : []; }
    return [];
  },
}));
import me from '../../api/web-app/me.js';

const get = async () => { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = () => {}; await me({ method: 'GET', headers: { authorization: 'Bearer t' } }, r); return r; };
beforeEach(() => { vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); h.group = null; h.err = null; });

describe('GET /api/web-app/me priceGroup', () => {
  it('base when none is stored', async () => { expect((await get()).body.priceGroup).toBe('base'); });
  it('the stored group', async () => {
    h.group = 'g10'; expect((await get()).body.priceGroup).toBe('g10');
    h.group = 'g20'; expect((await get()).body.priceGroup).toBe('g20');
  });
  it('fails soft to base when the lookup fails (table missing or Supabase error)', async () => {
    h.err = Object.assign(new Error('supabase 500'), { status: 500 });
    const r = await get(); expect(r.code).toBe(200); expect(r.body.priceGroup).toBe('base');
    h.err = Object.assign(new Error('supabase 404'), { status: 404 });
    expect((await get()).body.priceGroup).toBe('base');
  });
});
