// Lapsed-subscription lock: the status decision, its throttle and shared
// store. The runner (SubscriptionStatusSync) is tested in paywall.test.ts.
import { ApiError } from '@/lib/api';
import { PRODUCT_IDS } from '@/lib/publish';
import type { SiteRecord } from '@/lib/siteStore';
import {
  checkSubscriptionStatus, getSubscriptionStatus, isLocked, LAPSE_AFTER_MS, lastStatusCheckAt, RECHECK_MS,
  recheckSubscriptionStatus, resetSubscriptionStatusForTests, setSubscriptionStatus, shouldCheck, statusGeneration,
  subscribeSubscriptionStatus, type StatusInput,
} from '@/lib/subscriptionStatus';

const published = {
  draftId: 'd1',
  inputs: { shopName: 'Fade Factory' },
  data: { shopName: 'Fade Factory' },
  updatedAt: 1,
  slug: 'fade-factory',
  deployedUrl: 'https://fade-factory.aibarber.org',
  transactionId: 'tx-1',
} as unknown as SiteRecord;
const draft = { ...published, slug: null, deployedUrl: null, transactionId: null } as SiteRecord;
/** Loaded from the account: live, but never bound to this Apple ID. */
const adopted = { ...published, slug: null, transactionId: null } as SiteRecord;

const sub = (over: Record<string, unknown> = {}) => ({
  transactionId: 'tx-9', productId: PRODUCT_IDS[0], purchaseDate: '2026-10-01T00:00:00Z', isActive: true, isRevoked: false,
  ...over,
});
const NOW = Date.parse('2026-10-21T12:00:00Z');
/** This Apple ID's AI Barber subscription, ended 2 h before NOW. */
const ended = (over: Record<string, unknown> = {}) =>
  sub({ transactionId: 'tx-old', isActive: false, expirationDate: new Date(NOW - 2 * 3_600_000).toISOString(), ...over });
const bound = (over: Record<string, unknown> = {}) => ({
  siteId: 'fade-factory', deployedUrl: published.deployedUrl, siteData: null, active: true, ...over,
});

function input(over: Partial<StatusInput> = {}): StatusInput {
  return {
    site: published,
    pendingPublish: false,
    superwallStatus: 'INACTIVE',
    customerInfo: jest.fn(async () => ({ subscriptions: [] })),
    iosSite: jest.fn(async () => bound()) as unknown as StatusInput['iosSite'],
    ...over,
  };
}

beforeEach(() => resetSubscriptionStatusForTests());

