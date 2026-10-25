// E1: signing into a different account on a phone that holds another account's site.
import * as analytics from '@/lib/analytics';
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { startDraft } from '@/lib/flow';
import { pullSiteFromAccount } from '@/lib/account';
import { signIn, signOut, takeEmptyAccountNotice } from '@/lib/auth';
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
  draftId: A_DRAFT,
  inputs: { shopName: 'A Cuts', area: 'Brooklyn, NY', phone: '(718) 555-0100' },
  data: dataFor('A Cuts'),
  updatedAt: 1000,
  slug: 'a-cuts',
  deployedUrl: 'https://a-cuts.aibarber.org',
  transactionId: 'tx-A',
  ownerUserId: A.id,
  ...extra,
});

const rowB = (over: Record<string, unknown> = {}, source: string | undefined = 'ios') => ({
  id: B_DRAFT,
  user_id: B.id,
  site_data: { ...dataFor('B Fades'), ...(source ? { source } : {}) },
  deployed_url: 'https://b-fades.aibarber.org',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});

function signInAs(u: { id: string; email: string }) {
  const session = { access_token: 'tok', user: u };
  supabase.auth.signInWithPassword.mockImplementationOnce(async () => {
    sb.setSession(session);
    return { data: { user: u, session }, error: null };
  });
}

beforeEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  sb.reset();
  takeEmptyAccountNotice();
  await store.clearSite();
  await store.savePendingPublish(null);
});

