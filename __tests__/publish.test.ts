import * as store from '@/lib/siteStore';
import { ApiError } from '@/lib/api';
import {
  PENDING_MESSAGE, PRODUCT_IDS, UNCONFIRMED_MESSAGE, UPDATING_MESSAGE, pickLatestTransactionId, publishBusy,
  publishFlow, resumePendingPublish, type PublishDeps,
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
  // Paid per the paywall but no transaction found: never "payment went through".
  expect(await p2).toEqual({ kind: 'pending', message: UNCONFIRMED_MESSAGE });
  expect(never).toHaveBeenCalledTimes(4); // first try + 3 retries, 1 s apart
  expect(deps.iosPublish).not.toHaveBeenCalled();
  // The purchase is remembered without an id, for the launch retry to look up.
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: null });
});

test('retries a pending publish on launch', async () => {
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now() });
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
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now() });
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

test('bad-request clears the pending publish and throws', async () => {
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
    'com.ibrahim1774.aibarber.bookings.monthly',
    'com.ibrahim1774.aibarber.bookings.yearly',
    'com.ibrahim1774.aibarber.store.monthly',
    'com.ibrahim1774.aibarber.store.yearly',
  ]);
  // A Bookings or Store purchase counts as paid at publish: no hosting.* required.
  expect(
    pickLatestTransactionId([
      sub('b', 'com.ibrahim1774.aibarber.bookings.monthly', '2026-10-20T00:00:00Z'),
      sub('s', 'com.ibrahim1774.aibarber.store.yearly', '2026-10-21T00:00:00Z'),
    ]),
  ).toBe('s');
  const [monthly, yearly] = [PRODUCT_IDS[0], PRODUCT_IDS[1]];
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

const fail = (status: number, code: string) =>
  jest.fn(async () => { throw new ApiError(status, code, code); });

test.each([
  [404, 'not-found'],
  [400, 'bad-bundle'],
  [400, 'bad-product'],
  [408, 'http-408'],
  [429, 'http-429'],
  [200, 'bad-response'],
  [502, 'publish-failed'],
  [0, 'network'],
])('%i %s keeps the pending publish and returns pending', async (status, code) => {
  const out = await publishFlow(site, makeDeps({ iosPublish: fail(status, code) }));
  expect(out).toEqual({ kind: 'pending', message: PENDING_MESSAGE });
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-1' });
});

test('the pending record (with no id yet) is saved as soon as the purchase is verified', async () => {
  let pendingAtLookup: store.PendingPublish | null = null;
  await publishFlow(site, makeDeps({
    latestTransactionId: jest.fn(async () => {
      pendingAtLookup = await store.loadPendingPublish();
      return 'tx-1';
    }),
  }));
  expect(pendingAtLookup).toMatchObject({ transactionId: null, data: { shopName: 'Fade' } });
});

test('an entitled republish that hits a 5xx says the site is still updating, never "payment went through"', async () => {
  const deps = makeDeps({ hasEntitlement: jest.fn(async () => true), iosPublish: fail(503, 'temporarily-unavailable') });
  expect(await publishFlow(site, deps)).toEqual({ kind: 'pending', message: UPDATING_MESSAGE });
  // No purchase this run: nothing saved before the transaction was found.
  const net = makeDeps({ hasEntitlement: jest.fn(async () => true), iosPublish: fail(0, 'network') });
  expect(await publishFlow(site, net)).toEqual({ kind: 'pending', message: UPDATING_MESSAGE });
});

test('an entitled user with no transaction found is unconfirmed and saves nothing', async () => {
  jest.useFakeTimers();
  const deps = makeDeps({ hasEntitlement: jest.fn(async () => true), latestTransactionId: jest.fn(async () => null) });
  const p = publishFlow(site, deps);
  await jest.advanceTimersByTimeAsync(5000);
  expect(await p).toEqual({ kind: 'pending', message: UNCONFIRMED_MESSAGE });
  expect(await store.loadPendingPublish()).toBeNull();
});

test('a null-id pending publish looks up the transaction on resume', async () => {
  await store.savePendingPublish({ transactionId: null, data: site.data, createdAt: Date.now() });
  const deps = makeDeps({ latestTransactionId: jest.fn(async () => 'tx-found'), iosPublish: fail(503, 'temporarily-unavailable') });
  expect(await resumePendingPublish(deps)).toMatchObject({ kind: 'pending' });
  expect(deps.iosPublish).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-found' }));
  // The found id is kept on the record for the next try.
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-found' });

  const ok = makeDeps();
  expect(await resumePendingPublish(ok)).toMatchObject({ kind: 'live' });
  expect(ok.latestTransactionId).not.toHaveBeenCalled();
});

