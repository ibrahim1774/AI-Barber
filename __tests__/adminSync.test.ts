import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { ApiError } from '@/lib/api';
import { SYNC_NOTICE, withDiskVersion, UPDATED_ON_PUBLISH_MESSAGE, resetSyncState, syncFromServer, takeNotice } from '@/lib/adminSync';
import { restore as restoreRaw, type Restored, type RestoreDeps } from '@/lib/account';
import { onSiteAdopted } from '@/lib/siteEvents';
import { publishFlow, resumePendingPublish, type PublishDeps } from '@/lib/publish';

/** restore() narrowed to a restored site: these tests are signed in with an active site to bring back. */
const restore = async (d: RestoreDeps) => (await restoreRaw(d)) as Restored | null;


const data = (name: string) => ({
  shopName: name, area: 'Brooklyn', phone: '555',
  hero: { heading: 'h', tagline: 't', imageUrl: '' }, about: { heading: 'a', description: ['x'], imageUrl: '' },
  services: [], gallery: [],
}) as any;

const local = (over: Partial<SiteRecord> = {}): SiteRecord => ({
  draftId: 'd1',
  inputs: { shopName: 'Fade', ownBookingUrl: 'https://booksy.com/fade', bookingChoice: 'own' },
  data: data('Fade'),
  updatedAt: 100, slug: 'fade', deployedUrl: 'https://fade.aibarber.org', transactionId: 'tx-1',
  serverVersion: 2, editedBy: 'owner', syncedAt: 100,
  ...over,
}) as SiteRecord;

const server = (over: any = {}) => ({
  siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', active: true,
  siteData: data('Fade Lab'), version: 3, editedBy: 'admin', editedAt: '2026-10-21T10:00:00Z', ...over,
});

const sync = (res: any) => syncFromServer({ iosSite: jest.fn(async () => res) as any, store });

beforeEach(async () => {
  await store.clearSite();
  await store.savePendingPublish(null);
  resetSyncState();
  await takeNotice();
});

test('adopts a newer admin copy, keeps the Book prefs, queues the notice once', async () => {
  await store.saveSite(local());
  const out = await sync(server());
  expect(out.kind).toBe('adopted');
  const s = (await store.loadSite())!;
  expect(s.data.shopName).toBe('Fade Lab');
  expect(s.serverVersion).toBe(3);
  expect(s.editedBy).toBe('admin');
  expect(s.inputs.ownBookingUrl).toBe('https://booksy.com/fade');
  expect(s.inputs.bookingChoice).toBe('own');
  expect(await takeNotice()).toBe(SYNC_NOTICE);
  expect(await takeNotice()).toBeNull();
  expect((await store.loadSite())!.noticePending).toBeUndefined();
  // Same version again: nothing to adopt.
  expect((await sync(server())).kind).toBe('none');
  expect(await takeNotice()).toBeNull();
});

test('unpublished local edits are replaced and the notice says so', async () => {
  await store.saveSite(local({ updatedAt: 500 }));
  await sync(server());
  expect(await takeNotice()).toMatch(/Changes you had not published/);
});

test('does not adopt an owner edit, only learns the version', async () => {
  await store.saveSite(local());
  expect((await sync(server({ editedBy: 'owner' }))).kind).toBe('none');
  const s = (await store.loadSite())!;
  expect(s.data.shopName).toBe('Fade');
  expect(s.serverVersion).toBe(3);
  expect(await takeNotice()).toBeNull();
});

test('older server without version fields: nothing changes', async () => {
  await store.saveSite(local({ serverVersion: undefined }));
  const { version, editedBy, editedAt, ...old } = server();
  expect((await sync(old)).kind).toBe('none');
  expect((await store.loadSite())!.data.shopName).toBe('Fade');
});

test('network errors, no transaction and a different site are silent', async () => {
  await store.saveSite(local());
  const bad = await syncFromServer({ iosSite: jest.fn(async () => { throw new ApiError(0, 'network', 'off'); }) as any, store });
  expect(bad.kind).toBe('none');
  expect((await sync(server({ siteId: 'other', deployedUrl: 'https://other.aibarber.org' }))).kind).toBe('none');
  await store.saveSite(local({ transactionId: null }));
  expect((await sync(server())).kind).toBe('none');
  expect((await store.loadSite())!.data.shopName).toBe('Fade');
});

