import Storage from 'expo-sqlite/kv-store';
import {
  clearSite, loadPendingPublish, loadSite, savePendingPublish, saveSite,
  type SiteRecord,
} from '@/lib/siteStore';

const site = {
  draftId: 'd1', inputs: { shopName: 'Fade' }, data: { shopName: 'Fade' },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
} as unknown as SiteRecord;

beforeEach(async () => {
  await clearSite();
  await savePendingPublish(null);
});

test('round-trips a site', async () => {
  expect(await loadSite()).toBeNull();
  await saveSite(site);
  expect(await loadSite()).toEqual(site);
  await clearSite();
  expect(await loadSite()).toBeNull();
});

test('pending publish set and cleared', async () => {
  const p = { transactionId: 't1', data: site.data, createdAt: 5 };
  await savePendingPublish(p);
  expect(await loadPendingPublish()).toEqual(p);
  await savePendingPublish(null);
  expect(await loadPendingPublish()).toBeNull();
});

test('corrupt JSON loads as null', async () => {
  await Storage.setItem('site.v1', '{nope');
  await Storage.setItem('pendingPublish.v1', '{nope');
  expect(await loadSite()).toBeNull();
  expect(await loadPendingPublish()).toBeNull();
});
