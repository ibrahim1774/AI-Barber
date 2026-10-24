import { describe, it, expect, vi } from 'vitest';
import { makeDomainHooks, makeRefreshBase, type DomainHookDeps } from '../../lib/ios/domainHooks.js';
import { refreshSiteBase, type ProjectDomain, type SiteBaseDeps } from '../../lib/siteSubpages.js';
import { projectFor } from '../../lib/ios/domainFlow.js';

const NOW = 1_800_000_000_000;
const P = 'com.ibrahim1774.aibarber.';
const iso = (ms: number) => new Date(ms).toISOString();

function setup(rowOver: any = {}, over: Partial<DomainHookDeps> = {}) {
  const row = {
    original_transaction_id: 's-o1', product_id: `${P}hosting.monthly`, environment: 'Production', site_slug: 'fresh-cuts',
    user_id: null, expires_at: iso(NOW + 1e9), revoked_at: null, last_notification: null, published_at: iso(NOW - 1e6),
    taken_down_at: null, lapse_checked_at: null, ...rowOver,
  };
  const pending = { siteId: 'fresh-cuts', version: 3, siteData: { shopName: 'Fresh', bookingUrl: 'https://aibarber.org/book/fresh', shopUrl: 'https://aibarber.org/shop/fresh' } } as any;
  const deps: DomainHookDeps = {
    findBySlug: vi.fn(async () => row as any),
    readPending: vi.fn(async () => pending),
    publish: vi.fn(async () => ({ ok: true, siteId: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.vercel.app' })),
    refreshBase: vi.fn(async () => null),
    now: () => NOW,
    ...over,
  };
  return { deps, hooks: makeDomainHooks(deps), pending };
}

describe('onDomainLinked / onDomainUnlinked', () => {
  it('force-republishes with the tier link strip (publishSite refreshes the base itself, so no extra refresh)', async () => {
    const { deps, hooks } = setup();
    expect(await hooks.onDomainLinked('fresh-cuts', 'freshcuts.com')).toBe('republished');
    const [slug, opts] = (deps.publish as any).mock.calls[0];
    expect(slug).toBe('fresh-cuts');
    expect(opts.force).toBe(true);
    expect(opts.pending.siteData).toEqual({ shopName: 'Fresh' }); // website plan: no Book/Shop links
    expect(deps.refreshBase).not.toHaveBeenCalled();
    expect(await hooks.onDomainUnlinked('fresh-cuts')).toBe('republished');
  });

  it.each([
    ['revoked', { revoked_at: iso(NOW) }],
    ['taken down', { taken_down_at: iso(NOW) }],
    ['expired', { expires_at: iso(NOW - 1) }],
  ])('%s site: never deploys over the offline page, but the base is still refreshed', async (_n, over) => {
    const { deps, hooks } = setup(over);
    expect(await hooks.onDomainUnlinked('fresh-cuts')).toBe('site-offline');
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.refreshBase).toHaveBeenCalledWith('fresh-cuts');
  });

  it('a Sandbox row the sweep only gate-closed still republishes (its site stayed up)', async () => {
    const { deps, hooks } = setup({ environment: 'Sandbox', taken_down_at: iso(NOW) });
    expect(await hooks.onDomainLinked('fresh-cuts', 'x.com')).toBe('republished');
    expect(deps.publish).toHaveBeenCalled();
  });

  it('a failed deploy throws so the step is retried; a failed base refresh throws too', async () => {
    const a = setup({}, { publish: vi.fn(async () => ({ ok: false, siteId: 'x', reason: 'deploy-failed' as const })) });
    await expect(a.hooks.onDomainLinked('fresh-cuts', 'x.com')).rejects.toThrow(/publish-failed/);
    const b = setup({ revoked_at: iso(NOW) }, { refreshBase: vi.fn(async () => { throw new Error('db'); }) });
    await expect(b.hooks.onDomainUnlinked('fresh-cuts')).rejects.toThrow('db');
  });
});

describe('the base URL follows the domain (site-subpages refreshSiteBase over the project domains)', () => {
  /** A Vercel project with its domains, DNS state, and the shop's stored base. */
  function project() {
    const domains: ProjectDomain[] = [{ name: 'fresh-cuts.vercel.app', verified: true }];
    const dnsOk = new Set<string>();
    const shop = { site_base_url: null as string | null };
    const siteBase: SiteBaseDeps = {
      projectDomains: async () => domains.map((d) => ({ ...d })),
      domainServing: async (n) => dnsOk.has(n),
      updateShop: async (_id, f) => { if (f.site_base_url) shop.site_base_url = f.site_base_url; },
    };
    const refreshBase = makeRefreshBase({ findShop: async (s) => (s === 'fresh-cuts' ? { id: 'shop1' } : null), refreshSiteBase, siteBaseDeps: siteBase, projectFor });
    return { domains, dnsOk, shop, refreshBase };
  }

  it('linked: vercel.app until DNS is correct, then the custom domain; unlinked: back to vercel.app', async () => {
    const p = project();
    p.domains.push({ name: 'freshcuts.com', verified: true }, { name: 'www.freshcuts.com', verified: true, redirect: 'freshcuts.com' });
    await p.refreshBase('fresh-cuts');
    expect(p.shop.site_base_url).toBe('https://fresh-cuts.vercel.app'); // attached, DNS not pointed yet
    p.dnsOk.add('freshcuts.com');
    await p.refreshBase('fresh-cuts'); // the domain sweep's post-DNS republish
    expect(p.shop.site_base_url).toBe('https://freshcuts.com');
    p.domains.splice(1); // detaching removed www + apex from the project
    await p.refreshBase('fresh-cuts'); // the unlink
    expect(p.shop.site_base_url).toBe('https://fresh-cuts.vercel.app');
  });

  it('a web (Stripe) site has no shop: nothing to refresh', async () => {
    const p = project();
    expect(await p.refreshBase('web-site')).toBeNull();
  });

  it('wired into the hook: an offline site unlinking clears the custom base without a deploy', async () => {
    const p = project();
    p.shop.site_base_url = 'https://freshcuts.com';
    const { deps, hooks } = setup({ taken_down_at: iso(NOW) }, { refreshBase: p.refreshBase });
    await hooks.onDomainUnlinked('fresh-cuts');
    expect(deps.publish).not.toHaveBeenCalled();
    expect(p.shop.site_base_url).toBe('https://fresh-cuts.vercel.app');
  });
});
