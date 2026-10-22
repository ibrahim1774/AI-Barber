/**
 * An admin edit (AI Barber support, from the admin dashboard) arriving at
 * launch, while the barber edits, during a publish and during a pending
 * publish retry. The rule: the admin's copy is never overwritten by a stale
 * phone copy, the barber is told once, and nothing republishes on its own.
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());

import { Alert } from 'react-native';
import { BOOKSY, FakeServer, P, boot, draft, installFetch, kill, type World } from './harness';
import { wipeDisk } from './mocks';

let server: FakeServer;
let w: World;

beforeEach(async () => {
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  try {
    w?.unmount();
  } catch {
    /* unmounted */
  }
  jest.restoreAllMocks();
});

const drain = () => new Promise((r) => setTimeout(r, 20));
const adminTagline = (d: any) => ({ ...d, hero: { ...d.hero, tagline: 'Edited by support' } });

async function publish(world: World) {
  const site = await world.m.siteStore.loadSite();
  return world.m.publish.publishFlow(site!, world.deps);
}

/** What ResumePublish runs at launch and on each return to the foreground. */
async function launchResume(world: World) {
  await world.m.adminSync.syncQuietly();
  return world.m.publish.resumePendingPublish(world.deps);
}

/** What the Edit tab's commitRecord does with the record it holds. */
async function editorCommit(world: World, held: any, change: (d: any) => any) {
  const next = { ...held, data: change(held.data), updatedAt: Date.now() };
  await world.m.siteStore.saveSite(next);
  return next;
}

async function liveSite() {
  w = await boot(server, { user: 'u1' });
  await w.m.siteStore.saveSite(draft({ inputs: { ...draft().inputs, ownBookingUrl: BOOKSY, bookingChoice: 'own' } }));
  w.willBuy(P.bookingsMonthly);
  expect(await publish(w)).toMatchObject({ kind: 'live' });
  await drain();
  await w.superwallSync();
  w.m.adminSync.resetSyncState(); // a minute later
}

describe('admin edit at launch', () => {
  it('adopted before anything else; the notice survives a kill and is shown exactly once', async () => {
    await liveSite();
    server.adminEdit(adminTagline);
    w = await kill(w);
    expect(await launchResume(w)).toBeNull();
    const rec = await w.site();
    expect(rec?.data.hero.tagline).toBe('Edited by support');
    expect(rec).toMatchObject({ serverVersion: 2, editedBy: 'admin', noticePending: w.m.adminSync.SYNC_NOTICE });
    // Killed before the Edit tab showed it.
    w = await kill(w);
    expect(await w.m.adminSync.takeNotice()).toBe(w.m.adminSync.SYNC_NOTICE);
    expect(await w.m.adminSync.takeNotice()).toBeNull();
    w = await kill(w);
    expect(await w.m.adminSync.takeNotice()).toBeNull();
    // The Book prefs (app-only) were kept through the adoption.
    expect(rec?.inputs).toMatchObject({ ownBookingUrl: BOOKSY, bookingChoice: 'own' });
  });

  it('launch and Edit-tab focus within a minute share / skip the request; publish always checks', async () => {
    await liveSite();
    const before = server.count('/api/ios/site');
    await Promise.all([w.m.adminSync.syncQuietly(), w.m.adminSync.syncQuietly()]);
    await w.m.adminSync.syncQuietly();
    expect(server.count('/api/ios/site') - before).toBe(1);
    await publish(w);
    expect(server.count('/api/ios/site') - before).toBe(2);
  });

  it('offline at launch: nothing adopted, nothing lost; the next publish still refuses to overwrite', async () => {
    await liveSite();
    server.adminEdit(adminTagline);
    w = await kill(w);
    server.fail('/api/ios/site', { kind: 'offline' }, 2);
    await launchResume(w);
    expect((await w.site())?.data.hero.tagline).toBe('Since 2019');
    // Publish: the pre-publish sync is offline too, but the server 409s on the old baseVersion.
    const out = await publish(w);
    expect(out).toMatchObject({ kind: 'site-updated' });
    expect(server.sites.get('fade-lab')!.siteData.hero.tagline).toBe('Edited by support');
    expect((await w.site())?.data.hero.tagline).toBe('Edited by support');
  });
});

