// Accounts: restore, delete, the public.sites sync, and sign up / sign in.
import Storage from 'expo-sqlite/kv-store';
import * as analytics from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import * as store from '@/lib/siteStore';
import { hasSeen, markSeen } from '@/lib/overlayFlags';
import { publishFlow, type PublishDeps } from '@/lib/publish';
import {
  deleteAccountAndData, deleteLocalData, onSiteAdopted, pullSiteFromAccount, pullSiteOnLaunch, resetLaunchPullForTests,
  restore, syncIfSignedIn, syncSiteToSupabase, type RestoreDeps,
} from '@/lib/account';
import { currentUserId, friendlyAuthError, signIn, signOut, signUp } from '@/lib/auth';
import type { SiteRecord } from '@/lib/siteStore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const M = '⁣'; // editor marker character (stripped before anything leaves the phone)

const DRAFT = '7d0c1f2a-3b4c-4d5e-8f60-718293a4b5c6';
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'barber@example.com' };

const data: any = {
  shopName: 'Fade Factory',
  area: 'Brooklyn, NY',
  phone: '(718) 555-0100',
  template: 'luxe',
  colorTheme: 'gold',
  bookingUrl: 'https://booksy.com/fade',
  hero: { heading: `Sharp${M}`, tagline: 't', imageUrl: 'https://cdn.example/h.jpg' },
  about: { heading: 'About', description: ['one'], imageUrl: 'data:image/png;base64,AAAA' },
  services: [],
  gallery: [],
};

const site = {
  draftId: DRAFT,
  inputs: { shopName: 'Fade Factory', area: 'Brooklyn, NY', phone: '(718) 555-0100' },
  data,
  updatedAt: 1,
  slug: 'fade-factory',
  deployedUrl: 'https://fade-factory.aibarber.org',
  transactionId: 'tx-1',
} as unknown as SiteRecord;

const BOUND = {
  siteId: 'fade-factory',
  deployedUrl: 'https://fade-factory.aibarber.org',
  siteData: { ...data, hero: { ...data.hero, heading: 'Sharp' } },
  active: true,
};

function restoreDeps(over: Partial<RestoreDeps> = {}): RestoreDeps {
  return {
    restorePurchases: jest.fn(async () => undefined),
    latestTransactionId: jest.fn(async () => 'tx-9'),
    iosSite: jest.fn(async () => BOUND) as unknown as RestoreDeps['iosSite'],
    store,
    ...over,
  };
}

beforeEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  sb.reset();
  await store.clearSite();
  await store.savePendingPublish(null);
});

describe('restore', () => {
  test('restore loads the bound site', async () => {
    const deps = restoreDeps();
    const res = await restore(deps);
    const out = res?.site;

    expect(deps.restorePurchases).toHaveBeenCalled();
    expect(deps.iosSite).toHaveBeenCalledWith('tx-9');
    expect(res?.active).toBe(true);
    expect(out).toMatchObject({
      slug: 'fade-factory',
      deployedUrl: 'https://fade-factory.aibarber.org',
      transactionId: 'tx-9',
      data: BOUND.siteData,
      inputs: {
        shopName: 'Fade Factory',
        area: 'Brooklyn, NY',
        phone: '(718) 555-0100',
        template: 'luxe',
        colorTheme: 'gold',
        bookingUrl: 'https://booksy.com/fade',
      },
    });
    expect(typeof out!.draftId).toBe('string');
    expect(await store.loadSite()).toEqual(out);
  });

  test('restore with no subscription returns null', async () => {
    jest.useFakeTimers();
    const deps = restoreDeps({ latestTransactionId: jest.fn(async () => null) });
    const p = restore(deps);
    await jest.advanceTimersByTimeAsync(10_000);

    expect(await p).toBeNull();
    expect(deps.iosSite).not.toHaveBeenCalled();
    expect(await store.loadSite()).toBeNull();
  });

  test('restore over the same site keeps local edits and the draft id', async () => {
    const local = { ...site, data: { ...data, shopName: 'Edited locally' }, transactionId: null };
    await store.saveSite(local);
    const out = (await restore(restoreDeps()))?.site;

    expect(out).toMatchObject({ draftId: DRAFT, slug: 'fade-factory', transactionId: 'tx-9' });
    expect(out!.data.shopName).toBe('Edited locally');
  });

  test('restore replaces a different local draft but keeps its draft id', async () => {
    await store.saveSite({ ...site, slug: null, deployedUrl: null, data: { ...data, shopName: 'Other' } });
    const out = (await restore(restoreDeps()))?.site;

    expect(out).toMatchObject({ draftId: DRAFT, slug: 'fade-factory', data: BOUND.siteData });
  });

  test('an inactive subscription still restores the content and says it is inactive', async () => {
    const res = await restore(restoreDeps({ iosSite: jest.fn(async () => ({ ...BOUND, active: false })) as any }));
    expect(res).toMatchObject({ active: false, site: { slug: 'fade-factory', data: BOUND.siteData } });
    expect(await store.loadSite()).toEqual(res!.site);
  });

  test('a site with no saved content is not restored over nothing', async () => {
    const out = await restore(restoreDeps({ iosSite: jest.fn(async () => ({ ...BOUND, siteData: null })) as any }));
    expect(out).toBeNull();
    expect(await store.loadSite()).toBeNull();
  });

  test('a subscription with no site surfaces the 404', async () => {
    const iosSite = jest.fn(async () => {
      throw new ApiError(404, 'no-site', 'Could not load your site');
    });
    await expect(restore(restoreDeps({ iosSite: iosSite as any }))).rejects.toMatchObject({ code: 'no-site' });
    expect(await store.loadSite()).toBeNull();
  });
});

