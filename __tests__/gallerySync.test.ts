// B2: gallery (and every other field) survives edit -> sync -> sign out -> sign in, whatever the clocks say.
// Uses the fake `sites` table with the prod updated_at trigger (server clock on every UPDATE).
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { signIn, signOut } from '@/lib/auth';
import { pullSiteFromAccount, syncIfSignedIn } from '@/lib/account';
import { setGalleryPhoto } from '@/lib/sections/gallery';
import { publishPayload } from '@/lib/publish';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'barber@example.com' };
const DRAFT = '7d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6';
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const url = (n: number | string) => `https://storage.example/ios-drafts/${DRAFT}/${n}.jpg`;

const six = ['hero0', 'about1', 2, 3, 4, 5, 6, 7].map((n) => url(n));
const baseData = (): any => ({
  shopName: 'Fade Factory', area: 'Brooklyn, NY', phone: '(718) 555-0100', template: 'luxe', colorTheme: 'gold',
  bookingUrl: 'https://booksy.com/fade',
  hero: { heading: 'Sharp cuts', tagline: 'since 2010', imageUrl: url('h') },
  about: { heading: 'About', description: ['one', 'two'], imageUrl: url('a') },
  services: [{ name: 'Fade', price: '$30', description: 'd' }],
  gallery: six,
});
const record = (over: Partial<SiteRecord> = {}): SiteRecord => ({
  draftId: DRAFT,
  inputs: { shopName: 'Fade Factory', area: 'Brooklyn, NY', phone: '(718) 555-0100' },
  data: baseData(), updatedAt: T0, slug: null, deployedUrl: null, transactionId: null,
  ownerUserId: USER.id, accountSyncedAt: T0, ...over,
});
const signedIn = () => sb.setSession({ access_token: 'tok', user: USER });
const signInAgain = async () => {
  const session = { access_token: 'tok', user: USER };
  supabase.auth.signInWithPassword.mockImplementationOnce(async () => { sb.setSession(session); return { data: { user: USER, session }, error: null }; });
  await signIn(USER.email, 'pw1234');
};
/** The account already holds this record (first push was an INSERT, which keeps the client's time). */
async function seedAccount(r: SiteRecord) {
  sb.liveTable = true;
  sb.serverNow = () => r.updatedAt;
  signedIn();
  await store.saveSite(r);
  await syncIfSignedIn(r);
}

beforeEach(async () => {
  jest.useRealTimers(); jest.restoreAllMocks(); sb.reset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await store.clearSite(); await store.savePendingPublish(null);
});

type Edit = [string, (d: any) => any, (d: any) => unknown];
const EDITS: Edit[] = [
  ['gallery slot 4 replaced', (d) => setGalleryPhoto(d, 4, url('new4')), (d) => d.gallery],
  ['shop name', (d) => ({ ...d, shopName: 'Fade Factory 2' }), (d) => d.shopName],
  ['hero heading and tagline', (d) => ({ ...d, hero: { ...d.hero, heading: 'New', tagline: 'tag' } }), (d) => d.hero],
  ['hero photo', (d) => ({ ...d, hero: { ...d.hero, imageUrl: url('h2') } }), (d) => d.hero.imageUrl],
  ['about photo and text', (d) => ({ ...d, about: { ...d.about, imageUrl: url('a2'), description: ['x'] } }), (d) => d.about],
  ['services', (d) => ({ ...d, services: [...d.services, { name: 'Beard', price: '$15', description: '' }] }), (d) => d.services],
];

