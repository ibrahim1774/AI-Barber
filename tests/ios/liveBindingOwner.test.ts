import { describe, it, expect, vi, beforeEach } from 'vitest';

const sitesQueries: string[][] = [];
let sitesRows: Array<{ user_id: string; deployed_url?: string }> = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => t === 'ab_shops'
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      : { select: () => ({ in: async (_c: string, forms: string[]) => { sitesQueries.push(forms); return { data: sitesRows.filter((r) => !r.deployed_url || forms.includes(r.deployed_url)), error: null }; } }) },
  }),
}));

import { liveBindingOwner } from '../../lib/ios/ownership.js';

beforeEach(() => {
  sitesQueries.length = 0;
  sitesRows = [];
  process.env.SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

const row = (site_slug: string) => ({ original_transaction_id: 'o1', site_slug });

describe('liveBindingOwner looks up the full slug URL only', () => {
  it('a long slug never queries the truncated address (another customer may hold it)', async () => {
    const A = 'masterkutz-upscale-barbershop-lounge-1504-palm-bay';
    sitesRows = [{ user_id: 'V-owner', deployed_url: 'https://masterkutz-upscale-barbershop-loung.vercel.app' }]; // another customer holds the truncated alias
    expect(await liveBindingOwner(row(A))).toBeNull();
    expect(sitesQueries[0]).toEqual([`https://${A}.vercel.app`, `https://${A}.vercel.app/`]);
    expect(sitesQueries[0].some((u) => u.includes('loung.vercel.app'))).toBe(false);
  });
  it('short slug: same two forms as before', async () => {
    sitesRows = [{ user_id: 'u1' }];
    expect(await liveBindingOwner(row('fresh-cuts'))).toBe('u1');
    expect(sitesQueries[0]).toEqual(['https://fresh-cuts.vercel.app', 'https://fresh-cuts.vercel.app/']);
  });
});