describe('delete', () => {
  test('delete calls the endpoint with the access token then clears local data', async () => {
    await store.saveSite(site);
    await store.savePendingPublish({ transactionId: 'tx-1', data: site.data, createdAt: Date.now() });
    await markSeen('guide', DRAFT);
    sb.setSession({ access_token: 'access-123', user: USER });
    const trackSpy = jest.spyOn(analytics, 'track');
    const resetSpy = jest.spyOn(analytics, 'resetUser');

    let siteWhenCalled: SiteRecord | null = null;
    const del = jest.spyOn(api, 'deleteAccount').mockImplementation(async () => {
      siteWhenCalled = await store.loadSite();
    });

    await deleteAccountAndData();

    expect(del).toHaveBeenCalledWith('access-123');
    expect(siteWhenCalled).not.toBeNull(); // the endpoint runs before anything local is touched
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await store.loadSite()).toBeNull();
    expect(await store.loadPendingPublish()).toBeNull();
    expect(await hasSeen('guide', DRAFT)).toBe(false);
    expect(trackSpy).toHaveBeenCalledWith('account_deleted');
    // PostHog forgets the user only after the deletion event is sent under their id.
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy.mock.invocationCallOrder[0]).toBeGreaterThan(trackSpy.mock.invocationCallOrder[0]);
  });

  test('once the server has deleted the account, a local clean-up failure still tracks and resets', async () => {
    await store.saveSite(site);
    sb.setSession({ access_token: 'access-123', user: USER });
    jest.spyOn(api, 'deleteAccount').mockResolvedValue(undefined);
    jest.spyOn(store, 'clearSite').mockRejectedValue(new Error('disk full'));
    const trackSpy = jest.spyOn(analytics, 'track');
    const resetSpy = jest.spyOn(analytics, 'resetUser');

    await expect(deleteAccountAndData()).rejects.toThrow('disk full');
    expect(trackSpy).toHaveBeenCalledWith('account_deleted');
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(resetSpy.mock.invocationCallOrder[0]).toBeGreaterThan(trackSpy.mock.invocationCallOrder[0]);
  });

  test('a failed delete keeps everything and stays signed in', async () => {
    await store.saveSite(site);
    sb.setSession({ access_token: 'access-123', user: USER });
    jest.spyOn(api, 'deleteAccount').mockRejectedValue(new ApiError(500, 'delete-failed', 'Could not delete your account'));

    const resetSpy = jest.spyOn(analytics, 'resetUser');
    await expect(deleteAccountAndData()).rejects.toMatchObject({ code: 'delete-failed' });
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(resetSpy).not.toHaveBeenCalled();
    expect(await store.loadSite()).toEqual(site);
  });

  test('delete without a session refuses instead of wiping the phone', async () => {
    await store.saveSite(site);
    const del = jest.spyOn(api, 'deleteAccount');
    await expect(deleteAccountAndData()).rejects.toThrow();
    expect(del).not.toHaveBeenCalled();
    expect(await store.loadSite()).toEqual(site);
  });

  test('signed-out local delete clears the site, pending publish and flags without calling the server', async () => {
    await store.saveSite(site);
    await store.savePendingPublish({ transactionId: null, data: site.data, createdAt: Date.now() });
    await markSeen('prompts', DRAFT);
    const del = jest.spyOn(api, 'deleteAccount');

    await deleteLocalData();

    expect(del).not.toHaveBeenCalled();
    expect(await store.loadSite()).toBeNull();
    expect(await store.loadPendingPublish()).toBeNull();
    expect(await hasSeen('prompts', DRAFT)).toBe(false);
    expect(await Storage.getItem(`prompts.v1.${DRAFT}`)).toBeNull();
  });
});