test('a null-id pending publish with no subscription is dropped', async () => {
  await store.savePendingPublish({ transactionId: null, data: site.data, createdAt: Date.now() });
  const deps = makeDeps({ latestTransactionId: jest.fn(async () => null) });
  expect(await resumePendingPublish(deps)).toBeNull();
  expect(deps.iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).toBeNull();
});

test('a failed lookup keeps a null-id pending publish', async () => {
  await store.savePendingPublish({ transactionId: null, data: site.data, createdAt: Date.now() });
  const deps = makeDeps({ latestTransactionId: jest.fn(async () => { throw new Error('not configured'); }) });
  // Unverified at this point: never "payment went through".
  expect(await resumePendingPublish(deps)).toEqual({ kind: 'pending', message: UPDATING_MESSAGE });
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: null });
});

test('resume lookup timeout keeps the null-id record', async () => {
  jest.useFakeTimers();
  await store.savePendingPublish({ transactionId: null, data: site.data, createdAt: Date.now() });
  const deps = makeDeps({ latestTransactionId: jest.fn(() => new Promise<string | null>(() => {})) });
  let out: unknown = 'unsettled';
  const p = resumePendingPublish(deps).then((o) => (out = o));
  await jest.advanceTimersByTimeAsync(5999);
  expect(out).toBe('unsettled');
  await jest.advanceTimersByTimeAsync(1);
  await p;
  expect(out).toEqual({ kind: 'pending', message: UPDATING_MESSAGE });
  expect(deps.iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: null });
  // The queue is free again for the next publish.
  expect(publishBusy()).toBe(false);
});

test('publishBusy is true after a retry only while a user publish waits behind it', async () => {
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now() });
  let release: (() => void) | null = null;
  const slow = makeDeps({
    iosPublish: jest.fn(() => new Promise<typeof LIVE>((r) => { release = () => r(LIVE); })),
  });
  const seen: boolean[] = [];
  const retry = resumePendingPublish(slow).then((o) => { seen.push(publishBusy()); return o; });
  const tap = publishFlow(site, makeDeps({ hasEntitlement: jest.fn(async () => true) }));
  for (let i = 0; i < 100 && !release; i++) await Promise.resolve(); // until the retry is sending
  release!();
  expect(await retry).toMatchObject({ kind: 'live' });
  await tap;
  expect(seen).toEqual([true]); // the layout leaves navigation to the queued tap
  // Alone, a finished retry leaves the queue idle.
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now() });
  const alone = await resumePendingPublish(makeDeps()).then((o) => ({ o, busy: publishBusy() }));
  expect(alone).toMatchObject({ o: { kind: 'live' }, busy: false });
});

test('a pending publish older than 7 days is dropped', async () => {
  const old = Date.now() - 8 * 24 * 60 * 60 * 1000;
  await store.savePendingPublish({ transactionId: 'tx-old', data: site.data, createdAt: old });
  const deps = makeDeps();
  expect(await resumePendingPublish(deps)).toBeNull();
  expect(deps.iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).toBeNull();
});

test('a bad-request on resume clears the record and throws', async () => {
  await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now() });
  await expect(resumePendingPublish(makeDeps({ iosPublish: fail(400, 'bad-request') }))).rejects.toMatchObject({ code: 'bad-request' });
  expect(await store.loadPendingPublish()).toBeNull();
});

test('send strips Book / Shop links the plan lacks, from the entitlements mirror', async () => {
  const { setEntitlementsFromStatus, resetEntitlementsForTests } = require('@/lib/entitlements');
  setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }] });
  try {
    const withLinks = {
      ...site,
      data: { ...site.data, bookingUrl: 'https://www.aibarber.org/book/fade', shopUrl: 'https://www.aibarber.org/shop/fade' },
    } as unknown as SiteRecord;
    const deps = makeDeps({ hasEntitlement: jest.fn(async () => true) });
    await publishFlow(withLinks, deps);
    const sent = (deps.iosPublish as jest.Mock).mock.calls[0][0].siteData;
    expect(sent.bookingUrl).toBeUndefined();
    expect(sent.shopUrl).toBeUndefined();
  } finally {
    resetEntitlementsForTests();
  }
});

