/**
 * RevenueCat as an observer beside Superwall (src/lib/revenuecat.ts), with the
 * real analytics module (jest.config maps '@/lib/analytics' to a mock) so the
 * AppsFlyer id and the tracking prompt are the real ones. Native SDKs are
 * mocked; each test loads fresh copies so module state starts clean.
 */

const mockAf = {
  init: jest.fn(async () => {}),
  registerSessionReadyListener: jest.fn(async (_cb: () => void) => {}),
  enableDebug: jest.fn(async () => {}),
  start: jest.fn(async () => {}),
  logEvent: jest.fn(async () => {}),
  getAppsFlyerUID: jest.fn(async (): Promise<string | null> => 'af-uid-1'),
};
jest.mock('react-native-appsflyer', () => ({ __esModule: true, default: mockAf, AppsFlyer: mockAf }));
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: function PostHog() {
    return { capture: jest.fn(), identify: jest.fn(), reset: jest.fn(), screen: jest.fn() };
  },
}));

const mockAtt = { status: 'undetermined' as string, request: jest.fn(async () => ({ status: 'granted' })) };
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: jest.fn(async () => ({ status: mockAtt.status })),
  requestTrackingPermissionsAsync: () => mockAtt.request(),
}));
jest.mock('@/lib/analytics', () => jest.requireActual('../src/lib/analytics'));

type Loaded = {
  rc: typeof import('../src/lib/revenuecat');
  analytics: typeof import('../src/lib/analytics');
  Purchases: (typeof import('../test/mocks/purchases'))['default'];
};

