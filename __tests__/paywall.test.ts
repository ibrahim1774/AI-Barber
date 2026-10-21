// usePaywall's settle logic, driven through the expo-superwall mock's captured
// placement callbacks.
import React from 'react';
import { Alert } from 'react-native';
import { PRODUCT_IDS } from '@/lib/publish';

// The key must be set before paywall.tsx is loaded (superwallActive is fixed at load).
process.env.EXPO_PUBLIC_SUPERWALL_API_KEY = 'pk_test';
/* eslint-disable @typescript-eslint/no-require-imports */
const { sw } = require('expo-superwall');
const {
  usePaywall, useRestorePurchases, useSuperwallSettled, superwallActive, resetIntegrationAttributesForTests,
} = require('@/lib/paywall');
const { api } = require('@/lib/api');
const analytics = require('@/lib/analytics');
const siteStore = require('@/lib/siteStore');
// No @types/react-test-renderer in the project: the two calls used here.
const { act, create } = require('react-test-renderer') as {
  act(fn: () => void): void;
  create(el: React.ReactElement): { unmount(): void };
};
/* eslint-enable @typescript-eslint/no-require-imports */

type Result = 'purchased' | 'restored' | 'declined';
let show: (placement: 'publish') => Promise<Result>;
let renderer: { unmount(): void };

let restorePurchases: () => Promise<any>;

function Harness() {
  show = usePaywall();
  restorePurchases = useRestorePurchases();
  return null;
}

const ACTIVE = {
  transactionId: 'tx-1', productId: PRODUCT_IDS[0], purchaseDate: '2026-10-20T00:00:00Z', isActive: true, isRevoked: false,
};
const hold = () => new Promise<void>(() => {});

/** Start a paywall and report whether it has settled yet. */
function open() {
  let result: Result | null = null;
  const p = show('publish').then((r) => (result = r));
  return { p, current: () => result };
}

beforeEach(() => {
  jest.useFakeTimers();
  sw.reset();
  resetIntegrationAttributesForTests();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  act(() => {
    renderer = create(React.createElement(Harness));
  });
});

