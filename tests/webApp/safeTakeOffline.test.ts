import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const order: string[] = [];
const rm = {
  releaseDomains: vi.fn(async (s: string) => { order.push(`domain:${s}`); }),
  clearSiteBase: vi.fn(async (s: string) => { order.push(`base:${s}`); }),
  deleteContent: vi.fn(async (s: string) => { order.push(`content:${s}`); }),
  deployOffline: vi.fn(async (s: string) => { order.push(`offline:${s}`); }),
  markRemoved: vi.fn(async () => { order.push('removed'); }),
  markTakenDown: vi.fn(async () => { order.push('stamp'); }),
  now: () => 1,
};
const webSite = { original_transaction_id: 'web:sub_1', site_slug: 'fresh-cuts', environment: 'Production', published_at: 'x' };
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async (path: string) => {
    if (path.startsWith('web_app_sites?user_id=')) return [{ slug: 'fresh-cuts', stripe_subscription_id: 'sub_1', environment: 'live', published_at: 'x' }];
    return [];
  }),
  stripeCall: vi.fn(),
}));
vi.mock('../../lib/ios/deleteAccount.js', () => ({ liveDeleteDeps: vi.fn(() => ({ listSites: async () => [] })) }));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: vi.fn(() => rm) }));
vi.mock('../../lib/webApp/reliability.js', () => ({
  suspendWork: vi.fn(async () => { order.push('suspend'); }),
  markSiteOffline: vi.fn(async () => { order.push('markSiteOffline'); }),
}));

import { liveWebDeleteDeps, removeWebSitesOf } from '../../lib/webApp/deleteAccount.js';
import { runWebPublish, type WebPublishDeps } from '../../lib/webApp/publishFlow.js';

describe('removeWebSitesOf', () => {
  beforeEach(() => { order.length = 0; vi.clearAllMocks(); });
  afterEach(() => vi.unstubAllEnvs());

  it('switch off: today\'s order, full purge', async () => {
    expect(await removeWebSitesOf('u1')).toBe(1);
    expect(order).toEqual(['suspend', 'offline:fresh-cuts', 'domain:fresh-cuts', 'content:fresh-cuts', 'markSiteOffline']);
    expect(rm.clearSiteBase).not.toHaveBeenCalled();
  });

  it('web account delete with the switch on still does the full purge', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    await liveWebDeleteDeps().purge(webSite as any);
    expect(order).toEqual(['domain:fresh-cuts', 'content:fresh-cuts']);
  });

  it('switch on: taken down, domain released, address cleared, nothing deleted', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    expect(await removeWebSitesOf('u1')).toBe(1);
    expect(order).toEqual(['suspend', 'offline:fresh-cuts', 'domain:fresh-cuts', 'base:fresh-cuts', 'markSiteOffline']);
    expect(rm.deleteContent).not.toHaveBeenCalled();
  });
});

// Web republish after offline: clearDomainRemoval, only with the switch on.
const SITE = {
  shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' },
  about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: 'https://img.example/svc.jpg' }],
  gallery: ['https://img.example/g0.jpg'], craftImages: [], staff: [],
  contact: { address: '1 Main St', email: 'a@b.co' },
};
const USER = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
async function publishOnce(clear: any, markPublished = vi.fn(async () => {})) {
  const row = { slug: 'fresh-cuts', stripe_subscription_id: 'sub_1', user_id: USER, environment: 'live', published_at: 'x', taken_down_at: 'y', removed_at: 'z' };
  const deps: any = {
    environment: 'live',
    userOf: async () => ({ id: USER, email: 'o@example.com' }),
    entitlementOf: async () => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: USER, site_slug: null, tier: 'website', billing_interval: 'month', status: 'active', environment: 'live', current_period_end: null, cancel_at_period_end: false } as any),
    sites: {
      byUser: async () => row, get: async () => row, insertIfAbsent: async () => false, releaseUnpublished: async () => {}, markPublished,
    },
    owners: { get: async () => ({ slug: 'fresh-cuts', user_id: USER }), insertIfAbsent: async () => false },
    isTaken: async () => false,
    readPending: async () => null,
    writePending: async () => {},
    publish: async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.x` }),
    render: () => [],
    rememberSlug: async () => {},
    clearDomainRemoval: clear,
    now: () => 1,
  };
  return runWebPublish({ siteData: SITE } as any, deps as WebPublishDeps, { authorization: 'Bearer tok' });
}

describe('web publish lifts the domain removal', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('switch off: clearDomainRemoval is never called', async () => {
    const clear = vi.fn(async () => {});
    await publishOnce(clear);
    expect(clear).not.toHaveBeenCalled();
  });
  it('switch on: called with the slug after markPublished', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    const clear = vi.fn(async () => {});
    const markPublished = vi.fn(async () => {});
    const r = await publishOnce(clear, markPublished);
    expect(r.status).toBe(200);
    expect(markPublished).toHaveBeenCalled();
    expect(clear).toHaveBeenCalledWith('fresh-cuts');
  });
  it('switch on: a failing clear does not fail the publish; a failing markPublished skips it', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    const bad = vi.fn(async () => { throw new Error('db'); });
    expect((await publishOnce(bad)).status).toBe(200);
    const clear = vi.fn(async () => {});
    expect((await publishOnce(clear, vi.fn(async () => { throw new Error('x'); }))).status).toBe(200);
    expect(clear).not.toHaveBeenCalled();
  });
});
