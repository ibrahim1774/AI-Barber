// Review fixes for E1/E2/F1: sign-up switch, unsaved edits, cancelled switch, reset ordering, publish guard.
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { restore as restoreRaw, type Restored, type RestoreDeps, pushSiteBeforeSignOut, switchAccountSite, UNSAVED_OTHER_ACCOUNT } from '@/lib/account';
import { resetPasswordWithCode, signIn, signUp, takeEmptyAccountNotice } from '@/lib/auth';

/** restore() narrowed to a restored site: these tests are signed in with an active site to bring back. */
const restore = async (d: RestoreDeps) => (await restoreRaw(d)) as Restored | null;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const A = { id: 'aaaaaaaa-2222-4333-8444-555555555555', email: 'a@example.com' };
const B = { id: 'bbbbbbbb-2222-4333-8444-555555555555', email: 'b@example.com' };
const A_DRAFT = '7d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6';
const B_DRAFT = '9e1d2a3b-4c5d-4e6f-8a70-8192a3b4c5d6';

const dataFor = (name: string): any => ({
  shopName: name, area: 'Brooklyn, NY', phone: '(718) 555-0100', template: 'luxe', colorTheme: 'gold',
  hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' },
  about: { heading: 'About', description: ['one'], imageUrl: 'https://cdn.example/a.jpg' }, services: [], gallery: [],
});
const siteA = (extra: Partial<SiteRecord> = {}): SiteRecord => ({
  draftId: A_DRAFT, inputs: { shopName: 'A Cuts', area: 'Brooklyn, NY', phone: '(718) 555-0100' }, data: dataFor('A Cuts'),
  updatedAt: 1000, accountSyncedAt: 1000, slug: 'a-cuts', deployedUrl: 'https://a-cuts.aibarber.org', transactionId: 'tx-A',
  ownerUserId: A.id, ...extra,
});
const rowB = () => ({
  id: B_DRAFT, user_id: B.id, site_data: { ...dataFor('B Fades'), source: 'ios' },
  deployed_url: 'https://b-fades.aibarber.org', updated_at: '2026-10-01T00:00:00.000Z',
});

beforeEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  sb.reset();
  takeEmptyAccountNotice();
  await store.clearSite();
  await store.savePendingPublish(null);
});

test("sign-up as B on A's phone swaps A's site off instead of showing and failing to save it", async () => {
  await store.saveSite(siteA());
  supabase.auth.signUp.mockImplementationOnce(async () => {
    const session = { access_token: 't', user: { ...B, identities: [{}] } };
    sb.setSession(session);
    return { data: { user: session.user, session }, error: null };
  });
  await signUp(B.email, 'pw1234', '', '');
  expect(await store.loadSite()).toBeNull();
  expect(sb.upserts).toHaveLength(0);
  expect(takeEmptyAccountNotice()).toEqual({ email: B.email });
});

test("B signing in does not wipe A's unsynced edits", async () => {
  await store.saveSite(siteA({ updatedAt: 2000, accountSyncedAt: 1000 }));
  sb.rows = [rowB()];
  const session = { access_token: 't', user: B };
  supabase.auth.signInWithPassword.mockImplementationOnce(async () => {
    sb.setSession(session);
    return { data: { user: B, session }, error: null };
  });
  await expect(signIn(B.email, 'pw1234')).rejects.toThrow(UNSAVED_OTHER_ACCOUNT);
  expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
  expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});

test("B signing in does not wipe A's paid pending publish", async () => {
  await store.saveSite(siteA());
  await store.savePendingPublish({ transactionId: 'tx-A', data: siteA().data, createdAt: 5 });
  sb.rows = [rowB()];
  await expect(switchAccountSite(B.id)).rejects.toThrow(UNSAVED_OTHER_ACCOUNT);
  expect(await store.loadPendingPublish()).not.toBeNull();
  expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
});

test('a cancelled (timed out) switch writes nothing', async () => {
  await store.saveSite(siteA());
  sb.rows = [rowB()];
  await expect(switchAccountSite(B.id, () => false)).rejects.toThrow(/cancelled/);
  expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
});

test('sign-out pushes the latest edits even while a publish is pending, and keeps the site', async () => {
  sb.setSession({ access_token: 't', user: A });
  await store.saveSite(siteA({ updatedAt: 2000, accountSyncedAt: 1000 }));
  await store.savePendingPublish({ transactionId: 'tx-A', data: siteA().data, createdAt: 5 });
  expect(await pushSiteBeforeSignOut()).toBe(false);
  expect(sb.upserts).toHaveLength(1);
  expect((await store.loadSite())?.accountSyncedAt).toBe(2000);
});

test('a failed account switch after a reset code does not burn the code: the password is set first', async () => {
  await store.saveSite(siteA({ updatedAt: 2000, accountSyncedAt: 1000 }));
  const calls: string[] = [];
  supabase.auth.verifyOtp.mockImplementationOnce(async () => {
    calls.push('verifyOtp');
    const session = { access_token: 'otp', user: B };
    sb.setSession(session);
    return { data: { session, user: B }, error: null };
  });
  supabase.auth.updateUser.mockImplementationOnce(async () => {
    calls.push('updateUser');
    return { data: { user: B }, error: null };
  });
  await expect(resetPasswordWithCode(B.email, '123456', 'n3w-pass', 'n3w-pass')).rejects.toThrow(UNSAVED_OTHER_ACCOUNT);
  expect(calls).toEqual(['verifyOtp', 'updateUser']);
});

const bSiteNoSlug = () => siteA({ draftId: B_DRAFT, slug: null, transactionId: null, deployedUrl: undefined, ownerUserId: B.id });

test("Restore while B is signed in never reuses B's draft id for A's site", async () => {
  await store.saveSite(bSiteNoSlug());
  sb.setSession({ access_token: 'b', user: B });
  const res = await restore({
    restorePurchases: async () => undefined,
    latestTransactionId: async () => 'tx-A',
    iosSite: (async () => ({ siteId: 'a-cuts', deployedUrl: 'https://a-cuts.aibarber.org', siteData: dataFor('A Cuts'), active: true })) as any,
    store,
  });
  expect(res?.site.draftId).not.toBe(B_DRAFT);
});

test("Restore while signed out never asks the site endpoint and never copies a site: A's site stays off the phone", async () => {
  const iosSite = jest.fn();
  const claimStart = jest.fn(async () => { throw new (require('@/lib/api').ApiError)(409, 'purchase-claimed', 'x'); });
  await store.saveSite(siteA({ slug: null, deployedUrl: null, transactionId: null, ownerUserId: undefined }));
  await expect(restore({
    restorePurchases: async () => undefined, latestTransactionId: async () => 'tx-A', iosSite: iosSite as any, claimStart: claimStart as any, store,
  })).rejects.toMatchObject({ code: 'sign-in-required' });
  expect(iosSite).not.toHaveBeenCalled();
  expect((await store.loadSite())?.slug).toBeNull();
});