describe('round trip: edit, push, sign out, sign in', () => {
  test.each(EDITS)('%s survives with sane clocks', async (_n, edit, pick) => {
    await seedAccount(record());
    const edited = edit(baseData());
    sb.serverNow = () => T0 + 60_000;
    await store.saveSite(record({ data: edited, updatedAt: T0 + 30_000 }));
    await signOut();
    expect(await store.loadSite()).toBeNull();
    await signInAgain();
    const back = (await store.loadSite())!;
    expect(pick(back.data)).toEqual(pick(edited));
    if (_n.startsWith('gallery')) {
      expect(back.data.gallery).toHaveLength(8);
      expect(back.data.gallery.filter(Boolean)).toHaveLength(8);
      expect(back.data.gallery[4]).toBe(url('new4'));
    }
  });

  test.each(EDITS)('%s survives when the phone clock is behind the server', async (_n, edit, pick) => {
    await seedAccount(record());
    // The last push (an UPDATE) was stamped with the server's time, 10 minutes ahead of this phone.
    sb.serverNow = () => T0 + 600_000;
    await syncIfSignedIn(record({ updatedAt: T0 + 1000 }));
    const edited = edit(baseData());
    // The phone's clock is still behind that stamp when the edit is made.
    await store.saveSite(record({ data: edited, updatedAt: T0 + 5000, accountSyncedAt: T0 + 1000 }));
    sb.serverNow = () => T0 + 700_000;
    await signOut();
    await signInAgain();
    expect(pick((await store.loadSite())!.data)).toEqual(pick(edited));
  });

  test('an older snapshot pushed after a newer local edit never replaces it', async () => {
    const older = record({ data: { ...baseData(), gallery: baseData().gallery.map((u: string, i: number) => (i === 7 ? '' : u)) }, updatedAt: T0 });
    await seedAccount(older);
    const newer = record({ data: baseData(), updatedAt: T0 + 5000, accountSyncedAt: T0 });
    await store.saveSite(newer);
    // onLive pushes the publish-time (older) record while the barber kept editing.
    sb.serverNow = () => T0 + 6000;
    await syncIfSignedIn(older);
    expect((await store.loadSite())!.data.gallery.filter(Boolean)).toHaveLength(8);
    sb.serverNow = () => T0 + 9000;
    await signOut();
    await signInAgain();
    const back = (await store.loadSite())!;
    expect(back.data.gallery).toEqual(baseData().gallery);
  });

  test('pulling with an unsynced local edit keeps the local copy', async () => {
    await seedAccount(record());
    sb.rows[0].updated_at = new Date(T0 + 600_000).toISOString(); // looks newer
    const edited = { ...baseData(), shopName: 'Local only' };
    await store.saveSite(record({ data: edited, updatedAt: T0 + 2000, accountSyncedAt: T0 }));
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    expect((await store.loadSite())!.data.shopName).toBe('Local only');
  });

  test('a web edit made after our last push is still adopted', async () => {
    await seedAccount(record());
    sb.serverNow = () => T0 + 1000;
    await store.saveSite(record({ updatedAt: T0 + 500 }));
    await syncIfSignedIn();
    expect((await store.loadSite())!.accountSyncedAt).toBe(T0 + 500);
    // The web writes: new content, no app markers, a later server time.
    // Like the real web editor, it writes back the site_data it loaded, so the phone's old editedAt stays in it.
    const w = sb.rows[0];
    sb.rows[0] = { ...w, site_data: { ...w.site_data, shopName: 'Edited On Web' }, updated_at: new Date(T0 + 90_000).toISOString() };
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');
    expect((await store.loadSite())!.data.shopName).toBe('Edited On Web');
  });

  test('two web edits in a row are both adopted, even when the follow-up push failed and old markers remain', async () => {
    await seedAccount(record());
    const web = (name: string, at: number) => {
      const w = sb.rows[0];
      sb.rows[0] = { ...w, site_data: { ...w.site_data, shopName: name }, updated_at: new Date(at).toISOString() };
    };
    web('Web One', T0 + 90_000);
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');
    // The push after adopting failed: the phone keeps its adopted stamps. Web edit 2 still carries the old marker.
    web('Web Two', T0 + 180_000);
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');
    expect((await store.loadSite())!.data.shopName).toBe('Web Two');
  });

  test('another phone with a slow clock: its newer edit is adopted and not overwritten on sign-out', async () => {
    await seedAccount(record()); // phone B: edited and pushed at 12:00, no edits since
    // Phone A (clock 5 minutes slow) edited at real 12:03 and pushed. The server stamps its own time.
    const w = sb.rows[0];
    sb.rows[0] = {
      ...w, site_data: { ...w.site_data, shopName: 'From Phone A', editedAt: T0 - 120_000 },
      updated_at: new Date(T0 + 180_000).toISOString(),
    };
    sb.serverNow = () => T0 + 240_000;
    await signOut(); // pulls first, then pushes whatever the phone then holds
    expect(sb.rows[0].site_data.shopName).toBe('From Phone A');
    await signInAgain();
    expect((await store.loadSite())!.data.shopName).toBe('From Phone A');
    expect(sb.rows[0].site_data.shopName).toBe('From Phone A');
  });

  test('a legacy row and record (no revision fields) with an unsynced local edit keeps local', async () => {
    sb.liveTable = false;
    sb.rows = [{ id: DRAFT, user_id: USER.id, site_data: { ...baseData(), source: 'ios' }, deployed_url: null, updated_at: new Date(T0 + 600_000).toISOString() }];
    const edited = { ...baseData(), shopName: 'Local edit' };
    await store.saveSite(record({ data: edited, updatedAt: T0 + 1000, accountSyncedAt: undefined }));
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    expect((await store.loadSite())!.data.shopName).toBe('Local edit');
  });

  test('phone clock 10 minutes fast: first-push INSERT is stamped by the server, so a later web edit is adopted and not overwritten', async () => {
    sb.liveTable = true;
    signedIn();
    // Edited at phone time T0+10min (fast clock); the server's real time is T0.
    const r = record({ updatedAt: T0 + 600_000, accountSyncedAt: undefined, ownerUserId: undefined });
    await store.saveSite(r);
    sb.serverNow = () => T0;
    await syncIfSignedIn(r); // INSERT: the row must carry the server's T0, not the phone's T0+10min
    expect(sb.rows[0].updated_at).toBe(new Date(T0).toISOString());
    expect(sb.upserts[sb.upserts.length - 1].row).not.toHaveProperty('updated_at');
    // A web edit at server time T0+3min.
    const w = sb.rows[0];
    sb.rows[0] = { ...w, site_data: { ...w.site_data, shopName: 'Web Edit' }, updated_at: new Date(T0 + 180_000).toISOString() };
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');
    expect((await store.loadSite())!.data.shopName).toBe('Web Edit');
  });

  test('a legacy record (synced, but no accountRowAt) keeps local even when the row looks newer', async () => {
    sb.liveTable = false;
    sb.rows = [{ id: DRAFT, user_id: USER.id, site_data: { ...baseData(), source: 'ios', shopName: 'Row' }, deployed_url: null, updated_at: new Date(T0 + 600_000).toISOString() }];
    await store.saveSite(record({ accountSyncedAt: T0 }));
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    expect((await store.loadSite())!.data.shopName).toBe('Fade Factory');
  });
});
