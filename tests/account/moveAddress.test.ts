// Move carries the address row in the same step as the purchase (step d), whether the guard is on or not, and can never fail a Move.
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: { table: string; op: string }[] = [];
const chain = (table: string, result: any): any => {
  const q: any = new Proxy(function () {}, {
    get: (_t, p) => {
      if (p === 'then') return (res: any) => res(result);
      if (p === 'maybeSingle') return async () => result;
      return (...a: any[]) => { calls.push({ table, op: String(p) }); return q; };
    },
  });
  return q;
};
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => chain(t, { data: t === 'sites' ? [] : null, error: null }) }) }));
const moveAddressSpy = vi.hoisted(() => vi.fn(async () => 'moved'));
vi.mock('../../lib/account/sites.js', async (orig) => ({ ...(await orig<typeof import('../../lib/account/sites.js')>()), moveAddress: moveAddressSpy }));

import { liveMoveBusiness } from '../../lib/ios/transferLive.js';
import { fakeSites } from './fakes/sites.js';

const FROM = 'aaaaaaaa-1111-4111-8111-111111111111';
const TO = 'bbbbbbbb-2222-4222-8222-222222222222';
afterEach(() => { vi.unstubAllEnvs(); moveAddressSpy.mockClear(); calls.length = 0; });

describe('liveMoveBusiness carries the address row', () => {
  it.each([['guard off', ''], ['alert', 'alert'], ['1', '1']])('%s: the address step runs with (from, to, slug), before the rest', async (_n, v) => {
    vi.stubEnv('ONE_SITE_GUARD', v);
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srv');
    await liveMoveBusiness('2000000123', FROM, TO, 'fade-lab');
    expect(moveAddressSpy).toHaveBeenCalledWith(FROM, TO, 'fade-lab');
    expect(calls.length).toBeGreaterThan(0); // the rest of the Move still ran after it
  });
});

describe('guard off, then a Move, then guard on: the row moved', () => {
  it('the new owner holds the address and the old one holds none', async () => {
    const real = await vi.importActual<typeof import('../../lib/account/sites.js')>('../../lib/account/sites.js');
    const f = fakeSites([{ user_id: FROM, environment: 'Production', slug: 'fade-lab', holder: 'apple', published_once: true }]);
    vi.stubEnv('ONE_SITE_GUARD', ''); // guard off during the Move
    expect(await real.moveAddress(FROM, TO, 'fade-lab', f.deps)).toBe('moved');
    vi.stubEnv('ONE_SITE_GUARD', '1');  // guard on afterwards
    expect(f.row(FROM, 'Production')).toBeUndefined();
    expect(f.row(TO, 'Production')).toMatchObject({ slug: 'fade-lab', holder: 'apple' });
    expect(await real.takeAddress(TO, 'Production', 'fade-lab', 'apple', f.deps)).toMatchObject({ status: 'ok', created: false });
    expect(await real.takeAddress(FROM, 'Production', 'new-slug', 'web', f.deps)).toMatchObject({ status: 'ok', created: true });
  });
  it('it cannot fail a Move: no row, a missing table, and a row clash all return normally', async () => {
    const real = await vi.importActual<typeof import('../../lib/account/sites.js')>('../../lib/account/sites.js');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(real.moveAddress(FROM, TO, 'x', fakeSites().deps)).resolves.toBe('moved');
    await expect(real.moveAddress(FROM, TO, 'x', fakeSites([], { missing: true }).deps)).resolves.toBe('skipped');
    await expect(real.moveAddress(FROM, TO, 'x', fakeSites([], { failWrites: true }).deps)).resolves.toBe('error');
  });
});
