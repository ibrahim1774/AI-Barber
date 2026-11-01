import * as store from '@/lib/siteStore';
import { publishFlow, resumePendingPublish, type PublishDeps } from '@/lib/publish';
import { ApiError } from '@/lib/api';
import {
  ACCOUNT_CHECK_MESSAGE, APP_STORE_ACTIVE_MESSAGE, APP_STORE_LAPSED_MESSAGE, APP_STORE_PUBLISH_MESSAGE, CHECKOUT_RETRY_MESSAGE,
  PROCESSING_MESSAGE, appStoreNotice, checkoutFailure,
} from '@/lib/webBilling';
import type { SiteRecord } from '@/lib/siteStore';

describe('checkoutFailure', () => {
  it('409 already_subscribed opens the portal', () => expect(checkoutFailure(409, 'already_subscribed')).toEqual({ kind: 'portal' }));
  it.each(['payment_processing', 'checkout_in_progress'])('409 %s waits, no portal', (c) =>
    expect(checkoutFailure(409, c)).toEqual({ kind: 'processing', message: 'Your payment is still processing. Give it a minute, then refresh.' }));
  it('409 ios_subscription_active', () =>
    expect(checkoutFailure(409, 'ios_subscription_active')).toEqual({ kind: 'app-store', message: APP_STORE_ACTIVE_MESSAGE }));
  it('409 ios_linked_lapsed', () =>
    expect(checkoutFailure(409, 'ios_linked_lapsed')).toEqual({ kind: 'app-store', message: APP_STORE_LAPSED_MESSAGE }));
  it('an unknown 409 never opens the portal', () => expect(checkoutFailure(409, 'weird')).toEqual({ kind: 'error', message: CHECKOUT_RETRY_MESSAGE }));
  it('503 says the account could not be checked', () => expect(checkoutFailure(503, 'try_again')).toEqual({ kind: 'error', message: ACCOUNT_CHECK_MESSAGE }));
  it('502 is a generic retry', () => expect(checkoutFailure(502, 'checkout_failed')).toEqual({ kind: 'error', message: CHECKOUT_RETRY_MESSAGE }));
  it('copy', () => {
    expect(PROCESSING_MESSAGE).toBe('Your payment is still processing. Give it a minute, then refresh.');
    expect(ACCOUNT_CHECK_MESSAGE).toBe("Couldn't check your account right now. Try again in a moment.");
    expect(APP_STORE_ACTIVE_MESSAGE).toContain('Settings > Apple ID > Subscriptions');
    expect(APP_STORE_LAPSED_MESSAGE).toContain('support@davoxa.com');
  });
});

describe('appStoreNotice (/me appStore field)', () => {
  it('active and linked show the App Store message', () => {
    expect(appStoreNotice('active')).toBe(APP_STORE_ACTIVE_MESSAGE);
    expect(appStoreNotice('linked')).toBe(APP_STORE_LAPSED_MESSAGE);
  });
  it('null / missing shows the pay buttons', () => {
    expect(appStoreNotice(null)).toBeNull();
    expect(appStoreNotice(undefined)).toBeNull();
  });
});

const site = {
  draftId: 'd1', inputs: { shopName: 'Fade' },
  data: { shopName: 'Fade', area: 'Brooklyn, NY', phone: '555', hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' }, about: { heading: 'About', description: ['one'], imageUrl: '' }, services: [], gallery: [] },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
} as unknown as SiteRecord;

describe('publish 403 app-store-account', () => {
  it('is a final, friendly answer: blocked, not pending/transient, record cleared, not resent', async () => {
    await store.saveSite(site);
    await store.savePendingPublish(null);
    const iosPublish = jest.fn(async () => { throw new ApiError(403, 'app-store-account', 'forbidden'); });
    const deps = {
      hasEntitlement: jest.fn(async () => true), showPaywall: jest.fn(async () => 'purchased' as const),
      latestTransactionId: jest.fn(async () => 'tx-1'), iosPublish, store, accessToken: async () => 'tok',
      claimStart: jest.fn(),
    } as unknown as PublishDeps;
    const out = await publishFlow(site, deps);
    expect(out).toEqual({ kind: 'blocked', message: APP_STORE_PUBLISH_MESSAGE });
    expect(APP_STORE_PUBLISH_MESSAGE).toBe('This account has an App Store subscription. Publish from the iPhone app, or contact support@davoxa.com.');
    expect(await store.loadPendingPublish()).toBeNull();
    expect(await resumePendingPublish(deps)).toBeNull();
    expect(iosPublish).toHaveBeenCalledTimes(1);
  });
});
