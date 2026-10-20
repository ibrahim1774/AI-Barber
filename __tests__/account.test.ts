// Accounts: restore, delete, the public.sites sync, and sign up / sign in.
import Storage from 'expo-sqlite/kv-store';
import * as analytics from '@/lib/analytics';
import { api, ApiError } from '@/lib/api';
import * as store from '@/lib/siteStore';
import { hasSeen, markSeen } from '@/lib/overlayFlags';
import { publishFlow, type PublishDeps } from '@/lib/publish';
import {
  deleteAccountAndData, deleteLocalData, restore, syncIfSignedIn, syncSiteToSupabase, type RestoreDeps,
} from '@/lib/account';
import { currentUserId, friendlyAuthError, resetPassword, signIn, signUp } from '@/lib/auth';
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
    const out = await restore(deps);

    expect(deps.restorePurchases).toHaveBeenCalled();
    expect(deps.iosSite).toHaveBeenCalledWith('tx-9');
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
    const out = await restore(restoreDeps());

    expect(out).toMatchObject({ draftId: DRAFT, slug: 'fade-factory', transactionId: 'tx-9' });
    expect(out!.data.shopName).toBe('Edited locally');
  });

  test('restore replaces a different local draft but keeps its draft id', async () => {
    await store.saveSite({ ...site, slug: null, deployedUrl: null, data: { ...data, shopName: 'Other' } });
    const out = await restore(restoreDeps());

    expect(out).toMatchObject({ draftId: DRAFT, slug: 'fade-factory', data: BOUND.siteData });
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
  });

  test('a failed delete keeps everything and stays signed in', async () => {
    await store.saveSite(site);
    sb.setSession({ access_token: 'access-123', user: USER });
    jest.spyOn(api, 'deleteAccount').mockRejectedValue(new ApiError(500, 'delete-failed', 'Could not delete your account'));

    await expect(deleteAccountAndData()).rejects.toMatchObject({ code: 'delete-failed' });
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
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
        'id', 'user_id', 'company_name', 'industry', 'service_area', 'phone', 'brand_colour', 'site_data',
        'deployed_url', 'deployment_status', 'custom_domain', 'domain_order_id', 'updated_at',
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
      custom_domain: null,
      domain_order_id: null,
    });
    expect(Number.isNaN(Date.parse(row.updated_at as string))).toBe(false);
    // Clean data only: no editor markers, no inline data: images.
    const sd = row.site_data as typeof data;
    expect(sd.hero.heading).toBe('Sharp');
    expect(sd.about.imageUrl).toBe('');
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

    const out = await signUp('barber@example.com', 'secret1', 'Sam Barber', '7185550100');

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'barber@example.com',
      password: 'secret1',
      options: { data: { full_name: 'Sam Barber', phone: '7185550100' } },
    });
    expect(phoneSpy).toHaveBeenCalledWith(USER.id);
    expect(regSpy).toHaveBeenCalledWith('email');
    expect(out).toEqual({ signedIn: true });
    expect(sb.upserts).toHaveLength(1);
    expect(sb.upserts[0].row).toMatchObject({ id: DRAFT, user_id: USER.id });
  });

  test('signUp with email confirmation on returns signedIn false and syncs nothing', async () => {
    await store.saveSite(site);
    supabase.auth.signUp.mockResolvedValue({ data: { user: { ...USER, identities: [{}] }, session: null }, error: null });
    jest.spyOn(api, 'syncAuthPhone').mockResolvedValue(undefined);

    expect(await signUp('barber@example.com', 'secret1', '', '7185550100')).toEqual({ signedIn: false });
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
    await signIn('barber@example.com', 'secret1');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'barber@example.com', password: 'secret1' });
    expect(sb.upserts).toHaveLength(1);
    expect(currentUserId()).toBe(USER.id);

    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
    });
    await expect(signIn('barber@example.com', 'nope')).rejects.toThrow(/don.t match/);
  });

  test('a sync failure after sign-in does not fail the sign-in', async () => {
    await store.saveSite(site);
    sb.upsertError = { message: 'rls' };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const session = { access_token: 'a', user: USER };
    supabase.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: USER, session }, error: null });
    await expect(signIn('barber@example.com', 'secret1')).resolves.toBeUndefined();
  });

  test('resetPassword sends the web redirect', async () => {
    await resetPassword(' barber@example.com ');
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('barber@example.com', {
      redirectTo: 'https://www.aibarber.org',
    });
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