function deps(over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    hasEntitlement: async () => true,
    showPaywall: async () => 'purchased',
    latestTransactionId: async () => 'tx-1',
    iosPublish: jest.fn(async () => ({ siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: true, version: 4, editedBy: 'owner' as const, editedAt: 'now' })),
    store,
    accessToken: async () => 'tok',
    claimStart: jest.fn(async () => ({ ok: true as const, state: 'unclaimed' as const, claimExpiresAt: '2026-11-25T00:00:00.000Z' })),
    ...over,
  };
}

test('publish sends baseVersion and stores the returned version', async () => {
  const rec = local();
  await store.saveSite(rec);
  const d = deps();
  const out = await publishFlow(rec, d);
  expect(out.kind).toBe('live');
  expect((d.iosPublish as jest.Mock).mock.calls[0][0].baseVersion).toBe(2);
  const s = (await store.loadSite())!;
  expect(s).toMatchObject({ serverVersion: 4, editedBy: 'owner', editedAt: 'now' });
});

test('publish without version info omits baseVersion', async () => {
  const rec = local({ serverVersion: undefined });
  await store.saveSite(rec);
  const d = deps({ iosPublish: jest.fn(async () => ({ siteId: 'fade', deployedUrl: 'https://fade.aibarber.org', republished: true })) });
  await publishFlow(rec, d);
  expect('baseVersion' in (d.iosPublish as jest.Mock).mock.calls[0][0]).toBe(false);
  expect((await store.loadSite())!.serverVersion).toBeUndefined();
});

test('409 site-updated adopts the server copy and never republishes', async () => {
  const rec = local();
  await store.saveSite(rec);
  const iosPublish = jest.fn(async () => {
    throw new ApiError(409, 'site-updated', 'site-updated', {
      error: 'site-updated',
      site: { siteData: data('Fade Lab'), deployedUrl: 'https://fade.aibarber.org', version: 5, editedBy: 'admin', editedAt: 'x' },
    });
  });
  const out = await publishFlow(rec, deps({ iosPublish: iosPublish as any }));
  expect(out).toEqual({ kind: 'site-updated', message: UPDATED_ON_PUBLISH_MESSAGE });
  expect(iosPublish).toHaveBeenCalledTimes(1);
  const s = (await store.loadSite())!;
  expect(s.data.shopName).toBe('Fade Lab');
  expect(s.serverVersion).toBe(5);
  expect(s.inputs.ownBookingUrl).toBe('https://booksy.com/fade');
  expect(await store.loadPendingPublish()).toBeNull();
});

test('a newer admin edit found right before publish stops the publish', async () => {
  const rec = local();
  await store.saveSite(rec);
  const d = deps({ syncFromServer: (tx) => syncFromServer({ iosSite: async () => server() as any, store }, tx) });
  const out = await publishFlow(rec, d);
  expect(out.kind).toBe('site-updated');
  expect(d.iosPublish).not.toHaveBeenCalled();
  expect((await store.loadSite())!.data.shopName).toBe('Fade Lab');
});

test('the notice survives a restart: it is on the record until shown', async () => {
  await store.saveSite(local());
  await sync(server());
  expect((await store.loadSite())!.noticePending).toBe(SYNC_NOTICE);
});

test('a legacy published record without syncedAt gets the softer wording', async () => {
  await store.saveSite(local({ syncedAt: undefined, serverVersion: undefined, editedBy: undefined }));
  expect((await sync(server())).kind).toBe('adopted');
  expect(await takeNotice()).toMatch(/Any changes you had not published/);
});

test('concurrent syncs share one request and one adoption', async () => {
  await store.saveSite(local());
  const iosSite = jest.fn(async () => server());
  const seen: SiteRecord[] = [];
  const off = onSiteAdopted((s) => seen.push(s));
  const [a, b] = await Promise.all([
    syncFromServer({ iosSite: iosSite as any, store }),
    syncFromServer({ iosSite: iosSite as any, store }),
  ]);
  off();
  expect(iosSite).toHaveBeenCalledTimes(1);
  expect(a).toBe(b);
  expect(seen).toHaveLength(1);
});

