/**
 * The only ways to lose the session: the explicit Sign out, account deletion, or the server rejecting the
 * refresh token. Each one drops the old account's in-memory data too (customers, plan, entitlements, user id).
 */
import * as store from '@/lib/siteStore';
import { api } from '@/lib/api';
import { deleteAccountAndData } from '@/lib/account';
import { currentUserId, signOut } from '@/lib/auth';
import { customersCache, setCustomersCache } from '@/lib/bookings/customersCache';
import { clearEntitlements, getEntitlements, getSuperwallEntitlements, resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
import { getSharedPlan, setSharedPlan, UNLINKED_PLAN } from '@/lib/plan';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb, supabase } = require('@/lib/supabase');

const A = { id: 'aaaaaaaa-2222-4333-8444-555555555555', email: 'a@example.com' };
const PLAN = { ...UNLINKED_PLAN, linked: true, purchaseAccount: 'self' as const, tier: 'store' as const, entitlements: { hosting: true, bookings: true, store: true }, active: true };

function warm() {
  setCustomersCache({ shopId: 's1', shop: {} as any, customers: [] });
  setSharedPlan(PLAN);
  setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] });
}
const cold = () => {
  expect(customersCache).toBeNull();
  expect(getSharedPlan()).toBeNull();
};

beforeEach(async () => {
  sb.reset();
  resetEntitlementsForTests();
  setSharedPlan(null);
  await store.clearSite();
  await store.savePendingPublish(null);
  jest.restoreAllMocks();
});

describe('what ends a session', () => {
  it('explicit Sign out: session gone, user id, customers cache and server plan cleared (even when the revoke call is offline)', async () => {
    sb.setSession({ access_token: 't', user: A });
    warm();
    supabase.auth.signOut.mockReset().mockImplementation(async (o?: { scope?: string }) => {
      if (o?.scope === 'local') {
        sb.setSession(null);
        return { error: null };
      }
      return { error: { name: 'AuthRetryableFetchError', status: 0, message: 'Network request failed' } };
    });
    await signOut();
    expect(sb.session).toBeNull();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(currentUserId()).toBeNull();
    cold();
  });

  it('explicit Sign out re-derives entitlements from Superwall for this Apple ID only (the payment), never the account plan', async () => {
    sb.setSession({ access_token: 't', user: A });
    warm();
    await signOut();
    // Superwall still reports the Apple ID as subscribed; the old account's server plan does not survive.
    expect(getSuperwallEntitlements()).toMatchObject({ known: true, hosting: true, bookings: true, store: true });
    // Bookings / Store stay locked (known: false) until the server's plan says the next account owns that purchase.
    expect(getEntitlements().known).toBe(false);
    expect(getSharedPlan()).toBeNull();
  });

  it('account deletion: local session dropped, site and pending publish cleared, caches cleared', async () => {
    sb.setSession({ access_token: 't', user: A });
    warm();
    await store.saveSite({ draftId: 'd1', inputs: {}, data: {}, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as any);
    jest.spyOn(api, 'deleteAccount').mockResolvedValue(undefined as any);
    await deleteAccountAndData();
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(sb.session).toBeNull();
    expect(await store.loadSite()).toBeNull();
    expect(customersCache).toBeNull();
  });

  it('a failed account deletion leaves the session and data alone', async () => {
    sb.setSession({ access_token: 't', user: A });
    await store.saveSite({ draftId: 'd1', inputs: {}, data: {}, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as any);
    jest.spyOn(api, 'deleteAccount').mockRejectedValue(new Error('offline'));
    await expect(deleteAccountAndData()).rejects.toThrow();
    expect(sb.session).not.toBeNull();
    expect(await store.loadSite()).not.toBeNull();
  });

  it('the server rejecting the refresh token (SIGNED_OUT with no explicit action) clears the old account in-memory data but keeps the site', async () => {
    sb.setSession({ access_token: 't', user: A });
    warm();
    await store.saveSite({ draftId: 'd1', inputs: {}, data: {}, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as any);
    sb.setSession(null); // SIGNED_OUT
    expect(currentUserId()).toBeNull();
    cold();
    expect(await store.loadSite()).not.toBeNull(); // unsaved edits are never thrown away by a token failure
  });

  it('a null session on any other event (offline, token not refreshable) does NOT touch anything', async () => {
    sb.setSession({ access_token: 't', user: A });
    warm();
    sb.listeners.forEach((l: any) => l('INITIAL_SESSION', null));
    sb.listeners.forEach((l: any) => l('TOKEN_REFRESHED', null));
    expect(currentUserId()).toBe(A.id);
    expect(getSharedPlan()).not.toBeNull();
    expect(customersCache).not.toBeNull();
    clearEntitlements(); // (no-op for the assertion: entitlements follow Superwall)
  });
});