describe('publish decides the Book / Shop links from the choice', () => {
  const { setEntitlementsFromStatus, resetEntitlementsForTests } = require('@/lib/entitlements');
  const OWN = 'https://booksy.com/en-us/1_fade';
  // The site's own pages (served from the barber's domain).
  const AI = '/book';
  const withPrefs = {
    ...site,
    inputs: { ...site.inputs, ownBookingUrl: OWN, bookingChoice: 'aibarber' },
    data: { ...site.data, bookingUrl: AI },
  } as unknown as SiteRecord;
  afterEach(resetEntitlementsForTests);

  const run = async (ids: string[], extra: object = {}) => {
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) });
    await store.saveSite(withPrefs);
    const ents = require('@/lib/entitlements').getEntitlements();
    const deps = makeDeps({
      hasEntitlement: jest.fn(async () => true),
      linkContext: async () => ({ ents, shop: { slug: 'fade-brooklyn', purchaseLinked: true, bookingsEnabled: true }, storeEnabled: true, ...extra }),
    });
    await publishFlow(withPrefs, deps);
    return (deps.iosPublish as jest.Mock).mock.calls[0][0].siteData;
  };

  test('Bookings plan sends the AI Barber link', async () => {
    expect((await run(['hosting', 'bookings'])).bookingUrl).toBe(AI);
  });
  test('after a downgrade to Website it falls back to the own link', async () => {
    const sent = await run(['hosting']);
    expect(sent.bookingUrl).toBe(OWN);
    expect(sent.shopUrl).toBeUndefined();
  });
  test('Store plan adds the shop link', async () => {
    expect((await run(['hosting', 'bookings', 'store'])).shopUrl).toBe('/shop');
  });

  test('a failed shop lookup is unknown: the site keeps its links and only plan-lacking ones are stripped', async () => {
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }] });
    await store.saveSite(withPrefs);
    const deps = makeDeps({ hasEntitlement: jest.fn(async () => true), linkContext: async () => null });
    await publishFlow(withPrefs, deps);
    const sent = (deps.iosPublish as jest.Mock).mock.calls[0][0].siteData;
    expect(sent.bookingUrl).toBe(AI); // kept: bookings is entitled
  });
  test('loadLinkContext returns null (not "no shop") when the lookup throws', async () => {
    jest.resetModules();
    jest.doMock('@/lib/shop', () => ({ loadMyShop: async () => { throw new Error('offline'); } }));
    jest.doMock('@/lib/store/data', () => ({ loadStoreSettings: async () => ({ storeEnabled: true }) }));
    const { sb } = require('../test/mocks/supabase');
    const { loadLinkContext } = require('@/lib/linkContext');
    sb.setSession({ access_token: 't', user: { id: 'u' } });
    await expect(loadLinkContext()).resolves.toBeNull();
    jest.dontMock('@/lib/shop');
    jest.dontMock('@/lib/store/data');
  });
});


describe('team profiles: staff is refreshed from ab_members before it goes online', () => {
  const withTeam = { ...site, data: { ...site.data, staff: [{ name: 'Stale', memberId: '3f2b8a52-6c1d-4e1f-9a57-0c9d1d2e3f40' }] } } as unknown as SiteRecord;
  test('the refreshed staff is what is sent', async () => {
    await store.saveSite(withTeam);
    const deps = makeDeps({
      hasEntitlement: jest.fn(async () => true),
      refreshTeam: jest.fn(async (d) => ({ ...d, staff: [{ name: 'Fresh', memberId: '3f2b8a52-6c1d-4e1f-9a57-0c9d1d2e3f40' }] })),
    });
    await publishFlow(withTeam, deps);
    expect((deps.iosPublish as jest.Mock).mock.calls[0][0].siteData.staff[0].name).toBe('Fresh');
  });
  test('a refresh that throws or hangs never blocks the publish: the saved staff is sent', async () => {
    await store.saveSite(withTeam);
    const deps = makeDeps({ hasEntitlement: jest.fn(async () => true), refreshTeam: jest.fn(async () => { throw new Error('offline'); }) });
    const out = await publishFlow(withTeam, deps);
    expect(out.kind).toBe('live');
    expect((deps.iosPublish as jest.Mock).mock.calls[0][0].siteData.staff[0].name).toBe('Stale');
  });
});
