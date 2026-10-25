// Review fixes for E1/E2/F1: sign-up switch, unsaved edits, cancelled switch, reset ordering, publish guard.
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { restore, pushSiteBeforeSignOut, switchAccountSite, UNSAVED_OTHER_ACCOUNT } from '@/lib/account';
import { resetPasswordWithCode, signIn, signUp, takeEmptyAccountNotice } from '@/lib/auth';
import { BOUND_ELSEWHERE_MESSAGE, publishFlow, resumePendingPublish, type PublishDeps } from '@/lib/publish';
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

test("B's site (no slug) never publishes over the live site the Apple ID is bound to", async () => {
  const bSite = siteA({ draftId: B_DRAFT, slug: null, transactionId: null, deployedUrl: 'https://b-fades.aibarber.org', ownerUserId: B.id });
  const iosPublish = jest.fn();
  const deps: PublishDeps = {
    hasEntitlement: async () => true,
    showPaywall: async () => 'declined',
    latestTransactionId: async () => 'tx-A',
    iosPublish: iosPublish as any,
    store,
    userId: () => B.id,
    boundElsewhere: async () => true,
  };
  const out = await publishFlow(bSite, deps);
  expect(out).toEqual({ kind: 'blocked', message: BOUND_ELSEWHERE_MESSAGE });
  expect(iosPublish).not.toHaveBeenCalled();
});

const bDeps = (over: Partial<PublishDeps>): PublishDeps => ({
  hasEntitlement: async () => true,
  showPaywall: async () => 'declined',
  latestTransactionId: async () => 'tx-A',
  iosPublish: jest.fn() as any,
  store,
  userId: () => B.id,
  ...over,
});
const bSiteNoSlug = () => siteA({ draftId: B_DRAFT, slug: null, transactionId: null, deployedUrl: undefined, ownerUserId: B.id });

test('the blocked message never points at Restore purchases', () => {
  expect(BOUND_ELSEWHERE_MESSAGE).not.toMatch(/restore/i);
});

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

