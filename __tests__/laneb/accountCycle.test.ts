// Lane B group 8: A -> B -> A on one phone, pending paid publish, offline, sign-out clearing.
import * as store from '@/lib/siteStore';
import type { SiteRecord } from '@/lib/siteStore';
import { signIn, signOut, takeEmptyAccountNotice } from '@/lib/auth';
import { UNSAVED_OTHER_ACCOUNT } from '@/lib/account';
import * as custCache from '@/lib/store/customersCache';
import { getSharedPlan, setSharedPlan } from '@/lib/plan';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const A = { id: 'aaaaaaaa-2222-4333-8444-555555555555', email: 'a@example.com' };
const B = { id: 'bbbbbbbb-2222-4333-8444-555555555555', email: 'b@example.com' };
const A_DRAFT = '7d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6';
const B_DRAFT = '9e1d2a3b-4c5d-4e6f-8a70-8192a3b4c5d6';
const dataFor = (name: string): any => ({
  shopName: name, area: 'Brooklyn, NY', phone: '(718) 555-0100', template: 'luxe', colorTheme: 'gold',
  hero: { heading: 'h', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' },
  about: { heading: 'About', description: ['one'], imageUrl: 'https://cdn.example/a.jpg' }, services: [], gallery: [],
});
const siteOf = (id: string, owner: string, name: string, extra: Partial<SiteRecord> = {}): SiteRecord => ({
  draftId: id, inputs: { shopName: name, area: 'Brooklyn, NY', phone: '(718) 555-0100' }, data: dataFor(name),
  updatedAt: 1000, slug: null, deployedUrl: null, transactionId: null, ownerUserId: owner, accountSyncedAt: 1000, ...extra,
});
const row = (id: string, user: string, name: string, at = '2026-10-01T00:00:00.000Z') => ({
  id, user_id: user, site_data: { ...dataFor(name), source: 'ios' }, deployed_url: null, updated_at: at,
});
const signInAs = (u: { id: string; email: string }) => {
  const session = { access_token: 'tok-' + u.id, user: u };
  supabase.auth.signInWithPassword.mockImplementationOnce(async () => { sb.setSession(session); return { data: { user: u, session }, error: null }; });
};

beforeEach(async () => {
  jest.useRealTimers(); jest.restoreAllMocks(); sb.reset(); takeEmptyAccountNotice();
  await store.clearSite(); await store.savePendingPublish(null);
  custCache.setStoreCustomersCache(null as any);
});

describe('A -> B -> A on one phone', () => {
  it('A signs out (pushed + cleared), B signs in with no site (empty), B signs out, A signs in again: A gets A back, never B', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts', { updatedAt: 2000, accountSyncedAt: 1000 }));
    sb.rows = [row(A_DRAFT, A.id, 'A Cuts old', '1970-01-01T00:00:00.500Z')];
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect(await store.loadSite()).toBeNull();
    expect(sb.upserts.some((u) => (u.row as any).user_id === A.id)).toBe(true);
    const aRow = sb.upserts.at(-1)!.row; sb.rows = [{ ...aRow }];

    signInAs(B); await signIn(B.email, 'pw1234');
    expect(await store.loadSite()).toBeNull();
    expect(sb.upserts.every((u) => (u.row as any).user_id === A.id)).toBe(true); // nothing written for B

    await store.saveSite(siteOf(B_DRAFT, B.id, 'B Fades', { updatedAt: 3000, accountSyncedAt: 3000 }));
    sb.setSession({ access_token: 't', user: B });
    await signOut();

    signInAs(A); await signIn(A.email, 'pw1234');
    const now = await store.loadSite();
    expect(now?.data.shopName).toBe('A Cuts');
    expect(now?.ownerUserId).toBe(A.id);
    expect(JSON.stringify(now)).not.toContain('B Fades');
  });

  it("B's sign-in is refused while A has a pending paid publish; A's pending publish and site survive and A is the only owner", async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts'));
    await store.savePendingPublish({ transactionId: 'tx-A', data: dataFor('A Cuts'), createdAt: 5 } as any);
    sb.rows = [row(B_DRAFT, B.id, 'B Fades')];
    signInAs(B);
    await expect(signIn(B.email, 'pw1234')).rejects.toThrow(UNSAVED_OTHER_ACCOUNT);
    expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
    expect(await store.loadPendingPublish()).not.toBeNull();
    expect(sb.upserts).toHaveLength(0);
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it("B's sign-in is refused while A has unsynced edits (updatedAt > accountSyncedAt)", async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts', { updatedAt: 5000, accountSyncedAt: 4000 }));
    sb.rows = [row(B_DRAFT, B.id, 'B Fades')];
    signInAs(B);
    await expect(signIn(B.email, 'pw1234')).rejects.toThrow(UNSAVED_OTHER_ACCOUNT);
    expect((await store.loadSite())?.data.shopName).toBe('A Cuts');
  });

  it('offline during the lookup: B is signed out again, A keeps everything, no write, session gone', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts'));
    sb.selectThrows = true; sb.selectError = { message: 'Network request failed' };
    signInAs(B);
    await expect(signIn(B.email, 'pw1234')).rejects.toThrow(/sign in again/i);
    expect(sb.session).toBeNull();
    expect((await store.loadSite())?.draftId).toBe(A_DRAFT);
    expect(sb.upserts).toHaveLength(0);
  });

  it('a throwing supabase.auth.signOut (offline) still ends in a local sign-out and clears the pushed site', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts', { updatedAt: 1000, accountSyncedAt: 1000 }));
    sb.setSession({ access_token: 't', user: A });
    supabase.auth.signOut.mockImplementationOnce(async () => ({ error: { message: 'offline' } }));
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await store.loadSite()).toBeNull();
  });

  it('rapid sign-out twice does not throw and leaves no site', async () => {
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts'));
    sb.setSession({ access_token: 't', user: A });
    await Promise.all([signOut(), signOut()]);
    expect(await store.loadSite()).toBeNull();
  });
});

describe('sign-out and switch clear what must not leak', () => {
  it('store customers cache is cleared on sign-out and on an account switch', async () => {
    custCache.setStoreCustomersCache({ shopId: 's', customers: [{ id: 'c' }], orders: [] } as any);
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect(custCache.storeCustomersCache).toBeNull();
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts'));
    custCache.setStoreCustomersCache({ shopId: 's', customers: [{ id: 'c' }], orders: [] } as any);
    sb.rows = [row(B_DRAFT, B.id, 'B Fades')];
    signInAs(B); await signIn(B.email, 'pw1234');
    expect(custCache.storeCustomersCache).toBeNull();
  });

  // LANE-B #2: the shared plan (tier, entitlements, team cap) is cleared on sign-out and account switch.
  it('the shared plan of A is gone after sign-out, so B never reads A\'s tier', async () => {
    setSharedPlan({ tier: 'store', entitlements: { hosting: true, bookings: true, store: true } } as any);
    sb.setSession({ access_token: 't', user: A });
    await signOut();
    expect(getSharedPlan()).toBeNull();
  });
  it('the shared plan of A is gone after switching to B', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(siteOf(A_DRAFT, A.id, 'A Cuts'));
    setSharedPlan({ tier: 'store', entitlements: { hosting: true, bookings: true, store: true } } as any);
    sb.rows = [row(B_DRAFT, B.id, 'B Fades')];
    signInAs(B); await signIn(B.email, 'pw1234');
    expect(getSharedPlan()).toBeNull();
  });
});