describe('checkSubscriptionStatus', () => {
  test('a never-published draft is never judged (and never locked)', async () => {
    const i = input({ site: draft });
    await expect(checkSubscriptionStatus(i)).resolves.toBe('unknown');
    await expect(checkSubscriptionStatus(input({ site: null }))).resolves.toBe('unknown');
    expect(i.customerInfo).not.toHaveBeenCalled();
    expect(isLocked(draft, 'lapsed')).toBe(false);
    expect(isLocked(published, 'lapsed')).toBe(true);
    expect(isLocked(published, 'unknown')).toBe(false);
    expect(isLocked(published, 'active')).toBe(false);
  });

  test('no AI Barber subscription at all on this Apple ID proves nothing', async () => {
    const i = input();
    await expect(checkSubscriptionStatus(i)).resolves.toBe('unknown');
    const other = input({ customerInfo: async () => ({ subscriptions: [sub({ productId: 'com.other.app.monthly', isActive: false })] }) });
    await expect(checkSubscriptionStatus(other)).resolves.toBe('unknown');
    expect(i.iosSite).not.toHaveBeenCalled();
  });

  test('an ended subscription locks only once it ended at least an hour ago (the takedown), confirmed by the server', async () => {
    const at = (msAgo: number) =>
      input({
        now: NOW,
        customerInfo: async () => ({ subscriptions: [ended({ expirationDate: new Date(NOW - msAgo).toISOString() })] }),
        iosSite: jest.fn(async () => bound({ active: false })) as unknown as StatusInput['iosSite'],
      });
    const early = at(LAPSE_AFTER_MS - 1);
    await expect(checkSubscriptionStatus(early)).resolves.toBe('unknown');
    expect(early.iosSite).not.toHaveBeenCalled();

    const due = at(LAPSE_AFTER_MS);
    await expect(checkSubscriptionStatus(due)).resolves.toBe('lapsed');
    expect(due.iosSite).toHaveBeenCalledWith('tx-old');
  });

  test('a revoked (refunded) subscription locks at once; no expiry date is not enough', async () => {
    const revoked = input({
      now: NOW,
      customerInfo: async () => ({ subscriptions: [ended({ isRevoked: true, expirationDate: new Date(NOW + 86_400_000).toISOString() })] }),
      iosSite: (async () => bound({ active: false })) as unknown as StatusInput['iosSite'],
    });
    await expect(checkSubscriptionStatus(revoked)).resolves.toBe('lapsed');
    const noExpiry = input({ now: NOW, customerInfo: async () => ({ subscriptions: [ended({ expirationDate: null })] }) });
    await expect(checkSubscriptionStatus(noExpiry)).resolves.toBe('unknown');
  });

  test('the newest AI Barber subscription decides', async () => {
    const subscriptions = [
      ended({ transactionId: 'tx-ancient', purchaseDate: '2025-01-01T00:00:00Z', expirationDate: '2025-02-01T00:00:00Z' }),
      // Newest, ended only 10 minutes ago: not yet.
      ended({ purchaseDate: '2026-09-21T12:00:00Z', expirationDate: new Date(NOW - 600_000).toISOString() }),
    ];
    await expect(checkSubscriptionStatus(input({ now: NOW, customerInfo: async () => ({ subscriptions }) }))).resolves.toBe('unknown');
  });

  test('the server still saying active for an ended transaction is active', async () => {
    const i = input({ now: NOW, customerInfo: async () => ({ subscriptions: [ended()] }) });
    await expect(checkSubscriptionStatus(i)).resolves.toBe('active');
  });

  test('an active transaction asks the server: active or lapsed', async () => {
    const ok = input({ customerInfo: async () => ({ subscriptions: [sub()] }) });
    await expect(checkSubscriptionStatus(ok)).resolves.toBe('active');
    expect(ok.iosSite).toHaveBeenCalledWith('tx-9');

    const refunded = input({
      customerInfo: async () => ({ subscriptions: [sub()] }),
      iosSite: (async () => bound({ active: false })) as unknown as StatusInput['iosSite'],
    });
    await expect(checkSubscriptionStatus(refunded)).resolves.toBe('lapsed');
  });

  test.each([
    ['offline', new ApiError(0, 'network', 'offline')],
    ['a 5xx', new ApiError(503, 'http-503', 'down')],
    ['404 no-site', new ApiError(404, 'no-site', 'none')],
  ])('the server failing (%s) is unknown, never lapsed', async (_label, err) => {
    const i = input({
      customerInfo: async () => ({ subscriptions: [sub()] }),
      iosSite: (async () => {
        throw err;
      }) as unknown as StatusInput['iosSite'],
    });
    await expect(checkSubscriptionStatus(i)).resolves.toBe('unknown');
  });

  test('a subscription bound to another site says nothing about this one', async () => {
    const i = input({
      customerInfo: async () => ({ subscriptions: [sub()] }),
      iosSite: (async () => bound({ siteId: 'other-shop', active: false })) as unknown as StatusInput['iosSite'],
    });
    await expect(checkSubscriptionStatus(i)).resolves.toBe('unknown');
  });

  test('customer info failing or hanging is unknown', async () => {
    const fails = input({
      customerInfo: async () => {
        throw new Error('sdk');
      },
    });
    await expect(checkSubscriptionStatus(fails)).resolves.toBe('unknown');
    const hangs = input({ customerInfo: () => new Promise(() => {}), timeoutMs: 5 });
    await expect(checkSubscriptionStatus(hangs)).resolves.toBe('unknown');
  });

  test('Superwall not sure yet, or no Superwall at all: unknown without asking', async () => {
    for (const superwallStatus of ['UNKNOWN', null] as const) {
      const i = input({ superwallStatus });
      await expect(checkSubscriptionStatus(i)).resolves.toBe('unknown');
      expect(i.customerInfo).not.toHaveBeenCalled();
    }
  });

  test('Superwall says active but no transaction is readable yet: unknown', async () => {
    await expect(checkSubscriptionStatus(input({ superwallStatus: 'ACTIVE' }))).resolves.toBe('unknown');
  });

  test('a paid publish still pending is never a lapse', async () => {
    const i = input({ pendingPublish: true });
    await expect(checkSubscriptionStatus(i)).resolves.toBe('unknown');
    expect(i.customerInfo).not.toHaveBeenCalled();
  });

  test('a site loaded from the account locks only for a subscription bound to its own link', async () => {
    const endedSubs = async () => ({ subscriptions: [ended()] });
    // Another shop's ended subscription on this Apple ID: says nothing about this site.
    const otherShop = input({
      site: adopted, now: NOW, customerInfo: endedSubs,
      iosSite: (async () => bound({ siteId: 'other-shop', deployedUrl: 'https://other-shop.vercel.app', active: false })) as any,
    });
    await expect(checkSubscriptionStatus(otherShop)).resolves.toBe('unknown');
    // Its own subscription, ended: lapsed (a payer who reinstalled and signed in).
    const own = input({ site: adopted, now: NOW, customerInfo: endedSubs, iosSite: (async () => bound({ active: false })) as any });
    await expect(checkSubscriptionStatus(own)).resolves.toBe('lapsed');
    // The server has no URL: the slug must be the link's first label.
    const bySlug = input({
      site: adopted, now: NOW, customerInfo: endedSubs,
      iosSite: (async () => bound({ siteId: 'fade-factory', deployedUrl: null, active: false })) as any,
    });
    await expect(checkSubscriptionStatus(bySlug)).resolves.toBe('lapsed');
  });

  test("an active subscription for another site never locks a site loaded from the account", async () => {
    const refundedOther = input({
      site: adopted,
      customerInfo: async () => ({ subscriptions: [sub()] }),
      iosSite: (async () => bound({ siteId: 'other-shop', deployedUrl: 'https://other-shop.vercel.app', active: false })) as any,
    });
    await expect(checkSubscriptionStatus(refundedOther)).resolves.toBe('unknown');
    const ownActive = input({ site: adopted, customerInfo: async () => ({ subscriptions: [sub()] }) });
    await expect(checkSubscriptionStatus(ownActive)).resolves.toBe('active');
  });
});