test('the publish guard fails closed: a failed check sends nothing and keeps the paid record', async () => {
  const iosPublish = jest.fn();
  const out = await publishFlow(bSiteNoSlug(), bDeps({
    hasEntitlement: async () => false,
    showPaywall: async () => 'purchased',
    iosPublish: iosPublish as any,
    boundElsewhere: async () => { throw new Error('offline'); },
  }));
  expect(out.kind).toBe('pending');
  expect(iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-A' });
});

test('the launch retry runs the same check: blocked drops the record, an error keeps it, neither sends', async () => {
  await store.saveSite(bSiteNoSlug());
  const iosPublish = jest.fn();
  const pend = { transactionId: 'tx-A', data: dataFor('B Fades'), createdAt: Date.now() };
  await store.savePendingPublish(pend);
  const err = await resumePendingPublish(bDeps({ iosPublish: iosPublish as any, boundElsewhere: async () => { throw new Error('5xx'); } }));
  expect(err?.kind).toBe('pending');
  expect(await store.loadPendingPublish()).not.toBeNull();
  const blocked = await resumePendingPublish(bDeps({ iosPublish: iosPublish as any, boundElsewhere: async () => true }));
  expect(blocked).toEqual({ kind: 'blocked', message: BOUND_ELSEWHERE_MESSAGE });
  expect(await store.loadPendingPublish()).toBeNull();
  expect(iosPublish).not.toHaveBeenCalled();
});

const restoreA = () => restore({
  restorePurchases: async () => undefined,
  latestTransactionId: async () => 'tx-A',
  iosSite: (async () => ({ siteId: 'a-cuts', deployedUrl: 'https://a-cuts.aibarber.org', siteData: dataFor('A Cuts'), active: true })) as any,
  store,
});

test("Restore after B's paid publish is pending: the retry still checks B's site, not the restored one, and sends nothing", async () => {
  sb.setSession({ access_token: 'b', user: B });
  const iosPublish = jest.fn();
  // B pays on A's phone; Superwall lags so the record has no transaction id yet.
  await publishFlow(bSiteNoSlug(), bDeps({
    hasEntitlement: async () => false,
    showPaywall: async () => 'purchased',
    latestTransactionId: async () => null,
    iosPublish: iosPublish as any,
  })).catch(() => undefined);
  expect(await store.loadPendingPublish()).toMatchObject({ transactionId: null, target: { draftId: B_DRAFT, slug: null } });
  await store.saveSite(bSiteNoSlug());
  await restoreA(); // swaps in A's site, which has a slug
  expect((await store.loadSite())?.slug).toBe('a-cuts');
  const boundElsewhere = jest.fn(async (_tx: string, site: SiteRecord) => site.slug !== 'a-cuts');
  const out = await resumePendingPublish(bDeps({ iosPublish: iosPublish as any, boundElsewhere }));
  expect(out).toEqual({ kind: 'blocked', message: BOUND_ELSEWHERE_MESSAGE });
  expect(iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).toBeNull();
});

test('the retry fails closed when it cannot tell which site it was paid for', async () => {
  const iosPublish = jest.fn();
  await store.savePendingPublish({ transactionId: 'tx-A', data: dataFor('B Fades'), createdAt: Date.now() });
  const out = await resumePendingPublish(bDeps({ iosPublish: iosPublish as any, boundElsewhere: async () => false }));
  expect(out?.kind).toBe('pending');
  expect(iosPublish).not.toHaveBeenCalled();
  expect(await store.loadPendingPublish()).not.toBeNull();
});

test("Restore while signed out never keeps the id of a site an account owns", async () => {
  await store.saveSite(siteA({ slug: null, deployedUrl: undefined, transactionId: null })); // A's, kept after an offline sign-out
  expect(supabase.auth.getSession).toBeDefined();
  const res = await restoreA();
  expect(res?.site.draftId).not.toBe(A_DRAFT);
  expect(res?.site.ownerUserId).toBeUndefined();
});

test('Restore while signed out still keeps the id of a never-owned draft', async () => {
  await store.saveSite(siteA({ slug: null, deployedUrl: undefined, transactionId: null, ownerUserId: undefined }));
  const res = await restoreA();
  expect(res?.site.draftId).toBe(A_DRAFT);
});

describe('R1: a paid first publish is never dropped', () => {
  const noAccountSite = () => siteA({ draftId: B_DRAFT, slug: null, transactionId: null, deployedUrl: undefined, ownerUserId: undefined });

  test('first publish with no account: send fails after the server bound the slug, the retry still sends and keeps the record', async () => {
    const site = noAccountSite();
    await store.saveSite(site);
    let bound = false; // the server binds the slug before the deploy fails
    const boundElsewhere = jest.fn(async () => (bound ? true : ('none' as const))); // would block a naive "slug differs" check
    const iosPublish = jest.fn()
      .mockImplementationOnce(async () => { bound = true; throw new Error('502 publish-failed'); })
      .mockImplementationOnce(async () => ({ siteId: 'cuts-xyz', deployedUrl: 'https://cuts-xyz.aibarber.org', slug: 'cuts-xyz' }));
    const deps = bDeps({
      hasEntitlement: async () => false, showPaywall: async () => 'purchased', userId: () => null as any,
      iosPublish: iosPublish as any, boundElsewhere,
    });
    const first = await publishFlow(site, deps);
    expect(first.kind).toBe('pending');
    expect(iosPublish).toHaveBeenCalledTimes(1);
    expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-A', target: { freshBind: true } });
    const retry = await resumePendingPublish(deps);
    expect(retry?.kind).not.toBe('blocked');
    expect(iosPublish).toHaveBeenCalledTimes(2);
  });

  test('cross-account overwrite is still blocked (a site was already bound before the pay)', async () => {
    const site = noAccountSite();
    await store.saveSite(site);
    const iosPublish = jest.fn();
    const out = await publishFlow(site, bDeps({
      hasEntitlement: async () => false, showPaywall: async () => 'purchased',
      iosPublish: iosPublish as any, boundElsewhere: async () => true,
    }));
    expect(out).toEqual({ kind: 'blocked', message: BOUND_ELSEWHERE_MESSAGE });
    expect(iosPublish).not.toHaveBeenCalled();
    expect(await store.loadPendingPublish()).toBeNull();
  });
});
