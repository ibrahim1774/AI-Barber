import { describe, it, expect, vi } from 'vitest';
import { makeDomainHooks, type DomainHookDeps } from '../lib/ios/domainHooks.js';

const NOW = 1_800_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
const pending = { siteId: 'web-cuts', version: 4, siteData: { shopName: 'Web Cuts', bookingUrl: 'https://aibarber.org/book/x' } } as any;

function setup(over: Partial<DomainHookDeps> = {}, iosRow: any = null) {
  const deps: DomainHookDeps = {
    findBySlug: vi.fn(async () => iosRow),
    webSite: vi.fn(async () => ({ taken_down_at: null, removed_at: null })),
    readPending: vi.fn(async () => pending),
    publish: vi.fn(async () => ({ ok: true, siteId: 'web-cuts', deployedUrl: 'https://web-cuts.vercel.app' })),
    refreshBase: vi.fn(async () => null),
    now: () => NOW,
    ...over,
  };
  return { deps, hooks: makeDomainHooks(deps) };
}

describe('web republish on link (no iOS row)', () => {
  it('republishes the stored copy with force, unchanged (no tier strip), and skips the extra base refresh', async () => {
    const { deps, hooks } = setup();
    expect(await hooks.onDomainLinked('web-cuts', 'webcuts.com')).toBe('republished');
    expect(deps.publish).toHaveBeenCalledWith('web-cuts', { force: true, pending });
    expect(deps.refreshBase).not.toHaveBeenCalled();
    expect(await hooks.onDomainUnlinked('web-cuts')).toBe('republished');
  });

  it('no iOS row and no web row: no-site, base refreshed, nothing published', async () => {
    const { deps, hooks } = setup({ webSite: vi.fn(async () => null) });
    expect(await hooks.onDomainLinked('web-cuts', 'x.com')).toBe('no-site');
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.refreshBase).toHaveBeenCalledWith('web-cuts');
  });

  it.each([
    ['removed', { removed_at: iso(NOW) }],
    ['taken down', { taken_down_at: iso(NOW) }],
  ])('%s web site: no publish, base still refreshed', async (_n, row) => {
    const { deps, hooks } = setup({ webSite: vi.fn(async () => row) });
    expect(await hooks.onDomainLinked('web-cuts', 'x.com')).toBe('site-offline');
    expect(deps.publish).not.toHaveBeenCalled();
    expect(deps.refreshBase).toHaveBeenCalledWith('web-cuts');
  });

  it('no stored copy: no-copy; a failed deploy throws so the step is retried', async () => {
    expect(await setup({ readPending: vi.fn(async () => null) }).hooks.onDomainLinked('web-cuts', 'x.com')).toBe('no-copy');
    const bad = setup({ publish: vi.fn(async () => ({ ok: false, siteId: 'x', reason: 'deploy-failed' as const })) });
    await expect(bad.hooks.onDomainLinked('web-cuts', 'x.com')).rejects.toThrow(/publish-failed/);
  });
});

describe('iOS row present: identical to the iOS-only behaviour', () => {
  const row = {
    original_transaction_id: 's-o1', product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', site_slug: 'web-cuts',
    expires_at: iso(NOW + 1e9), revoked_at: null, taken_down_at: null,
  };
  it('never consults webSite; strips lapsed links as before', async () => {
    const { deps, hooks } = setup({}, row);
    expect(await hooks.onDomainLinked('web-cuts', 'x.com')).toBe('republished');
    expect(deps.webSite).not.toHaveBeenCalled();
    expect((deps.publish as any).mock.calls[0][1].pending.siteData).toEqual({ shopName: 'Web Cuts' });
  });
  it('an offline iOS row stays offline even if a web row exists', async () => {
    const { deps, hooks } = setup({}, { ...row, revoked_at: iso(NOW) });
    expect(await hooks.onDomainLinked('web-cuts', 'x.com')).toBe('site-offline');
    expect(deps.webSite).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });
  it('without a webSite dep (iOS wiring) a missing row is no-site', async () => {
    const { hooks } = setup({ webSite: undefined });
    expect(await hooks.onDomainLinked('web-cuts', 'x.com')).toBe('no-site');
  });
});

import { webDomainPanelStatus } from '../lib/webDomains.js';
import { fakeDomainsRepo, blankRow } from './ios/fakeDomainsRepo.js';
describe('web-domain status probe', () => {
  const authorize = async () => ({ ok: true as const, target: 'web-cuts' });
  const mk = (over: any = {}) => {
    const repo = fakeDomainsRepo();
    repo.rows.set('stripe:sub_1', blankRow({ original_transaction_id: 'stripe:sub_1', source: 'stripe', site_slug: 'web-cuts', domain: 'webcuts.com', state: 'live', auto_renew: true, ...over }));
    return repo;
  };
  const vercel: any = { projectDomain: vi.fn(async () => ({ verified: true })), domainConfig: vi.fn(async () => ({ misconfigured: false })) };
  const call = (flow: any) => webDomainPanelStatus({ siteId: 'web-cuts' }, 'Bearer x', { authorize, flow, getSubscription: async () => null, createPortalSession: async () => ({ ok: false, data: null }) } as any);

  it('with vercel + probeHttps wired, a live real row carries the probe; without them the body is the plain status', async () => {
    const probed: any = await call({ repo: mk(), vercel, probeHttps: async () => false });
    expect(probed.body.vercel).toEqual({ verified: true, dnsOk: true, ssl: 'pending' });
    const plain: any = await call({ repo: mk() });
    expect('vercel' in plain.body).toBe(false);
  });
  it('a simulated row is never probed', async () => {
    const r: any = await call({ repo: mk({ simulated: true }), vercel, probeHttps: async () => true });
    expect('vercel' in r.body).toBe(false);
  });
});
