import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { ApiError } from '@/lib/api';
import { SYNC_NOTICE, UPDATED_ON_PUBLISH_MESSAGE, syncFromServer, takeNotice } from '@/lib/adminSync';
import { publishFlow, type PublishDeps } from '@/lib/publish';

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
  takeNotice();
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
  expect(takeNotice()).toBe(SYNC_NOTICE);
  expect(takeNotice()).toBeNull();
  // Same version again: nothing to adopt.
  expect((await sync(server())).kind).toBe('none');
  expect(takeNotice()).toBeNull();
});

test('unpublished local edits are replaced and the notice says so', async () => {
  await store.saveSite(local({ updatedAt: 500 }));
  await sync(server());
  expect(takeNotice()).toMatch(/not published/);
});

test('does not adopt an owner edit, only learns the version', async () => {
  await store.saveSite(local());
  expect((await sync(server({ editedBy: 'owner' }))).kind).toBe('none');
  const s = (await store.loadSite())!;
  expect(s.data.shopName).toBe('Fade');
  expect(s.serverVersion).toBe(3);
  expect(takeNotice()).toBeNull();
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
    userId: () => null,
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
