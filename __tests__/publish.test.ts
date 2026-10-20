import * as store from '@/lib/siteStore';
import { ApiError } from '@/lib/api';
import {
  PENDING_MESSAGE, PRODUCT_IDS, pickLatestTransactionId, publishFlow, resumePendingPublish,
  type PublishDeps,
} from '@/lib/publish';
import type { SiteRecord } from '@/lib/siteStore';

const M = '⁣';

const site = {
  draftId: 'd1',
  inputs: { shopName: 'Fade' },
  data: {
    shopName: 'Fade',
    area: 'Brooklyn, NY',
    phone: '555',
    hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' },
    about: { heading: 'About', description: ['one'], imageUrl: '' },
    services: [{ title: 'Cut', price: '$30', description: 'd', imageUrl: '' }],
    gallery: ['https://cdn.example/g0.jpg'],
  },
  updatedAt: 1,
  slug: null,
  deployedUrl: null,
  transactionId: null,
} as unknown as SiteRecord;

const LIVE = { siteId: 'fade-brooklyn', deployedUrl: 'https://fade-brooklyn.aibarber.org', republished: false };

function makeDeps(over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    hasEntitlement: jest.fn(async () => false),
    showPaywall: jest.fn(async () => 'purchased' as const),
    latestTransactionId: jest.fn(async () => 'tx-1'),
    iosPublish: jest.fn(async () => LIVE),
    store,
    userId: () => null,
    ...over,
  };
}

beforeEach(async () => {
  jest.useRealTimers();
  await store.saveSite(site);
  await store.savePendingPublish(null);
});

test('skips paywall when entitled', async () => {
  const deps = makeDeps({ hasEntitlement: jest.fn(async () => true) });
  const out = await publishFlow(site, deps);
  expect(deps.showPaywall).not.toHaveBeenCalled();
  expect(out).toEqual({ kind: 'live', url: LIVE.deployedUrl, republished: false });
  const saved = await store.loadSite();
  expect(saved).toMatchObject({ slug: LIVE.siteId, deployedUrl: LIVE.deployedUrl, transactionId: 'tx-1' });
  expect(await store.loadPendingPublish()).toBeNull();
});

test('declined paywall publishes nothing', async () => {
  const deps = makeDeps({ showPaywall: jest.fn(async () => 'declined' as const) });
  const out = await publishFlow(site, deps);
  expect(out).toEqual({ kind: 'declined' });
  expect(deps.latestTransactionId).not.toHaveBeenCalled();
  expect(deps.iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).toBeNull();
  expect(await store.loadSite()).toEqual(site);
});

test('pending publish is saved before the API call', async () => {
  let pendingAtCall: store.PendingPublish | null = null;
  const deps = makeDeps({
    iosPublish: jest.fn(async () => {
      pendingAtCall = await store.loadPendingPublish();
      throw new ApiError(503, 'temporarily-unavailable', 'later');
    }),
  });
  const out = await publishFlow(site, deps);
  expect(pendingAtCall).toMatchObject({ transactionId: 'tx-1', data: { shopName: 'Fade' } });
  // A 5xx keeps the pending publish for the launch retry.
  expect(out).toEqual({ kind: 'pending', message: PENDING_MESSAGE });
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-1' });
  expect((await store.loadSite())?.slug).toBeNull();
});

test('waits for a lagging transaction id, then gives up as pending', async () => {
  jest.useFakeTimers();
  const late = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue('tx-late');
  const p1 = publishFlow(site, makeDeps({ latestTransactionId: late }));
  await jest.advanceTimersByTimeAsync(2000);
  expect(await p1).toMatchObject({ kind: 'live' });
  expect(late).toHaveBeenCalledTimes(3);

  const never = jest.fn(async () => null);
  const deps = makeDeps({ latestTransactionId: never });
  const p2 = publishFlow(site, deps);
  await jest.advanceTimersByTimeAsync(5000);
  expect(await p2).toEqual({ kind: 'pending', message: PENDING_MESSAGE });
  expect(never).toHaveBeenCalledTimes(4); // first try + 3 retries, 1 s apart
  expect(deps.iosPublish).not.toHaveBeenCalled();
});

