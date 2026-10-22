import { describe, it, expect, vi } from 'vitest';
import { makeDomainHooks, type DomainHookDeps } from '../../lib/ios/domainHooks.js';

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
    setSiteBaseUrl: vi.fn(async () => {}),
    now: () => NOW,
    ...over,
  };
  return { deps, hooks: makeDomainHooks(deps), pending };
}

describe('onDomainLinked / onDomainUnlinked', () => {
  it('sets the base URL to the domain, then force-republishes with the tier link strip', async () => {
    const { deps, hooks } = setup();
    expect(await hooks.onDomainLinked('fresh-cuts', 'freshcuts.com')).toBe('republished');
    expect(deps.setSiteBaseUrl).toHaveBeenCalledWith('fresh-cuts', 'https://freshcuts.com');
    const [slug, opts] = (deps.publish as any).mock.calls[0];
    expect(slug).toBe('fresh-cuts');
    expect(opts.force).toBe(true);
    expect(opts.pending.siteData).toEqual({ shopName: 'Fresh' }); // website plan: no Book/Shop links
    expect(opts.pending.version).toBe(3);
  });

  it('unlink clears the base URL and republishes', async () => {
    const { deps, hooks } = setup();
    expect(await hooks.onDomainUnlinked('fresh-cuts')).toBe('republished');
    expect(deps.setSiteBaseUrl).toHaveBeenCalledWith('fresh-cuts', null);
  });

  it.each([
    ['revoked', { revoked_at: iso(NOW) }],
    ['taken down', { taken_down_at: iso(NOW) }],
    ['expired', { expires_at: iso(NOW - 1) }],
  ])('%s site: never deploys content over the offline page', async (_n, over) => {
    const { deps, hooks } = setup(over);
    expect(await hooks.onDomainLinked('fresh-cuts', 'freshcuts.com')).toBe('site-offline');
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.setSiteBaseUrl).toHaveBeenCalled(); // the address is still recorded for the restore
  });

  it('a Sandbox row the sweep only gate-closed still republishes (its site stayed up)', async () => {
    const { deps, hooks } = setup({ environment: 'Sandbox', taken_down_at: iso(NOW) });
    expect(await hooks.onDomainLinked('fresh-cuts', 'x.com')).toBe('republished');
    expect(deps.publish).toHaveBeenCalled();
  });

  it('a failed deploy throws so the step is retried', async () => {
    const { hooks } = setup({}, { publish: vi.fn(async () => ({ ok: false, siteId: 'x', reason: 'deploy-failed' as const })) });
    await expect(hooks.onDomainLinked('fresh-cuts', 'x.com')).rejects.toThrow(/publish-failed/);
  });

  it('works without a base-URL store (before site-subpages lands)', async () => {
    const { hooks } = setup({}, { setSiteBaseUrl: undefined });
    expect(await hooks.onDomainLinked('fresh-cuts', 'x.com')).toBe('republished');
  });
});