describe('public.sites sync', () => {
  test("syncSiteToSupabase writes the web's column names", async () => {
    await syncSiteToSupabase(site, USER.id);

    expect(sb.upserts).toHaveLength(1);
    const { table, row, opts } = sb.upserts[0];
    expect(table).toBe('sites');
    expect(opts).toEqual({ onConflict: 'id' });
    expect(Object.keys(row).sort()).toEqual(
      [
        // Not custom_domain / domain_order_id: the web dashboard attaches domains to these rows.
        'id', 'user_id', 'company_name', 'industry', 'service_area', 'phone', 'brand_colour', 'site_data',
        'deployed_url', 'deployment_status', 'updated_at',
      ].sort(),
    );
    expect(row).toMatchObject({
      id: DRAFT,
      user_id: USER.id,
      company_name: 'Fade Factory',
      industry: 'barbershop',
      service_area: 'Brooklyn, NY',
      phone: '(718) 555-0100',
      brand_colour: '#f4a100',
      deployed_url: 'https://fade-factory.aibarber.org',
      deployment_status: 'deployed',
    });
    // The last local edit's time, not the push's: the app's own copy never looks newer on the next pull.
    expect(row.updated_at).toBe(new Date(site.updatedAt).toISOString());
    // Clean data only: no editor markers, no inline data: images; marked as app-made.
    const sd = row.site_data as typeof data;
    expect(sd.hero.heading).toBe('Sharp');
    expect(sd.about.imageUrl).toBe('');
    expect(sd.source).toBe('ios');
    // The local record itself never gets the marker.
    expect((site.data as any).source).toBeUndefined();
  });

  test('an unpublished site is a draft', async () => {
    await syncSiteToSupabase({ ...site, slug: null, deployedUrl: null }, USER.id);
    expect(sb.upserts[0].row).toMatchObject({ deployed_url: null, deployment_status: 'draft' });
  });

  test('a failed upsert throws', async () => {
    sb.upsertError = { message: 'new row violates row-level security policy', code: '42501' };
    await expect(syncSiteToSupabase(site, USER.id)).rejects.toBeTruthy();
  });

  test('syncIfSignedIn upserts the local site only when signed in', async () => {
    await store.saveSite(site);
    await syncIfSignedIn();
    expect(sb.upserts).toHaveLength(0);

    sb.setSession({ access_token: 'a', user: USER });
    await syncIfSignedIn();
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row.user_id).toBe(USER.id);
  });

  test('syncIfSignedIn never throws', async () => {
    await store.saveSite(site);
    sb.setSession({ access_token: 'a', user: USER });
    sb.upsertError = { message: 'boom' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(syncIfSignedIn()).resolves.toBeUndefined();
  });

  test('a successful publish hands the saved record to onLive, and a failing onLive never breaks it', async () => {
    await store.saveSite({ ...site, slug: null, deployedUrl: null, transactionId: null });
    const LIVE = { siteId: 'fade-factory', deployedUrl: 'https://fade-factory.aibarber.org', republished: false };
    const onLive = jest.fn(async () => {
      throw new Error('sync down');
    });
    const deps: PublishDeps = {
      hasEntitlement: async () => true,
      showPaywall: async () => 'declined',
      latestTransactionId: async () => 'tx-1',
      iosPublish: jest.fn(async () => LIVE),
      store,
      userId: () => USER.id,
      onLive,
    };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await publishFlow((await store.loadSite())!, deps);

    expect(out).toEqual({ kind: 'live', url: LIVE.deployedUrl, republished: false });
    expect(onLive).toHaveBeenCalledWith(expect.objectContaining({ slug: 'fade-factory', deployedUrl: LIVE.deployedUrl }));
    expect(deps.iosPublish).toHaveBeenCalledWith(expect.objectContaining({ userId: USER.id }));
  });
});