/** One isolated registry, so revenuecat.ts sees this analytics and this Purchases mock. */
function load(): Loaded {
  let out!: Loaded;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    out = {
      rc: require('../src/lib/revenuecat'),
      analytics: require('@/lib/analytics'),
      Purchases: require('react-native-purchases').default,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return out;
}

const flush = () => new Promise((r) => setImmediate(r));

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockAtt.status = 'undetermined';
  mockAf.getAppsFlyerUID.mockImplementation(async () => 'af-uid-1');
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = 'devkey';
  process.env.EXPO_PUBLIC_APPLE_APP_ID = '6825001790';
  process.env.EXPO_PUBLIC_POSTHOG_KEY = '';
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('configure', () => {
  test('is skipped quietly without a key, and nothing else reaches RevenueCat', async () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    const { rc, analytics, Purchases } = load();
    await analytics.initAttribution();

    expect(rc.startRevenueCat()).toBe(false);
    rc.syncRevenueCatPurchases();
    await analytics.requestTrackingThenStart();
    await flush();

    expect(Purchases.configure).not.toHaveBeenCalled();
    expect(Purchases.collectDeviceIdentifiers).not.toHaveBeenCalled();
    expect(Purchases.setAppsflyerID).not.toHaveBeenCalled();
    expect(Purchases.syncPurchases).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test('an empty key is no key', () => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = '';
    const { rc, Purchases } = load();
    expect(rc.startRevenueCat()).toBe(false);
    expect(Purchases.configure).not.toHaveBeenCalled();
  });

  test('purchases are completed by the app (Superwall) with StoreKit 2, once per launch, anonymously', () => {
    const { rc, Purchases } = load();

    expect(rc.startRevenueCat()).toBe(true);
    expect(rc.startRevenueCat()).toBe(true);

    expect(Purchases.configure).toHaveBeenCalledTimes(1);
    expect(Purchases.configure).toHaveBeenCalledWith({
      apiKey: 'appl_test',
      purchasesAreCompletedBy: { type: 'MY_APP', storeKitVersion: 'STOREKIT_2' },
    });
    // No appUserID and no logIn: the RevenueCat user stays anonymous.
    expect((Purchases.configure.mock.calls[0][0] as Record<string, unknown>).appUserID).toBeUndefined();
    expect(Purchases.logIn).not.toHaveBeenCalled();
  });
});

describe('attribution attributes', () => {
  test('setAppsflyerID gets the AppsFlyer id once AppsFlyer has initialised', async () => {
    const { rc, analytics, Purchases } = load();
    rc.startRevenueCat();
    await flush();
    // appsFlyerUID waits for AppsFlyer's init.
    expect(Purchases.setAppsflyerID).not.toHaveBeenCalled();

    await analytics.initAttribution();
    await flush();

    expect(Purchases.setAppsflyerID).toHaveBeenCalledTimes(1);
    expect(Purchases.setAppsflyerID).toHaveBeenCalledWith('af-uid-1');
  });

  test('an AppsFlyer id known before configure (Superwall settling late) is still set, once', async () => {
    const { rc, analytics, Purchases } = load();
    await analytics.initAttribution();
    await expect(analytics.appsFlyerUID()).resolves.toBe('af-uid-1');
    expect(Purchases.setAppsflyerID).not.toHaveBeenCalled();

    rc.startRevenueCat();
    await flush();
    expect(Purchases.setAppsflyerID).toHaveBeenCalledTimes(1);
    expect(Purchases.setAppsflyerID).toHaveBeenCalledWith('af-uid-1');
    expect(Purchases.configure.mock.invocationCallOrder[0]).toBeLessThan(Purchases.setAppsflyerID.mock.invocationCallOrder[0]);
  });

  test('no AppsFlyer id (AppsFlyer off): setAppsflyerID is not called', async () => {
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = '';
    const { rc, analytics, Purchases } = load();
    await analytics.initAttribution();
    rc.startRevenueCat();
    await flush();
    expect(Purchases.setAppsflyerID).not.toHaveBeenCalled();
  });

  test('collectDeviceIdentifiers runs after configure, and again once the tracking prompt is answered', async () => {
    const { rc, analytics, Purchases } = load();
    await analytics.initAttribution();
    rc.startRevenueCat();
    expect(Purchases.collectDeviceIdentifiers).toHaveBeenCalledTimes(1);

    let answered = false;
    mockAtt.request.mockImplementationOnce(async () => {
      // Still once while the prompt is up: the IDFA isn't readable yet.
      expect(Purchases.collectDeviceIdentifiers).toHaveBeenCalledTimes(1);
      answered = true;
      return { status: 'granted' };
    });
    const answeredAtCollect: boolean[] = [];
    Purchases.collectDeviceIdentifiers.mockImplementation(async () => {
      answeredAtCollect.push(answered);
    });

    await analytics.requestTrackingThenStart();
    expect(mockAtt.request).toHaveBeenCalledTimes(1);
    expect(Purchases.collectDeviceIdentifiers).toHaveBeenCalledTimes(2);
    expect(answeredAtCollect).toEqual([true]);
  });

  test('a prompt answered before configure: collected at configure, and once more straight after', async () => {
    mockAtt.status = 'denied';
    const { rc, analytics, Purchases } = load();
    await analytics.requestTrackingThenStart();
    expect(mockAtt.request).not.toHaveBeenCalled();

    rc.startRevenueCat();
    // After configure, plus the settled-tracking listener firing at once. Repeat calls are safe.
    expect(Purchases.collectDeviceIdentifiers).toHaveBeenCalledTimes(2);
  });

  test('no prompt and no device identifiers before configure', async () => {
    const { analytics, Purchases } = load();
    await analytics.requestTrackingThenStart();
    expect(Purchases.collectDeviceIdentifiers).not.toHaveBeenCalled();
  });
});

describe('sync after a purchase or restore', () => {
  test('syncPurchases once per call when configured, without waiting for it', () => {
    const { rc, Purchases } = load();
    rc.startRevenueCat();
    Purchases.syncPurchases.mockImplementationOnce(() => new Promise<void>(() => {}));
    const out = rc.syncRevenueCatPurchases();
    expect(out).toBeUndefined();
    expect(Purchases.syncPurchases).toHaveBeenCalledTimes(1);
    rc.syncRevenueCatPurchases();
    expect(Purchases.syncPurchases).toHaveBeenCalledTimes(2);
  });

  test('a sync asked for before configure waits for it, then happens once', () => {
    const { rc, Purchases } = load();
    rc.syncRevenueCatPurchases();
    rc.syncRevenueCatPurchases();
    expect(Purchases.syncPurchases).not.toHaveBeenCalled();

    rc.startRevenueCat();
    expect(Purchases.syncPurchases).toHaveBeenCalledTimes(1);
    // Configure comes first.
    expect(Purchases.configure.mock.invocationCallOrder[0]).toBeLessThan(Purchases.syncPurchases.mock.invocationCallOrder[0]);
    rc.startRevenueCat();
    expect(Purchases.syncPurchases).toHaveBeenCalledTimes(1);
  });

  test('without a key a queued sync never reaches RevenueCat', () => {
    delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
    const { rc, Purchases } = load();
    rc.syncRevenueCatPurchases();
    rc.startRevenueCat();
    expect(Purchases.syncPurchases).not.toHaveBeenCalled();
  });
});

describe('failures are swallowed', () => {
  test('a configure that throws: startRevenueCat returns false, later calls are no-ops', async () => {
    const { rc, analytics, Purchases } = load();
    Purchases.configure.mockImplementationOnce(() => {
      throw new Error('[RevenueCat] Native module (RNPurchases) not found');
    });

    expect(() => rc.startRevenueCat()).not.toThrow();
    expect(Purchases.collectDeviceIdentifiers).not.toHaveBeenCalled();
    expect(() => rc.syncRevenueCatPurchases()).not.toThrow();
    expect(Purchases.syncPurchases).not.toHaveBeenCalled();
    expect(Purchases.collectDeviceIdentifiers).not.toHaveBeenCalled();
    await analytics.initAttribution();
    await flush();
    expect(Purchases.setAppsflyerID).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test('rejections from every call are caught (no unhandled rejection) and only logged', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { rc, analytics, Purchases } = load();
      Purchases.collectDeviceIdentifiers.mockRejectedValue(new Error('collect'));
      Purchases.setAppsflyerID.mockRejectedValue(new Error('appsflyer'));
      Purchases.syncPurchases.mockRejectedValue(new Error('sync'));

      expect(rc.startRevenueCat()).toBe(true);
      await analytics.initAttribution();
      await analytics.requestTrackingThenStart();
      rc.syncRevenueCatPurchases();
      await flush();
      await flush();

      expect(Purchases.setAppsflyerID).toHaveBeenCalled();
      expect(Purchases.syncPurchases).toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
      const logged = warn.mock.calls.map((c) => String(c[0]));
      expect(logged).toEqual(expect.arrayContaining([
        expect.stringContaining('collectDeviceIdentifiers'),
        expect.stringContaining('setAppsflyerID'),
        expect.stringContaining('syncPurchases'),
      ]));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  test('synchronous throws from the other calls are caught too', async () => {
    const { rc, analytics, Purchases } = load();
    Purchases.collectDeviceIdentifiers.mockImplementation(() => {
      throw new Error('collect');
    });
    Purchases.syncPurchases.mockImplementation(() => {
      throw new Error('sync');
    });
    Purchases.setAppsflyerID.mockImplementation(() => {
      throw new Error('appsflyer');
    });

    expect(() => rc.startRevenueCat()).not.toThrow();
    await expect(analytics.requestTrackingThenStart()).resolves.toBeUndefined();
    expect(() => rc.syncRevenueCatPurchases()).not.toThrow();
    await analytics.initAttribution();
    await flush();
    expect(Purchases.setAppsflyerID).toHaveBeenCalled();
  });

  test('AppsFlyer failing to give an id never reaches the caller', async () => {
    mockAf.getAppsFlyerUID.mockImplementation(async () => {
      throw new Error('af');
    });
    const { rc, analytics, Purchases } = load();
    expect(rc.startRevenueCat()).toBe(true);
    await analytics.initAttribution();
    await flush();
    expect(Purchases.setAppsflyerID).not.toHaveBeenCalled();
  });
});