test('retries a pending publish on launch', async () => {
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: 1 });
  const deps = makeDeps({ iosPublish: jest.fn(async () => ({ ...LIVE, republished: true })) });
  const out = await resumePendingPublish(deps);
  expect(deps.iosPublish).toHaveBeenCalledWith({ transactionId: 'tx-9', siteData: site.data, userId: null });
  expect(deps.showPaywall).not.toHaveBeenCalled();
  expect(out).toEqual({ kind: 'live', url: LIVE.deployedUrl, republished: true });
  expect(await store.loadPendingPublish()).toBeNull();
  expect(await store.loadSite()).toMatchObject({ slug: LIVE.siteId, transactionId: 'tx-9' });

  // Nothing pending: nothing to do.
  expect(await resumePendingPublish(makeDeps())).toBeNull();
  // Still offline: the pending publish stays for the next launch.
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: 1 });
  const offline = makeDeps({ iosPublish: jest.fn(async () => { throw new ApiError(0, 'network', 'offline'); }) });
  expect(await resumePendingPublish(offline)).toEqual({ kind: 'pending', message: PENDING_MESSAGE });
  expect(await store.loadPendingPublish()).not.toBeNull();
});

test('402 shows inactive and keeps the site', async () => {
  const deps = makeDeps({
    iosPublish: jest.fn(async () => { throw new ApiError(402, 'subscription-inactive', 'inactive'); }),
  });
  expect(await publishFlow(site, deps)).toEqual({ kind: 'inactive' });
  expect(await store.loadSite()).toEqual(site);
  expect(await store.loadPendingPublish()).toBeNull();
});

test('a rejected payload (4xx) clears the pending publish and throws', async () => {
  const deps = makeDeps({
    iosPublish: jest.fn(async () => { throw new ApiError(400, 'bad-request', 'bad-request'); }),
  });
  await expect(publishFlow(site, deps)).rejects.toMatchObject({ status: 400 });
  expect(await store.loadPendingPublish()).toBeNull();
  expect(await store.loadSite()).toEqual(site);
});

test('publish payload has no data URLs or markers', async () => {
  const dirty = {
    ...site,
    data: {
      ...site.data,
      shopName: `${M}a${M}Fade${M}/${M}`,
      hero: { heading: `${M}b${M}Sharp${M}/${M}`, tagline: 't', imageUrl: 'data:image/png;base64,AAAA' },
      about: { heading: 'About', description: [`${M}c${M}one${M}/${M}`], imageUrl: ' DATA:image/jpeg;base64,BB' },
      gallery: ['https://cdn.example/g0.jpg', 'data:image/png;base64,CC'],
      staff: [{ name: 'Jo', photo: 'data:image/png;base64,DD' }],
    },
  } as unknown as SiteRecord;
  await store.saveSite(dirty);
  let pendingAtCall: store.PendingPublish | null = null;
  const deps = makeDeps({
    iosPublish: jest.fn(async () => {
      pendingAtCall = await store.loadPendingPublish();
      return LIVE;
    }),
  });
  await publishFlow(dirty, deps);
  const body = (deps.iosPublish as jest.Mock).mock.calls[0][0];
  const json = JSON.stringify(body.siteData);
  expect(json).not.toMatch(/data:/i);
  expect(json).not.toContain(M);
  expect(body.siteData.shopName).toBe('Fade');
  expect(body.siteData.hero).toMatchObject({ heading: 'Sharp', imageUrl: '' });
  // Slots keep their index so images stay matched to their place.
  expect(body.siteData.gallery).toEqual(['https://cdn.example/g0.jpg', '']);
  // The pending copy is the same clean payload.
  expect(pendingAtCall!.data).toEqual(body.siteData);
  // The editor's own record is never rewritten with the cleaned data.
  expect(JSON.stringify((await store.loadSite())?.data)).toContain(M);
});

test('latestTransactionId picks the newest active AI Barber subscription', () => {
  const sub = (transactionId: string, productId: string, purchaseDate: string, isActive = true, isRevoked = false) =>
    ({ transactionId, productId, purchaseDate, isActive, isRevoked });
  expect(PRODUCT_IDS).toEqual([
    'com.ibrahim1774.aibarber.hosting.monthly',
    'com.ibrahim1774.aibarber.hosting.yearly',
  ]);
  const [monthly, yearly] = PRODUCT_IDS;
  expect(
    pickLatestTransactionId([
      sub('old', monthly, '2026-09-01T00:00:00Z'),
      sub('newest', yearly, '2026-10-19T00:00:00Z'),
      sub('mid', monthly, '2026-10-01T00:00:00Z'),
      sub('expired', yearly, '2026-10-20T00:00:00Z', false),
      sub('revoked', monthly, '2026-10-20T01:00:00Z', true, true),
      sub('other-app', 'com.other.pro', '2026-10-20T02:00:00Z'),
    ]),
  ).toBe('newest');
  expect(pickLatestTransactionId([])).toBeNull();
  expect(pickLatestTransactionId([sub('x', monthly, '2026-10-01T00:00:00Z', false)])).toBeNull();
});
