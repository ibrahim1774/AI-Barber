// Fake shop lookup for lib/siteSubpages.ts (site subpages, merged after the suite was written).
// publishSite asks findShopForSite(slug) before every deploy and FAILS the deploy when the
// lookup throws; the real one reaches Supabase, which the e2e network blocks. Installed per
// test file with
//   vi.mock('../../lib/siteSubpages.js', async (orig) => (await import('./harness/subpages.js')).subpagesModule(await orig()));
// A test can register a shop for a slug (`siteShops.set('fade-lab', { id, slug })`) to get the
// /book and /shop rewrites; the stored base URL / look writes are recorded, never sent.
import type { SiteShop } from '../../../lib/siteSubpages.js';

export const siteShops = new Map<string, SiteShop>();
export const siteBaseWrites: { shopId: string; fields: unknown }[] = [];
/** Make the next lookups throw (a Supabase outage). */
export const subpagesFail = { lookup: false };

export function resetSubpages() {
  siteShops.clear();
  siteBaseWrites.length = 0;
  subpagesFail.lookup = false;
}

export function subpagesModule(real: any) {
  return {
    ...real,
    findShopForSite: async (slug: string) => {
      if (subpagesFail.lookup) throw new Error('e2e: shop lookup down');
      return siteShops.get(slug) ?? null;
    },
    liveSiteBaseDeps: {
      projectDomains: async () => [],
      domainServing: async () => false,
      updateShop: async (shopId: string, fields: unknown) => { siteBaseWrites.push({ shopId, fields }); },
    },
  };
}