describe('account switching', () => {
  test("A's site on the phone, B signs in with an app-made row: B's site replaces it and nothing is written", async () => {
    await store.saveSite(siteA());
    sb.rows = [rowB()];
    signInAs(B);
    await signIn(B.email, 'pw1234');

    const now = await store.loadSite();
    expect(now).toMatchObject({ draftId: B_DRAFT, ownerUserId: B.id, slug: null, transactionId: null, deployedUrl: 'https://b-fades.aibarber.org' });
    expect(now?.data.shopName).toBe('B Fades');
    expect((now?.data as any).source).toBeUndefined();
    expect(sb.upserts).toHaveLength(0);
    expect(takeEmptyAccountNotice()).toBeNull();
  });

  test('a web-made row (no ios marker) is adopted when it is plain site data', async () => {
    await store.saveSite(siteA());
    sb.rows = [rowB({}, undefined)];
    signInAs(B);
    await signIn(B.email, 'pw1234');
    expect((await store.loadSite())?.data.shopName).toBe('B Fades');
    expect(sb.upserts).toHaveLength(0);
  });

  test('an app-made row wins over a newer web-made one', async () => {
    await store.saveSite(siteA());
    sb.rows = [
      rowB({ id: 'web-row', updated_at: '2026-10-20T00:00:00.000Z', site_data: dataFor('Web Made') }),
      rowB(),
    ];
    signInAs(B);
    await signIn(B.email, 'pw1234');
    expect((await store.loadSite())?.draftId).toBe(B_DRAFT);
  });

  test('a web-made row that is not plain site data is ignored', async () => {
    await store.saveSite(siteA());
    sb.rows = [rowB({ site_data: ['not', 'a', 'site'] }, undefined)];
    signInAs(B);
    await signIn(B.email, 'pw1234');
    expect(await store.loadSite()).toBeNull();
  });

  test("B has no site: A's local site and pending publish are cleared, nothing is written, A's row is untouched", async () => {
    await store.saveSite(siteA());
    await store.savePendingPublish({ transactionId: 'tx-A', data: siteA().data, createdAt: 5 });
    sb.rows = [{ ...rowB(), id: A_DRAFT, user_id: A.id }];
    signInAs(B);
    await signIn(B.email, 'pw1234');

    expect(await store.loadSite()).toBeNull();
    expect(await store.loadPendingPublish()).toBeNull();
    expect(sb.upserts).toHaveLength(0);
    expect(takeEmptyAccountNotice()).toEqual({ email: B.email });
    expect(takeEmptyAccountNotice()).toBeNull(); // read once
  });

  test('the lookup failing signs B out again and shows nothing of A', async () => {
    await store.saveSite(siteA());
    sb.selectError = { message: 'offline' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    signInAs(B);
    await expect(signIn(B.email, 'pw1234')).rejects.toThrow(/sign in again/i);
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(sb.upserts).toHaveLength(0);
    // A's copy is kept for A.
    expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
  });

  test('the same user signing in again keeps the pull-then-sync path', async () => {
    await store.saveSite(siteA());
    sb.rows = [{ ...rowB(), id: A_DRAFT, user_id: A.id, updated_at: '1970-01-01T00:00:00.500Z' }];
    signInAs(A);
    await signIn(A.email, 'pw1234');
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row).toMatchObject({ id: A_DRAFT, user_id: A.id });
    expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
  });

  test('a legacy record without an owner is adopted by the account that signs in (today)', async () => {
    const { ownerUserId: _o, ...legacy } = siteA();
    await store.saveSite(legacy as SiteRecord);
    signInAs(B);
    await signIn(B.email, 'pw1234');
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row).toMatchObject({ id: A_DRAFT, user_id: B.id });
    expect((await store.loadSite())?.ownerUserId).toBe(B.id);
  });

  test('a sync stamps the owner on the local record', async () => {
    await store.saveSite(siteA({ ownerUserId: undefined }));
    signInAs(A);
    await signIn(A.email, 'pw1234');
    expect((await store.loadSite())?.ownerUserId).toBe(A.id);
  });

  test("a record owned by another account is never written under this account's id", async () => {
    await store.saveSite(siteA());
    sb.setSession({ access_token: 't', user: B });
    const { syncIfSignedIn } = require('@/lib/account');
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await syncIfSignedIn();
    expect(sb.upserts).toHaveLength(0);
  });

  test('a launch pull never adopts into a record owned by someone else', async () => {
    await store.saveSite(siteA());
    sb.rows = [{ ...rowB(), id: A_DRAFT, user_id: B.id, updated_at: '2026-10-20T00:00:00.000Z' }];
    expect(await pullSiteFromAccount(B.id)).toBe('unchanged');
    expect((await store.loadSite())?.data.shopName).toBe('A Cuts');
  });

  test('a pull that adopts stamps the owner', async () => {
    sb.rows = [rowB()];
    expect(await pullSiteFromAccount(B.id)).toBe('adopted');
    expect((await store.loadSite())?.ownerUserId).toBe(B.id);
  });

  test('startDraft keeps the owner of the record it replaces', async () => {
    await store.saveSite(siteA());
    await startDraft({ inputs: { shopName: 'New', area: 'x', phone: '1' }, site: dataFor('New') });
    expect((await store.loadSite())?.ownerUserId).toBe(A.id);
  });

  test('the owner id never reaches analytics', async () => {
    const trackSpy = jest.spyOn(analytics, 'track');
    await store.saveSite(siteA());
    sb.rows = [rowB()];
    signInAs(B);
    await signIn(B.email, 'pw1234');
    expect(JSON.stringify(trackSpy.mock.calls)).not.toContain(A.id);
    expect(JSON.stringify(trackSpy.mock.calls)).not.toContain(B.id);
  });
});

describe('sign out', () => {
  test('pushes the site to the account, then clears the local copy', async () => {
    await store.saveSite(siteA({ ownerUserId: undefined }));
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row).toMatchObject({ id: A_DRAFT, user_id: A.id });
    expect(await store.loadSite()).toBeNull();
  });

  test('keeps the local site when the final push fails', async () => {
    await store.saveSite(siteA());
    sb.setSession({ access_token: 't', user: A });
    sb.upsertError = { message: 'offline' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await signOut();
    expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  test('keeps the local site while a paid publish is pending', async () => {
    await store.saveSite(siteA());
    await store.savePendingPublish({ transactionId: 'tx-A', data: siteA().data, createdAt: 5 });
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
    expect(await store.loadPendingPublish()).not.toBeNull();
  });

  test('keeps a site owned by a different account', async () => {
    await store.saveSite(siteA({ ownerUserId: B.id }));
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect(sb.upserts).toHaveLength(0);
    expect(await store.loadSite()).not.toBeNull();
  });

  test('signing out when signed in with no site just signs out', async () => {
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });
});