describe('admin edit while the barber is editing', () => {
  it('unpublished edits are replaced and the notice says so; a stale editor write cannot publish over the admin copy', async () => {
    await liveSite();
    const held = await editorCommit(w, await w.site(), (d) => ({ ...d, area: 'Queens, NY' }));
    server.adminEdit(adminTagline);
    const sync = await w.m.adminSync.syncQuietly();
    expect(sync).toMatchObject({ kind: 'adopted' });
    expect((sync as any).message).toMatch(/Changes you had not published yet were replaced/);
    // The editor still holds the old record (its reload is async) and commits another change on it.
    await editorCommit(w, held, (d) => ({ ...d, phone: '(555) 999-0000' }));
    // The focus path never stamps the admin version onto the stale editor copy.
    expect(w.m.adminSync.withDiskVersion(held, (await w.site())!)).toBeNull();
    // Publishing that stale copy: re-adopted, nothing sent over the admin's copy.
    const sent = server.published.length;
    const out = await publish(w);
    expect(out.kind).toBe('site-updated');
    expect(server.published.length).toBe(sent);
    expect(server.sites.get('fade-lab')!.siteData.hero.tagline).toBe('Edited by support');
  });

  it('after reviewing the adopted copy, publishing again goes live on top of the admin version', async () => {
    await liveSite();
    server.adminEdit(adminTagline);
    await w.m.adminSync.syncQuietly();
    const out = await publish(w);
    expect(out).toMatchObject({ kind: 'live' });
    expect(server.published.at(-1).hero.tagline).toBe('Edited by support');
    expect(await w.site()).toMatchObject({ serverVersion: 3, editedBy: 'owner' });
  });
});

describe('admin edit during a publish', () => {
  it('found by the pre-publish sync: nothing is sent; the copy is adopted ("Review it and publish again")', async () => {
    await liveSite();
    server.adminEdit(adminTagline);
    const sent = server.published.length;
    const out = await publish(w);
    expect(out).toMatchObject({ kind: 'site-updated' });
    expect((out as any).message.startsWith(w.m.adminSync.UPDATED_ON_PUBLISH_MESSAGE)).toBe(true);
    expect(server.published.length).toBe(sent);
    expect(await w.pending()).toBeNull();
  });

  it('lands between the sync and the publish: 409 with the copy -> adopted, pending cleared', async () => {
    await liveSite();
    server.before['/api/ios/publish'] = [() => server.adminEdit(adminTagline)];
    const out = await publish(w);
    expect(out).toMatchObject({ kind: 'site-updated', message: w.m.adminSync.UPDATED_ON_PUBLISH_MESSAGE });
    expect(await w.pending()).toBeNull();
    expect(await w.site()).toMatchObject({ serverVersion: 2, editedBy: 'admin' });
    expect(server.sites.get('fade-lab')!.siteData.hero.tagline).toBe('Edited by support');
  });

  it('409 without a copy: fetched with GET /api/ios/site and adopted', async () => {
    await liveSite();
    server.conflictBody = false;
    server.before['/api/ios/publish'] = [() => server.adminEdit(adminTagline)];
    w.m.adminSync.resetSyncState();
    const out = await publish(w);
    expect(out.kind).toBe('site-updated');
    expect((await w.site())?.data.hero.tagline).toBe('Edited by support');
  });

  it('409 without a copy and the fetch offline: an error, the pending publish kept; the relaunch resolves it without overwriting', async () => {
    await liveSite();
    server.conflictBody = false;
    server.before['/api/ios/publish'] = [() => server.adminEdit(adminTagline)];
    // The pre-publish sync works (nothing new yet); the fallback fetch after the 409 is offline.
    server.before['/api/ios/site'] = [() => undefined, () => server.fail('/api/ios/site', { kind: 'offline' })];
    await expect(publish(w)).rejects.toMatchObject({ status: 409, code: 'site-updated' });
    expect(await w.pending()).not.toBeNull();
    w = await kill(w);
    await launchResume(w);
    expect(await w.pending()).toBeNull();
    expect(server.sites.get('fade-lab')!.siteData.hero.tagline).toBe('Edited by support');
    expect((await w.site())?.data.hero.tagline).toBe('Edited by support');
  });

  // BUG (race): the publish answer is saved over a version the phone learned while it was in flight.
  it.failing('BUG: a slow publish answer never lowers the version adopted from an admin edit meanwhile', async () => {
    await liveSite();
    let release!: () => void;
    server.fail('/api/ios/publish', { kind: 'held', release: new Promise<void>((r) => (release = r)) });
    const p = publish(w);
    while (server.published.length < 2) await drain(); // the server has accepted it (v2)
    server.adminEdit(adminTagline); // v3, while the answer is still on its way
    // The barber switches apps and back a minute later: ResumePublish's foreground sync adopts v3.
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    expect(await w.m.adminSync.syncQuietly()).toMatchObject({ kind: 'adopted' });
    expect((await w.site())?.serverVersion).toBe(3);
    release();
    await p;
    const rec = await w.site();
    expect(rec?.serverVersion).toBe(3);
    expect(rec?.editedBy).toBe('admin');
  });

  it('observed: after that race the phone holds the admin data stamped v2/owner, and re-adopts with a false "lost edits" notice', async () => {
    await liveSite();
    let release!: () => void;
    server.fail('/api/ios/publish', { kind: 'held', release: new Promise<void>((r) => (release = r)) });
    const p = publish(w);
    while (server.published.length < 2) await drain();
    server.adminEdit(adminTagline);
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    await w.m.adminSync.syncQuietly();
    await w.m.adminSync.takeNotice(); // the Edit tab showed the first notice
    release();
    await p;
    expect(await w.site()).toMatchObject({ serverVersion: 2, editedBy: 'owner' });
    spy.mockReturnValue(now + 125_000);
    const again = await w.m.adminSync.syncQuietly();
    expect(again).toMatchObject({ kind: 'adopted' });
    expect((again as any).message).toMatch(/Changes you had not published yet were replaced/);
  });
});

