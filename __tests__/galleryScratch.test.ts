// Scratch-built site: replace a gallery photo, push, sign out/in; the preview gallery must not change.
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { signIn, signOut } from '@/lib/auth';
import { syncIfSignedIn } from '@/lib/account';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'barber@example.com' };
const DRAFT = '7d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6';
const T0 = Date.parse('2026-10-20T12:00:00.000Z');
const url = (n: number | string) => `https://storage.example/ios-drafts/${DRAFT}/${n}.jpg`;

import { manualSite } from '@/lib/importer';
import { setPhoto } from '@/lib/pageHero';
import { buildPreviewHtml } from '@/lib/editable';
import { withPagesByDefault } from '@/lib/sitePages';
import { switchDesign } from '@/lib/editor';

const previewCount = (d: any) => (buildPreviewHtml(d, true).match(/data-edit-image="gallery\.\d+"/g) ?? []).length;
const record = (data: any): SiteRecord => ({
  draftId: DRAFT, inputs: { shopName: 'S', area: '', phone: '' } as any, data, updatedAt: T0, slug: null, deployedUrl: null,
  transactionId: null, ownerUserId: USER.id, accountSyncedAt: T0,
});
const signedIn = () => sb.setSession({ access_token: 'tok', user: USER });
const signInAgain = async () => {
  const session = { access_token: 'tok', user: USER };
  supabase.auth.signInWithPassword.mockImplementationOnce(async () => { sb.setSession(session); return { data: { user: USER, session }, error: null }; });
  await signIn(USER.email, 'pw1234');
};
beforeEach(async () => {
  jest.useRealTimers(); jest.restoreAllMocks(); sb.reset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  await store.clearSite(); await store.savePendingPublish(null);
});

describe.each(['luxe', 'prime'] as const)('scratch site (%s): replace one gallery photo, sync, sign out/in', (tpl) => {
  test('preview gallery count is unchanged', async () => {
    const { site } = await manualSite({ shopName: 'Fade', area: 'NYC', address: '1 Main St', phone: '(718) 555-0100', colorTheme: 'goldBlack' });
    const start = withPagesByDefault(switchDesign(site, tpl));
    const before = previewCount(start);
    const slot = tpl === 'luxe' ? 4 : 3;
    const edited = setPhoto(start, `gallery.${slot}`, url('mine'));
    const beforeEdit = previewCount(edited);
    console.log(tpl, 'gallery', JSON.stringify(edited.gallery.map((u: string) => u.slice(-18))), 'before', before, 'afterEdit', beforeEdit);
    sb.liveTable = true; sb.serverNow = () => T0; signedIn();
    await store.saveSite(record(start)); await syncIfSignedIn(record(start));
    sb.serverNow = () => T0 + 60_000;
    await store.saveSite(record({ ...edited }) && { ...record(edited), updatedAt: T0 + 30_000 });
    await signOut(); await signInAgain();
    const back = (await store.loadSite())!;
    expect(back.data.gallery).toEqual(edited.gallery);
    expect(previewCount(back.data)).toBe(beforeEdit);
  });
});