describe('throttle and store', () => {
  test('about once per 5 minutes unless forced', () => {
    expect(shouldCheck(1000, null, false)).toBe(true);
    expect(shouldCheck(1000 + RECHECK_MS - 1, 1000, false)).toBe(false);
    expect(shouldCheck(1000 + RECHECK_MS, 1000, false)).toBe(true);
    expect(shouldCheck(1001, 1000, true)).toBe(true);
  });

  test('only a definitive result starts the throttle; listeners hear changes only', () => {
    const heard = jest.fn();
    const off = subscribeSubscriptionStatus(heard);
    setSubscriptionStatus('unknown', 50);
    expect(lastStatusCheckAt()).toBeNull();
    expect(heard).not.toHaveBeenCalled();

    setSubscriptionStatus('lapsed', 100);
    expect(getSubscriptionStatus()).toBe('lapsed');
    expect(lastStatusCheckAt()).toBe(100);
    setSubscriptionStatus('lapsed', 200);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(lastStatusCheckAt()).toBe(200);

    setSubscriptionStatus('active', 300);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  test('a check that started before a direct set (a live publish) is dropped', () => {
    const gen = statusGeneration();
    setSubscriptionStatus('active', 100); // onLive
    setSubscriptionStatus('lapsed', 200, gen); // the stale check's result
    expect(getSubscriptionStatus()).toBe('active');
    expect(lastStatusCheckAt()).toBe(100);
    // A check started after it applies.
    setSubscriptionStatus('lapsed', 300, statusGeneration());
    expect(getSubscriptionStatus()).toBe('lapsed');
  });

  test('a recheck without a mounted runner is a no-op', () => {
    expect(() => recheckSubscriptionStatus()).not.toThrow();
  });
});
