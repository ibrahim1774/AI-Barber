// Code deployed before migration 011: shop reads and the base write still work.
import { describe, expect, it, vi } from 'vitest';
import { isMissingSiteColumn, withSiteCols } from '../lib/siteColumns';
import { supabaseBookingRepo } from '../lib/bookings/repo';
import { supabaseStoreRepo } from '../lib/store/repo';
import { updateShopSite } from '../lib/siteSubpages';

const MISSING = { code: '42703', message: 'column ab_shops.site_base_url does not exist' };
const MISSING_CACHE = { code: 'PGRST204', message: "Could not find the 'site_look' column of 'ab_shops' in the schema cache" };

/** A chainable supabase-js stand-in whose awaited results come from `results` in order; selects are recorded. */
function fakeClient(results: { data: unknown; error: unknown }[]) {
  const selects: string[] = [];
  let i = 0;
  const chain: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: any, rej: any) => Promise.resolve(results[Math.min(i++, results.length - 1)]).then(res, rej);
      return (...args: unknown[]) => { if (prop === 'select') selects.push(String(args[0])); return chain; };
    },
  });
  return { client: { from: () => chain } as any, selects };
}

describe('isMissingSiteColumn', () => {
  it('only for an undefined-column error naming a 011 column', () => {
    expect(isMissingSiteColumn(MISSING)).toBe(true);
    expect(isMissingSiteColumn(MISSING_CACHE)).toBe(true);
    expect(isMissingSiteColumn({ code: '42703', message: 'column ab_shops.nope does not exist' })).toBe(false);
    expect(isMissingSiteColumn({ code: '42501', message: 'permission denied for site_look' })).toBe(false);
    expect(isMissingSiteColumn(null)).toBe(false);
  });
});

describe('withSiteCols', () => {
  it('reads with the columns, and again without them when they are missing', async () => {
    const run = vi.fn(async (cols: string) => (cols.includes('site_') ? { data: null, error: MISSING } : { data: { id: 's' }, error: null }));
    expect(await withSiteCols('id, slug', run)).toEqual({ data: { id: 's' }, error: null });
    expect(run.mock.calls.map((c) => c[0])).toEqual(['id, slug, site_base_url, site_look', 'id, slug']);
  });
  it('other errors are returned as they are (no retry)', async () => {
    const run = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'denied' } }));
    expect((await withSiteCols('id', run)).error).toEqual({ code: '42501', message: 'denied' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('repos before 011', () => {
  it('bookings: shop reads retry without the site columns', async () => {
    for (const read of ['shopBySlug', 'shopById', 'shopByOwner'] as const) {
      const { client, selects } = fakeClient([{ data: null, error: MISSING }, { data: { id: 's', slug: 'x' }, error: null }]);
      expect(await (supabaseBookingRepo(client) as any)[read]('k')).toEqual({ id: 's', slug: 'x' });
      expect(selects[0]).toContain('site_base_url, site_look');
      expect(selects[1]).not.toContain('site_base_url');
    }
  });

  it('store: shop reads retry without the site columns', async () => {
    for (const read of ['shopBySlug', 'shopById', 'shopByOwner'] as const) {
      const { client, selects } = fakeClient([{ data: null, error: MISSING_CACHE }, { data: { id: 's' }, error: null }]);
      expect(await (supabaseStoreRepo(client) as any)[read]('k')).toEqual({ id: 's' });
      expect(selects[1]).not.toContain('site_base_url');
    }
  });

  it('after 011 the columns are read in one go', async () => {
    const { client, selects } = fakeClient([{ data: { id: 's', site_base_url: 'https://x.com' }, error: null }]);
    expect(await supabaseBookingRepo(client).shopBySlug('x')).toEqual({ id: 's', site_base_url: 'https://x.com' });
    expect(selects).toHaveLength(1);
  });

  it('the base write is skipped (not thrown) when the columns are missing; other errors throw', async () => {
    await expect(updateShopSite(fakeClient([{ data: null, error: MISSING }]).client, 's', { site_base_url: 'https://x.com' })).resolves.toBeUndefined();
    await expect(updateShopSite(fakeClient([{ data: null, error: { code: '42501', message: 'denied' } }]).client, 's', {})).rejects.toThrow('denied');
  });
});