describe('admin edit during a pending publish retry', () => {
  async function pendingAfter503() {
    await liveSite();
    await editorCommit(w, await w.site(), (d) => ({ ...d, area: 'Queens, NY' }));
    server.fail('/api/ios/publish', { kind: 'json', status: 503, body: { error: 'temporarily-unavailable' } });
    expect(await publish(w)).toMatchObject({ kind: 'pending' });
    expect(await w.pending()).toMatchObject({ baseVersion: 1 });
  }

  it('the launch sync adopts first and drops the stale pending publish: nothing is posted', async () => {
    await pendingAfter503();
    server.adminEdit(adminTagline);
    w = await kill(w);
    const sent = server.published.length;
    expect(await launchResume(w)).toBeNull();
    expect(server.published.length).toBe(sent);
    expect(await w.pending()).toBeNull();
    expect(server.sites.get('fade-lab')!.siteData.hero.tagline).toBe('Edited by support');
    expect((await w.site())?.noticePending).toMatch(/Changes you had not published yet were replaced/);
  });

  it('the launch sync offline: the retry carries its old baseVersion, the server 409s, the copy is adopted', async () => {
    await pendingAfter503();
    server.adminEdit(adminTagline);
    w = await kill(w);
    server.fail('/api/ios/site', { kind: 'offline' });
    const out = await launchResume(w);
    expect(out).toMatchObject({ kind: 'site-updated' });
    expect(server.calls.filter((c) => c.path === '/api/ios/publish').at(-1)?.body.baseVersion).toBe(1);
    expect(await w.pending()).toBeNull();
    expect(server.sites.get('fade-lab')!.siteData.hero.tagline).toBe('Edited by support');
  });

  it('no admin edit: the retry goes live and the record learns the new version', async () => {
    await pendingAfter503();
    w = await kill(w);
    expect(await launchResume(w)).toMatchObject({ kind: 'live' });
    expect(server.published.at(-1).area).toBe('Queens, NY');
    expect(await w.site()).toMatchObject({ serverVersion: 2, editedBy: 'owner' });
  });
});