describe('pullSiteFromAccount', () => {
  const T0 = Date.parse('2026-10-20T12:00:00.000Z');
  const local = { ...site, updatedAt: T0 } as SiteRecord;
  const webData = { ...BOUND.siteData, shopName: 'Fade Factory Web', area: 'Queens, NY', source: 'ios' };
  const row = (over: Record<string, unknown> = {}) => ({
    id: DRAFT,
    user_id: USER.id,
    site_data: webData,
    deployed_url: 'https://fade-factory.aibarber.org',
    updated_at: new Date(T0 + 60_000).toISOString(),
    ...over,
  });

  test('adopts a newer account copy of the local site, keeping its ids', async () => {
    await store.saveSite(local);
    sb.rows = [row({ deployed_url: 'https://fade-factory-new.vercel.app' })];
    const seen: SiteRecord[] = [];
    const off = onSiteAdopted((s) => seen.push(s));

    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');
    off();

    expect(sb.selects[0].filters).toEqual([
      ['id', DRAFT],
      ['user_id', USER.id],
    ]);
    const saved = (await store.loadSite())!;
    expect(saved).toMatchObject({
      draftId: DRAFT,
      slug: 'fade-factory',
      transactionId: 'tx-1',
      deployedUrl: 'https://fade-factory-new.vercel.app',
      updatedAt: T0 + 60_000,
    });
    expect(saved.data.shopName).toBe('Fade Factory Web');
    expect(saved.inputs).toMatchObject({ shopName: 'Fade Factory Web', area: 'Queens, NY' });
    // The app's marker stays in the account, never in the local data (or a publish).
    expect((saved.data as any).source).toBeUndefined();
    expect(seen).toEqual([saved]);
  });

  test('keeps the local deployed URL when the row has none', async () => {
    await store.saveSite(local);
    sb.rows = [row({ deployed_url: null })];
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');
    expect((await store.loadSite())!.deployedUrl).toBe(site.deployedUrl);
  });

  test.each([
    ['older', -60_000],
    ['equal', 0],
  ])('ignores an %s account copy', async (_label, delta) => {
    await store.saveSite(local);
    sb.rows = [row({ updated_at: new Date(T0 + (delta as number)).toISOString() })];
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    expect(await store.loadSite()).toEqual(local);
  });

  test('no row for the local site: unchanged', async () => {
    await store.saveSite(local);
    sb.rows = [row({ id: 'someone-else' })];
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    expect(await store.loadSite()).toEqual(local);
  });

  test("after the app's own push, the same copy is not adopted back", async () => {
    await store.saveSite(local);
    await syncSiteToSupabase(local, USER.id);
    sb.rows = [{ ...sb.upserts[0].row }];
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
  });

  test('without a local site, the newest app-made row becomes the local site', async () => {
    sb.rows = [
      row({ id: 'old-ios', updated_at: '2026-10-01T00:00:00.000Z' }),
      row({ id: 'new-ios', updated_at: '2026-10-19T00:00:00.000Z' }),
      // Newer, but made on the web: never adopted as an app site.
      row({ id: 'web-only', updated_at: '2026-10-20T00:00:00.000Z', site_data: { ...BOUND.siteData } }),
      row({ id: 'other-user', user_id: 'u2', updated_at: '2026-10-21T00:00:00.000Z' }),
    ];
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('adopted');

    expect(sb.selects[0].filters).toEqual([
      ['user_id', USER.id],
      ['site_data->>source', 'ios'],
    ]);
    expect(sb.selects[0].order).toEqual(['updated_at', false]);
    expect(sb.selects[0].limit).toBe(1);
    const saved = (await store.loadSite())!;
    expect(saved).toEqual({
      draftId: 'new-ios',
      inputs: {
        shopName: 'Fade Factory Web',
        area: 'Queens, NY',
        phone: '(718) 555-0100',
        template: 'luxe',
        colorTheme: 'gold',
        bookingUrl: 'https://booksy.com/fade',
      },
      data: { ...BOUND.siteData, shopName: 'Fade Factory Web', area: 'Queens, NY' },
      updatedAt: Date.parse('2026-10-19T00:00:00.000Z'),
      slug: null,
      deployedUrl: 'https://fade-factory.aibarber.org',
      transactionId: null,
    });
  });

  test('without a local site or an app-made row: unchanged, nothing saved', async () => {
    sb.rows = [row({ id: 'web-only', site_data: { ...BOUND.siteData } })];
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    expect(await store.loadSite()).toBeNull();
  });

  test('a local edit made while the row loads wins', async () => {
    await store.saveSite(local);
    sb.rows = [row()];
    const realLoad = store.loadSite;
    let calls = 0;
    jest.spyOn(store, 'loadSite').mockImplementation(async () => {
      calls++;
      // The second read (just before saving) sees an edit.
      return calls === 1 ? realLoad() : { ...local, updatedAt: T0 + 5 };
    });
    await expect(pullSiteFromAccount(USER.id)).resolves.toBe('unchanged');
    jest.restoreAllMocks();
    expect(await store.loadSite()).toEqual(local);
  });

  test.each([
    ['returned', false],
    ['thrown', true],
  ])('an error (%s) returns null and changes nothing', async (_label, throws) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await store.saveSite(local);
    sb.rows = [row()];
    sb.selectError = { message: 'offline' };
    sb.selectThrows = throws as boolean;
    await expect(pullSiteFromAccount(USER.id)).resolves.toBeNull();
    expect(await store.loadSite()).toEqual(local);

    await store.clearSite();
    await expect(pullSiteFromAccount(USER.id)).resolves.toBeNull();
    expect(await store.loadSite()).toBeNull();
  });

  test('pullSiteOnLaunch runs once, only with a session', async () => {
    resetLaunchPullForTests();
    await expect(pullSiteOnLaunch()).resolves.toBeNull();
    expect(sb.selects).toHaveLength(0);

    resetLaunchPullForTests();
    sb.setSession({ access_token: 'a', user: USER });
    sb.rows = [row({ id: 'new-ios' })];
    await expect(pullSiteOnLaunch()).resolves.toBe('adopted');
    await expect(pullSiteOnLaunch()).resolves.toBe('adopted');
    expect(sb.selects).toHaveLength(1);
    resetLaunchPullForTests();
  });
});