afterEach(() => {
  act(() => renderer.unmount());
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('the Superwall path is under test', () => {
  expect(superwallActive).toBe(true);
});

test('a skip with no active subscription is declined', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onSkip?.({ type: 'Holdout' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalled();
});

test('a declined dismiss is declined', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onDismiss?.({ closeReason: 'manualClose' }, { type: 'declined' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('a purchased dismiss is purchased', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[0] });
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('feature first, then a skip, with no active subscription is declined', async () => {
  // register resolves at once, so the feature closure runs before the skip event.
  const run = open();
  await jest.advanceTimersByTimeAsync(0);
  sw.callbacks.onSkip?.({ type: 'NoAudienceMatch' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  // No paywall ever showed: say why nothing happened.
  expect(Alert.alert).toHaveBeenCalled();
});

test('skip first, then feature, with no active subscription is declined with the Alert', async () => {
  let release!: () => void;
  sw.register = () => new Promise<void>((r) => { release = r; });
  const run = open();
  sw.callbacks.onSkip?.({ type: 'Holdout' });
  release();
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalledTimes(1);
});

test('a registerPlacement rejection is declined', async () => {
  sw.register = async () => { throw new Error('Superwall configure did not complete'); };
  const run = open();
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalled();
});

test('verify that never resolves settles declined after the timeout', async () => {
  sw.register = hold;
  sw.customerInfo = () => new Promise(() => {}); // no Superwall config: native never answers
  const run = open();
  sw.callbacks.onError?.('config fetch failed');
  await jest.advanceTimersByTimeAsync(5999);
  expect(run.current()).toBeNull();
  await jest.advanceTimersByTimeAsync(1);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).toHaveBeenCalled();
});

test('a paywall the user saw and closed is declined quietly, even if feature came first', async () => {
  const run = open(); // feature runs at once (a non-gated paywall)
  sw.callbacks.onPresent?.({ name: 'AI Barber Publish' });
  sw.callbacks.onDismiss?.({ closeReason: 'manualClose' }, { type: 'declined' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
  expect(Alert.alert).not.toHaveBeenCalled();
});

test('feature with an active subscription is purchased', async () => {
  sw.subscriptions = [ACTIVE];
  const run = open();
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('feature first, then the purchased dismiss while the transaction is still landing, is purchased', async () => {
  const run = open();
  await jest.advanceTimersByTimeAsync(500);
  expect(run.current()).toBeNull(); // still looking
  sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[1] });
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('a forNextPaywall dismiss is ignored', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onDismiss?.({ closeReason: 'forNextPaywall' }, { type: 'declined' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBeNull();
  sw.callbacks.onDismiss?.({ closeReason: 'systemLogic' }, { type: 'purchased', productId: PRODUCT_IDS[0] });
  await jest.advanceTimersByTimeAsync(0);
  expect(run.current()).toBe('purchased');
});

test('an error with no active subscription is declined', async () => {
  sw.register = hold;
  const run = open();
  sw.callbacks.onError?.('no network');
  await jest.advanceTimersByTimeAsync(5000);
  expect(run.current()).toBe('declined');
});

describe('Restore purchases', () => {
  const BOUND = {
    siteId: 'fade-factory',
    deployedUrl: 'https://fade-factory.aibarber.org',
    siteData: { shopName: 'Fade Factory', area: 'Brooklyn, NY', phone: '555' },
    active: true,
  };

  beforeEach(async () => {
    await siteStore.clearSite();
  });

  test('restores the site bound to the active subscription and tracks the tap once', async () => {
    sw.subscriptions = [ACTIVE];
    const iosSite = jest.spyOn(api, 'iosSite').mockResolvedValue(BOUND);
    const trackSpy = jest.spyOn(analytics, 'track');

    const res = await restorePurchases();

    expect(iosSite).toHaveBeenCalledWith('tx-1');
    expect(res).toMatchObject({ active: true, site: { slug: 'fade-factory', transactionId: 'tx-1' } });
    expect(await siteStore.loadSite()).toMatchObject({ slug: 'fade-factory' });
    expect(trackSpy.mock.calls.filter((c: unknown[]) => c[0] === 'restore_tapped')).toHaveLength(1);
    expect(Alert.alert).not.toHaveBeenCalled(); // Settings shows the outcome
  });

  test('no subscription resolves null', async () => {
    const iosSite = jest.spyOn(api, 'iosSite');
    const p = restorePurchases();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await p).toBeNull();
    expect(iosSite).not.toHaveBeenCalled();
  });

  test('a failed App Store sync with nothing cached resolves null (Superwall shows its alert)', async () => {
    sw.restore = async () => ({ result: 'failed', errorMessage: 'offline' });
    const p = restorePurchases();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await p).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test('a failed sync that still finds a cached subscription restores', async () => {
    sw.restore = async () => {
      throw new Error('StoreKit');
    };
    sw.subscriptions = [ACTIVE];
    jest.spyOn(api, 'iosSite').mockResolvedValue(BOUND);
    expect(await restorePurchases()).toMatchObject({ site: { slug: 'fade-factory' } });
  });
});

describe('useSuperwallSettled (the tracking prompt waits for it)', () => {
  let settled: boolean[];
  function Probe() {
    settled.push(useSuperwallSettled());
    return null;
  }
  const latest = () => settled[settled.length - 1];
  type R = { unmount(): void; update(el: React.ReactElement): void };
  let r: R;
  beforeEach(() => {
    settled = [];
  });
  afterEach(() => act(() => r.unmount()));

  test('false while Superwall configures, true once it has', () => {
    sw.configured = false;
    act(() => {
      r = create(React.createElement(Probe)) as unknown as R;
    });
    expect(latest()).toBe(false);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(latest()).toBe(false);
    sw.configured = true;
    act(() => r.update(React.createElement(Probe)));
    expect(latest()).toBe(true);
  });

  test('a configuration error settles it', () => {
    sw.configured = false;
    sw.configError = 'offline';
    act(() => {
      r = create(React.createElement(Probe)) as unknown as R;
    });
    expect(latest()).toBe(true);
  });

  test('never configured: settles after 10 s, so the prompt (and AppsFlyer) still happen offline', () => {
    sw.configured = false;
    act(() => {
      r = create(React.createElement(Probe)) as unknown as R;
    });
    act(() => {
      jest.advanceTimersByTime(9_999);
    });
    expect(latest()).toBe(false);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(latest()).toBe(true);
  });
});

describe('Superwall integration attributes', () => {
  test('no AppsFlyer id: nothing is sent to Superwall, only logged', async () => {
    const { SubscriptionSync } = require('@/lib/paywall'); // eslint-disable-line @typescript-eslint/no-require-imports
    jest.spyOn(analytics, 'appsFlyerUID').mockResolvedValue(null);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let r!: { unmount(): void };
    await act(async () => {
      r = create(React.createElement(SubscriptionSync));
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(sw.integrationAttributes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no AppsFlyer id/));
    r.unmount();
  });

  test('SubscriptionSync sends the AppsFlyer id to Superwall once configured, once per launch', async () => {
    const { SubscriptionSync } = require('@/lib/paywall'); // eslint-disable-line @typescript-eslint/no-require-imports
    const uid = jest.spyOn(analytics, 'appsFlyerUID').mockResolvedValue('af-uid-1');
    let r!: { unmount(): void };
    sw.configured = false;
    await act(async () => {
      r = create(React.createElement(SubscriptionSync));
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(sw.integrationAttributes).toEqual([]);
    expect(uid).not.toHaveBeenCalled();

    sw.configured = true;
    await act(async () => {
      r.unmount();
      r = create(React.createElement(SubscriptionSync));
    });
    await act(async () => {
      r.unmount();
      r = create(React.createElement(SubscriptionSync));
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(sw.integrationAttributes).toEqual([{ appsflyerId: 'af-uid-1' }]);
    expect(uid).toHaveBeenCalledTimes(1);
    r.unmount();
  });
});

describe('SubscriptionStatusSync', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const status = require('@/lib/subscriptionStatus');
  const { SubscriptionStatusSync } = require('@/lib/paywall');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const published = {
    draftId: 'd1', inputs: { shopName: 'Fade' }, data: { shopName: 'Fade' }, updatedAt: 1,
    slug: 'fade-factory', deployedUrl: 'https://fade-factory.aibarber.org', transactionId: 'tx-1',
  };
  const BOUND = { siteId: 'fade-factory', deployedUrl: published.deployedUrl, siteData: null, active: true };

  beforeEach(async () => {
    status.resetSubscriptionStatusForTests();
    await siteStore.clearSite();
    await siteStore.savePendingPublish(null);
  });

  const flush = () => act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });

  test('locks a published site with no subscription once Superwall settles; a forced recheck unlocks it', async () => {
    await siteStore.saveSite(published);
    sw.status = 'INACTIVE';
    let r!: { unmount(): void };
    await act(async () => {
      r = create(React.createElement(SubscriptionStatusSync));
    });
    await flush();
    expect(status.getSubscriptionStatus()).toBe('lapsed');

    // Resubscribed: a transaction appears. A plain check is throttled; a forced one runs.
    sw.subscriptions = [ACTIVE];
    const iosSite = jest.spyOn(api, 'iosSite').mockResolvedValue(BOUND);
    status.recheckSubscriptionStatus(false);
    await flush();
    expect(iosSite).not.toHaveBeenCalled();
    status.recheckSubscriptionStatus(true);
    await flush();
    expect(iosSite).toHaveBeenCalledWith('tx-1');
    expect(status.getSubscriptionStatus()).toBe('active');
    r.unmount();
  });

  test('not before Superwall has settled, and never locks a draft', async () => {
    await siteStore.saveSite(published);
    sw.status = 'INACTIVE';
    sw.configured = false;
    let r!: { unmount(): void };
    await act(async () => {
      r = create(React.createElement(SubscriptionStatusSync));
    });
    await flush();
    expect(status.getSubscriptionStatus()).toBe('unknown');
    r.unmount();

    sw.configured = true;
    await siteStore.saveSite({ ...published, slug: null, deployedUrl: null, transactionId: null });
    await act(async () => {
      r = create(React.createElement(SubscriptionStatusSync));
    });
    await flush();
    expect(status.getSubscriptionStatus()).toBe('unknown');
    r.unmount();
  });
});
