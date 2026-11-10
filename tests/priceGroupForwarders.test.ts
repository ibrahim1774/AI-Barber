import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { priceGroupField } from '../lib/priceGroupField';
import viewContent from '../api/fb-view-content';

describe('price_group passthrough', () => {
  it('validates to base/g10/g20', () => {
    expect(priceGroupField({ price_group: 'g10' })).toBe('g10');
    expect(priceGroupField({ price_group: 'base' })).toBe('base');
    for (const v of ['g30', '', 10, null, undefined, { a: 1 }]) expect(priceGroupField({ price_group: v })).toBeNull();
    expect(priceGroupField(undefined)).toBeNull();
  });
  describe('fb-view-content', () => {
    let sent: any;
    beforeEach(() => {
      vi.stubEnv('FB_PIXEL_ID', 'px'); vi.stubEnv('FB_ACCESS_TOKEN', 'tok');
      vi.stubEnv('META_PIXEL_ID', 'px'); vi.stubEnv('META_CAPI_ACCESS_TOKEN', 'tok');
      sent = null;
      vi.stubGlobal('fetch', async (_u: string, init: any) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({}) }; });
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
    const run = async (body: any) => { const r: any = { setHeader() {}, status(c: number) { r.code = c; return r; }, json(b: any) { r.body = b; return r; }, end() { return r; } }; await viewContent({ method: 'POST', headers: {}, body }, r); return r; };
    it('adds price_group to custom_data only when valid', async () => {
      const r = await run({ eventId: 'e1', price_group: 'g20' }); expect(r.code).toBe(200);
      expect(sent.data[0].custom_data.price_group).toBe('g20');
      await run({ eventId: 'e2', price_group: 'evil' });
      expect(sent.data[0].custom_data?.price_group).toBeUndefined();
    });
  });
});