describe('auth', () => {
  test('signUp sends the web metadata, mirrors the phone, tracks and syncs the local site', async () => {
    await store.saveSite(site);
    const session = { access_token: 'a', user: USER };
    supabase.auth.signUp.mockImplementation(async () => {
      sb.setSession(session);
      return { data: { user: { ...USER, identities: [{}] }, session }, error: null };
    });
    const phoneSpy = jest.spyOn(api, 'syncAuthPhone').mockResolvedValue(undefined);
    const regSpy = jest.spyOn(analytics, 'trackRegistration');
    const identifySpy = jest.spyOn(analytics, 'identifyUser');

    const out = await signUp('barber@example.com', 'secret1', 'Sam Barber', '7185550100');

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'barber@example.com',
      password: 'secret1',
      options: { data: { full_name: 'Sam Barber', phone: '7185550100' } },
    });
    expect(phoneSpy).toHaveBeenCalledWith(USER.id);
    expect(regSpy).toHaveBeenCalledWith('email');
    expect(identifySpy).toHaveBeenCalledWith(USER.id);
    expect(out).toEqual({ signedIn: true });
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row).toMatchObject({ id: DRAFT, user_id: USER.id });
  });

  test('signUp with email confirmation on returns signedIn false and syncs nothing', async () => {
    await store.saveSite(site);
    supabase.auth.signUp.mockResolvedValue({ data: { user: { ...USER, identities: [{}] }, session: null }, error: null });
    jest.spyOn(api, 'syncAuthPhone').mockResolvedValue(undefined);
    const identifySpy = jest.spyOn(analytics, 'identifyUser');

    expect(await signUp('barber@example.com', 'secret1', '', '7185550100')).toEqual({ signedIn: false });
    expect(identifySpy).not.toHaveBeenCalled();
    expect(sb.upserts).toHaveLength(0);
  });

  test('signUp for an email that already exists says so', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: { user: { ...USER, identities: [] }, session: null }, error: null });
    const phoneSpy = jest.spyOn(api, 'syncAuthPhone').mockResolvedValue(undefined);
    await expect(signUp('barber@example.com', 'secret1', '', '7185550100')).rejects.toThrow(/already/i);
    expect(phoneSpy).not.toHaveBeenCalled();
  });

  test('signUp errors become friendly messages', async () => {
    supabase.auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'weak_password', status: 422, message: 'Password should be at least 6 characters.' },
    });
    await expect(signUp('a@b.co', '123', '', '7185550100')).rejects.toThrow('Password must be at least 6 characters');
  });

  test('signIn syncs the local site; a wrong password is friendly', async () => {
    await store.saveSite(site);
    const session = { access_token: 'a', user: USER };
    supabase.auth.signInWithPassword.mockImplementationOnce(async () => {
      sb.setSession(session);
      return { data: { user: USER, session }, error: null };
    });
    const identifySpy = jest.spyOn(analytics, 'identifyUser');
    await signIn('barber@example.com', 'secret1');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'barber@example.com', password: 'secret1' });
    expect(identifySpy).toHaveBeenCalledWith(USER.id);
    expect(sb.upserts).toHaveLength(1);
    expect(currentUserId()).toBe(USER.id);
    // The account's copy is checked before the local one is pushed.
    expect(sb.selects).toHaveLength(1);

    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    });
    await expect(signIn('barber@example.com', 'nope')).rejects.toThrow(/don.t match/);
  });

  test('signIn adopts a newer web edit before pushing, so the push carries it', async () => {
    await store.saveSite({ ...site, updatedAt: 1000 } as SiteRecord);
    sb.rows = [
      {
        id: DRAFT,
        user_id: USER.id,
        site_data: { ...BOUND.siteData, shopName: 'Edited On Web', source: 'ios' },
        deployed_url: site.deployedUrl,
        updated_at: new Date(5000).toISOString(),
      },
    ];
    const session = { access_token: 'a', user: USER };
    supabase.auth.signInWithPassword.mockImplementationOnce(async () => {
      sb.setSession(session);
      return { data: { user: USER, session }, error: null };
    });
    await signIn('barber@example.com', 'secret1');
    expect((await store.loadSite())!.data.shopName).toBe('Edited On Web');
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row).toMatchObject({ company_name: 'Edited On Web', updated_at: new Date(5000).toISOString() });
  });

  test('a pull failure after sign-in does not fail the sign-in', async () => {
    await store.saveSite(site);
    sb.selectError = { message: 'offline' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = { access_token: 'a', user: USER };
    supabase.auth.signInWithPassword.mockImplementationOnce(async () => {
      sb.setSession(session);
      return { data: { user: USER, session }, error: null };
    });
    await expect(signIn('barber@example.com', 'secret1')).resolves.toBeUndefined();
    expect(await store.loadSite()).toEqual(site);
    expect(sb.upserts).toHaveLength(1);
  });

  test('a sync failure after sign-in does not fail the sign-in', async () => {
    await store.saveSite(site);
    sb.upsertError = { message: 'rls' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = { access_token: 'a', user: USER };
    supabase.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: USER, session }, error: null });
    await expect(signIn('barber@example.com', 'secret1')).resolves.toBeUndefined();
  });

  test('signOut resets PostHog', async () => {
    sb.setSession({ access_token: 'a', user: USER });
    const resetSpy = jest.spyOn(analytics, 'resetUser');
    await signOut();
    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(currentUserId()).toBeNull();
  });

  test('friendlyAuthError maps codes and network failures', () => {
    expect(friendlyAuthError({ code: 'user_already_exists', message: 'User already registered' })).toMatch(/already/);
    expect(friendlyAuthError({ message: 'User already registered' })).toMatch(/already/);
    expect(friendlyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toMatch(/don.t match/);
    expect(friendlyAuthError({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(/confirm/i);
    expect(friendlyAuthError({ name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' })).toMatch(
      /connection/,
    );
    expect(friendlyAuthError(new TypeError('Network request failed'))).toMatch(/connection/);
    expect(friendlyAuthError({ code: 'over_email_send_rate_limit', status: 429, message: 'x' })).toMatch(/wait/i);
    expect(friendlyAuthError({ message: 'Something odd' })).toBe('Something odd');
  });
});