test('throttled syncs skip the request; timeouts and edits during the request are handled', async () => {
  await store.saveSite(local());
  const iosSite = jest.fn(async () => server({ editedBy: 'owner' }));
  await syncFromServer({ iosSite: iosSite as any, store }, null, { throttleMs: 60000 });
  await syncFromServer({ iosSite: iosSite as any, store }, null, { throttleMs: 60000 });
  expect(iosSite).toHaveBeenCalledTimes(1);
  resetSyncState();
  // The barber edits while the request is in flight: the lost-edits sentence is judged on the latest record.
  await store.saveSite(local());
  const slow = jest.fn(async () => {
    await store.saveSite(local({ updatedAt: 900 }));
    return server();
  });
  await syncFromServer({ iosSite: slow as any, store });
  expect(await takeNotice()).toMatch(/Changes you had not published/);
});

test('adoption drops a pending publish; resume then posts nothing', async () => {
  await store.saveSite(local());
  await store.savePendingPublish({ transactionId: 'tx-1', data: data('Old'), createdAt: Date.now(), baseVersion: 2 });
  await sync(server());
  expect(await store.loadPendingPublish()).toBeNull();
  const d = deps();
  expect(await resumePendingPublish(d)).toBeNull();
  expect(d.iosPublish).not.toHaveBeenCalled();
});

test('a resumed publish carries the baseVersion it was built on', async () => {
  await store.saveSite(local({ serverVersion: 7 }));
  await store.savePendingPublish({ transactionId: 'tx-1', data: data('Old'), createdAt: Date.now(), baseVersion: 2 });
  const d = deps();
  await resumePendingPublish(d);
  expect((d.iosPublish as jest.Mock).mock.calls[0][0].baseVersion).toBe(2);
});

test('409 without a copy in the body falls back to a fetch, and errors if that fails too', async () => {
  const rec = local();
  await store.saveSite(rec);
  const bare = jest.fn(async () => { throw new ApiError(409, 'site-updated', 'site-updated', { error: 'site-updated' }); });
  const out = await publishFlow(rec, deps({
    iosPublish: bare as any,
    syncFromServer: (tx) => syncFromServer({ iosSite: async () => server() as any, store }, tx),
  }));
  expect(out.kind).toBe('site-updated');
  expect((await store.loadSite())!.data.shopName).toBe('Fade Lab');

  resetSyncState();
  await store.saveSite(rec);
  await expect(
    publishFlow(rec, deps({ iosPublish: bare as any, syncFromServer: async () => ({ kind: 'none' as const }) })),
  ).rejects.toBeInstanceOf(ApiError);
});

test('restore() adopts a newer admin copy of the same site and marks the record synced', async () => {
  await store.saveSite(local());
  const res = await restore({
    restorePurchases: async () => {},
    latestTransactionId: async () => 'tx-1',
    iosSite: (async () => server()) as any,
    accessToken: async () => 'tok',
    store,
  } as any);
  expect(res!.site.data.shopName).toBe('Fade Lab');
  expect(res!.site.serverVersion).toBe(3);
  expect(res!.site.syncedAt).toBe(res!.site.updatedAt);
  expect(res!.site.inputs.ownBookingUrl).toBe('https://booksy.com/fade');
});

test('withDiskVersion copies a publish/learn version but never an admin one', () => {
  const cur = local({ serverVersion: 2, editedBy: 'owner', syncedAt: 100 });
  expect(withDiskVersion(cur, cur)).toBeNull();
  const published = withDiskVersion(cur, local({ serverVersion: 4, editedBy: 'owner', syncedAt: 150 }))!;
  expect(published).toMatchObject({ serverVersion: 4, syncedAt: 150 });
  expect(published.data).toBe(cur.data);
  expect(withDiskVersion(cur, local({ serverVersion: 5, editedBy: 'admin' }))).toBeNull();
});
