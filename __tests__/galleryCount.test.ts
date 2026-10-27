// The visible gallery count is 6 in every design, before and after sign out/in, design switch and restore,
// unless the barber removed a photo by hand (then exactly one fewer per removal, and it stays removed).
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { signIn, signOut } from '@/lib/auth';
import { syncIfSignedIn } from '@/lib/account';
import { manualSite } from '@/lib/importer';
import { buildPreviewHtml } from '@/lib/editable';
import { withPagesByDefault } from '@/lib/sitePages';
import { editorRecord, switchDesign } from '@/lib/editor';
import { clearGalleryPhoto, gallerySlots, setGalleryPhoto } from '@/lib/sections/gallery';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'barber@example.com' };
const DRAFT = '7d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6';
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const own = (n: string) => `https://storage.example/ios-drafts/${DRAFT}/${n}.jpg`;
const DESIGNS = ['luxe', 'prime', 'euphoria'] as const;

const shown = (d: any) => (buildPreviewHtml(d, true).match(/data-edit-image="gallery\.\d+"/g) ?? []).length;
const record = (data: any, at = T0): SiteRecord => ({
  draftId: DRAFT, inputs: { shopName: 'S', area: '', phone: '' } as any, data, updatedAt: at, slug: null, deployedUrl: null,
  transactionId: null, ownerUserId: USER.id, accountSyncedAt: T0,
});
const signInAgain = async () => {
  const session = { access_token: 'tok', user: USER };
  supabase.auth.signInWithPassword.mockImplementationOnce(async () => { sb.setSession(session); return { data: { user: USER, session }, error: null }; });
  await signIn(USER.email, 'pw1234');
};
/** push, sign out, sign in, load the way the editor opens it. */
let clock = 0;
async function roundTrip(data: any): Promise<any> {
  sb.liveTable = true; sb.serverNow = () => T0 + 1000 * ++clock;
  sb.setSession({ access_token: 'tok', user: USER });
  await store.saveSite(record(data, T0 + 1000 * ++clock)); await syncIfSignedIn();
  await signOut(); expect(await store.loadSite()).toBeNull();
  await signInAgain();
  return editorRecord({ data: (await store.loadSite())!.data }).data;
}
const open = (d: any) => editorRecord({ data: d }).data;
const switchTo = (d: any, t: (typeof DESIGNS)[number]) => open(t === 'euphoria' ? { ...d, template: t } : switchDesign(d, t));
const scratch = async (t: (typeof DESIGNS)[number]) => {
  const { site } = await manualSite({ shopName: 'Fade', area: 'NYC', address: '1 Main St', phone: '(718) 555-0100', colorTheme: 'goldBlack' });
  return switchTo(withPagesByDefault(site), t);
};
/** A slot this design renders, to edit by hand. */
const aSlot = (d: any) => gallerySlots(d).filter((i) => d.gallery[i])[1];

beforeEach(async () => {
  jest.useRealTimers(); jest.restoreAllMocks(); sb.reset(); clock = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await store.clearSite(); await store.savePendingPublish(null);
});

describe.each(DESIGNS)('%s', (t) => {
  test('scratch site shows 6, replace keeps 6, sign out/in keeps 6 in the same order, switching design keeps 6', async () => {
    const start = await scratch(t);
    expect(shown(start)).toBe(6);
    const replaced = setGalleryPhoto(start, aSlot(start), own('mine'));
    expect(shown(open(replaced))).toBe(6);
    const back = await roundTrip(replaced);
    expect(back.gallery).toEqual(open(replaced).gallery);
    expect(shown(back)).toBe(6);
    expect(back.gallery[aSlot(start)]).toBe(own('mine'));
    for (const to of DESIGNS) {
      const sw = switchTo(back, to);
      expect(shown(sw)).toBe(6);
      expect(sw.gallery.filter((u: string) => u === own('mine'))).toHaveLength(1);
    }
    // there and back again, through a restore
    expect(shown(await roundTrip(switchTo(switchTo(back, 'prime'), t)))).toBe(6);
  });

  test('a manual removal leaves exactly 5, before and after sign out/in and design switches', async () => {
    const start = await scratch(t);
    const removed = open(clearGalleryPhoto(start, aSlot(start)));
    console.log(t, JSON.stringify(removed.galleryRemoved), removed.gallery.map((u: string) => !!u));
    expect(shown(removed)).toBe(5);
    const back = await roundTrip(removed);
    console.log('BACK', JSON.stringify(back.galleryRemoved), back.gallery.map((u: string) => !!u), JSON.stringify(sb.rows[0]?.site_data?.galleryRemoved));
    expect(shown(back)).toBe(5);
    expect(back.gallery).toEqual(removed.gallery);
    for (const to of DESIGNS) expect(shown(switchTo(back, to))).toBe(5);
    expect(shown(await roundTrip(switchTo(back, 'prime')))).toBe(5);
    expect(shown(await roundTrip(switchTo(switchTo(back, 'euphoria'), t)))).toBe(5);
  });

  test('remove then add back: 6 again, stays 6', async () => {
    const start = await scratch(t);
    const slot = aSlot(start);
    const removed = await roundTrip(clearGalleryPhoto(start, slot));
    const added = open(setGalleryPhoto(removed, slot, own('again')));
    expect(shown(added)).toBe(6);
    const back = await roundTrip(added);
    expect(shown(back)).toBe(6);
    for (const to of DESIGNS) expect(shown(switchTo(back, to))).toBe(6);
  });

  test('a Google-import-like site with an expired photo URL keeps its slot (placeholder), the count does not shrink', async () => {
    const start = await scratch(t);
    const dead = 'https://lh3.googleusercontent.com/expired-photo=w800';
    const imported = { ...start, gallery: ['', '', ...[2, 3, 4, 5, 6, 7].map((i) => dead + i)] };
    const back = await roundTrip(imported);
    expect(back.gallery.slice(2)).toEqual(imported.gallery.slice(2));
    expect(shown(back)).toBe(6);
    for (const to of DESIGNS) expect(shown(switchTo(back, to))).toBe(6);
  });

  test('a site with fewer than 6 photos is not padded with invented ones', async () => {
    const few = { ...(await scratch(t)), gallery: [own('a'), '', own('b'), own('c'), '', ''] };
    expect(open(few).gallery).toEqual(few.gallery);
    expect(shown(switchTo(few, 'prime'))).toBeLessThan(6);
  });
});
