/**
 * The real analytics module (jest.config maps '@/lib/analytics' to a mock, so
 * it is required by relative path). Native SDKs are mocked; each test loads a
 * fresh copy so module state (started, pending queue) starts clean.
 */

const mockAf = {
  init: jest.fn(async () => {}),
  registerSessionReadyListener: jest.fn(async (cb: () => void) => {
    mockAf.sessionReady = cb;
  }),
  enableDebug: jest.fn(async () => {}),
  start: jest.fn(async () => {}),
  logEvent: jest.fn(async () => {}),
  getAppsFlyerUID: jest.fn(async (): Promise<string | null> => 'af-uid-1'),
  sessionReady: null as null | (() => void),
};
jest.mock('react-native-appsflyer', () => ({ __esModule: true, default: mockAf, AppsFlyer: mockAf }));

const mockPh = { capture: jest.fn(), identify: jest.fn(), reset: jest.fn(), screen: jest.fn() };
/** Every `new PostHog(key, options)`, shared across isolated module registries. */
const mockPhCtor = jest.fn((..._args: unknown[]) => mockPh);
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: function PostHog(...args: unknown[]) {
    return mockPhCtor(...args);
  },
}));

const mockAtt = { status: 'undetermined' as string, request: jest.fn(async () => ({ status: 'granted' })) };
jest.mock('expo-tracking-transparency', () => ({
  getTrackingPermissionsAsync: jest.fn(async () => ({ status: mockAtt.status })),
  requestTrackingPermissionsAsync: () => mockAtt.request(),
}));

type Analytics = typeof import('../src/lib/analytics');

function load(): Analytics {
  let mod!: Analytics;
  jest.isolateModules(() => {
    mod = require('../src/lib/analytics');
  });
  return mod;
}

const flush = () => new Promise((r) => setImmediate(r));
const afEvents = () => mockAf.logEvent.mock.calls.map((c: any[]) => c[0]);

/** Init, session ready, ATT answered: AppsFlyer has started. */
async function started(): Promise<Analytics> {
  const a = load();
  await a.initAttribution();
  mockAf.sessionReady?.();
  await a.requestTrackingThenStart();
  await flush();
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps queued *Once implementations; a test that leaves one must not leak it.
  mockAf.start.mockReset().mockImplementation(async () => {});
  mockAf.sessionReady = null;
  mockAtt.status = 'undetermined';
  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = 'devkey';
  process.env.EXPO_PUBLIC_APPLE_APP_ID = '6825001790';
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
  process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://us.i.posthog.com';
});

test('events wait until AppsFlyer starts', async () => {
  const a = load();
  await a.initAttribution();
  a.track('publish_tapped');
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  expect(a.pendingAttributionEvents()).toBe(1);

  // Session ready alone is not enough: the tracking prompt hasn't been answered.
  mockAf.sessionReady?.();
  await flush();
  expect(mockAf.start).not.toHaveBeenCalled();

  await a.requestTrackingThenStart();
  await flush();
  expect(mockAtt.request).toHaveBeenCalledTimes(1);
  expect(mockAf.start).toHaveBeenCalledTimes(1);
  expect(afEvents()).toEqual([{ eventName: 'af_initiated_checkout', eventValues: {} }]);
  expect(a.pendingAttributionEvents()).toBe(0);
});

test('an earlier ATT answer starts AppsFlyer at launch without asking again', async () => {
  mockAtt.status = 'denied';
  const a = load();
  await a.initAttribution();
  mockAf.sessionReady?.();
  await flush();
  expect(mockAf.start).toHaveBeenCalledTimes(1);
  await a.requestTrackingThenStart();
  expect(mockAtt.request).not.toHaveBeenCalled();
  expect(mockAf.start).toHaveBeenCalledTimes(1);
});

test('init: dev key and app id, debug logging only in dev, once per launch', async () => {
  const a = load();
  await a.initAttribution();
  await a.initAttribution();
  expect(mockAf.init).toHaveBeenCalledTimes(1);
  expect(mockAf.init).toHaveBeenCalledWith({ devKey: 'devkey', appId: '6825001790' });
  // Jest runs as a dev build.
  expect(mockAf.enableDebug).toHaveBeenCalledWith({ enabled: true });
});

test('a production build never enables AppsFlyer debug or per-event PostHog flushes', async () => {
  const g = global as unknown as { __DEV__: boolean };
  const dev = g.__DEV__;
  g.__DEV__ = false;
  try {
    const a = load();
    await a.initAttribution();
    expect(mockAf.init).toHaveBeenCalledTimes(1);
    expect(mockAf.enableDebug).not.toHaveBeenCalled();
    expect(mockPhCtor).toHaveBeenCalledTimes(1);
    expect(mockPhCtor.mock.calls[0][1]).not.toHaveProperty('flushAt');
  } finally {
    g.__DEV__ = dev;
  }
});

test('touch autocapture never records on-screen text (children) or styles', () => {
  const a = load();
  expect(a.POSTHOG_AUTOCAPTURE).toEqual({
    captureScreens: false,
    captureTouches: true,
    propsToCapture: ['testID', 'accessibilityLabel', 'ph-label'],
  });
  expect(a.POSTHOG_AUTOCAPTURE.propsToCapture).not.toContain('children');
});

test('publish_tapped sends af_initiated_checkout', async () => {
  const a = await started();
  a.track('publish_tapped', { entitled: false });
  expect(mockPh.capture).toHaveBeenCalledWith('publish_tapped', { entitled: false });
  expect(afEvents()).toEqual([{ eventName: 'af_initiated_checkout', eventValues: {} }]);
});

test('a subscriber republishing sends no af_initiated_checkout (PostHog still gets the tap)', async () => {
  const a = await started();
  a.track('publish_tapped', { entitled: true });
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  expect(a.pendingAttributionEvents()).toBe(0);
  expect(mockPh.capture).toHaveBeenCalledWith('publish_tapped', { entitled: true });
  a.track('publish_tapped', { entitled: false });
  expect(afEvents()).toEqual([{ eventName: 'af_initiated_checkout', eventValues: {} }]);
});

test('the queue keeps at most 50 events and flushes them all on start', async () => {
  const a = load();
  await a.initAttribution();
  for (let i = 0; i < 60; i++) a.track('publish_tapped');
  expect(a.pendingAttributionEvents()).toBe(50);
  mockAf.sessionReady?.();
  await a.requestTrackingThenStart();
  await flush();
  expect(mockAf.logEvent).toHaveBeenCalledTimes(50);
  expect(a.pendingAttributionEvents()).toBe(0);
});

test('events raised while start is in flight are queued and sent after the earlier ones', async () => {
  let finishStart!: () => void;
  mockAf.start.mockImplementationOnce(() => new Promise<void>((r) => (finishStart = r)));
  const a = load();
  await a.initAttribution();
  a.trackRegistration('email');
  mockAf.sessionReady?.();
  const starting = a.requestTrackingThenStart();
  await flush();
  expect(mockAf.start).toHaveBeenCalledTimes(1);
  a.track('publish_tapped'); // start not resolved yet
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  expect(a.pendingAttributionEvents()).toBe(2);
  finishStart();
  await starting;
  expect(afEvents().map((e: any) => e.eventName)).toEqual(['af_complete_registration', 'af_initiated_checkout']);
  a.track('publish_tapped');
  expect(mockAf.logEvent).toHaveBeenCalledTimes(3);
});

test('a failed start is retried once, on the next foreground', async () => {
  const { AppState } = require('react-native'); // eslint-disable-line @typescript-eslint/no-require-imports
  const remove = jest.fn();
  const listen = (AppState.addEventListener as jest.Mock).mockImplementation(() => ({ remove }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockAf.start.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
  const a = load();
  await a.initAttribution();
  a.track('publish_tapped');
  mockAf.sessionReady?.();
  await a.requestTrackingThenStart();
  await flush();
  expect(mockAf.start).toHaveBeenCalledTimes(1);
  expect(a.pendingAttributionEvents()).toBe(1);
  expect(listen).toHaveBeenCalledTimes(1);

  const onChange = listen.mock.calls[0][1] as (s: string) => void;
  onChange('active');
  await flush();
  expect(mockAf.start).toHaveBeenCalledTimes(2); // the one retry (fails again)
  expect(remove).toHaveBeenCalledTimes(1);
  expect(listen).toHaveBeenCalledTimes(1); // no second retry is scheduled
  expect(a.pendingAttributionEvents()).toBe(1); // still waiting, nothing lost
  warn.mockRestore();
});

test('subscription start sends af_subscribe with revenue', async () => {
  const a = await started();
  a.trackConversion('subscribe', 'aibarber_monthly', 19.99, 'USD');
  expect(afEvents()).toEqual([
    {
      eventName: 'af_subscribe',
      eventValues: { af_revenue: 19.99, af_currency: 'USD', af_content_id: 'aibarber_monthly' },
    },
  ]);
  expect(mockPh.capture).toHaveBeenCalledWith('subscription_started', {
    product: 'aibarber_monthly',
    price: 19.99,
    currency: 'USD',
  });
});

test('a trial sends nothing to AppsFlyer, PostHog only', async () => {
  const a = await started();
  a.trackConversion('trial', 'aibarber_monthly', 19.99, 'USD');
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  expect(a.pendingAttributionEvents()).toBe(0);
  expect(mockPh.capture).toHaveBeenCalledWith('trial_started', { product: 'aibarber_monthly', price: 19.99, currency: 'USD' });
});

test('af_lead only for imported sites; a manual site is PostHog only', async () => {
  const a = await started();
  a.track('site_generated', { importedFrom: 'manual' });
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  a.track('site_generated', { importedFrom: 'booking' });
  a.track('site_generated', { importedFrom: 'gbp' });
  expect(afEvents()).toEqual([
    { eventName: 'af_lead', eventValues: { imported_from: 'booking' } },
    { eventName: 'af_lead', eventValues: { imported_from: 'gbp' } },
  ]);
  expect(mockPh.capture).toHaveBeenCalledTimes(3);
  expect(mockPh.capture).toHaveBeenCalledWith('site_generated', { importedFrom: 'manual' });
});

test('every other event is PostHog only', async () => {
  const a = await started();
  for (const e of ['editor_opened', 'site_published', 'restore_tapped', 'account_deleted', 'publish_failed']) a.track(e, { x: 1 });
  expect(mockAf.logEvent).not.toHaveBeenCalled();
  expect(mockPh.capture).toHaveBeenCalledTimes(5);
});

test('sign-up sends af_complete_registration with the method', async () => {
  const a = await started();
  a.trackRegistration('email');
  expect(afEvents()).toEqual([{ eventName: 'af_complete_registration', eventValues: { af_registration_method: 'email' } }]);
  expect(mockPh.capture).toHaveBeenCalledWith('sign_up', { method: 'email' });
});

test('PostHog identify with the user id only, reset on sign-out', () => {
  const a = load();
  a.identifyUser('user-123');
  expect(mockPh.identify).toHaveBeenCalledWith('user-123');
  a.resetUser();
  expect(mockPh.reset).toHaveBeenCalledTimes(1);
});

test('AppsFlyer UID waits for init and is null without a dev key', async () => {
  const a = load();
  const uid = a.appsFlyerUID();
  await a.initAttribution();
  await expect(uid).resolves.toBe('af-uid-1');

  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = '';
  const b = load();
  await b.initAttribution();
  await expect(b.appsFlyerUID()).resolves.toBeNull();
  b.track('publish_tapped');
  expect(b.pendingAttributionEvents()).toBe(0);
});

test('without a phc_ key PostHog is off and nothing throws', () => {
  process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phx_personal';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const a = load();
  expect(a.posthog).toBeNull();
  a.track('editor_opened');
  a.identifyUser('u');
  a.resetUser();
  expect(mockPh.capture).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('the tracking prompt is asked at once when the app is already active', async () => {
  const { AppState } = require('react-native'); // eslint-disable-line @typescript-eslint/no-require-imports
  const before = AppState.currentState;
  AppState.currentState = 'active';
  try {
    const a = load();
    a.requestTrackingWhenActive();
    await flush();
    expect(mockAtt.request).toHaveBeenCalledTimes(1);
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  } finally {
    AppState.currentState = before;
  }
});

test('the tracking prompt waits for the app to be active, even after the first screen is gone', async () => {
  // jest-expo's AppState is a shared mock whose currentState is never 'active'.
  const { AppState } = require('react-native'); // eslint-disable-line @typescript-eslint/no-require-imports
  const remove = jest.fn();
  const listen = (AppState.addEventListener as jest.Mock).mockImplementation(() => ({ remove }));
  const a = load();
  a.requestTrackingWhenActive();
  a.requestTrackingWhenActive(); // a second mount of the first screen: still one prompt
  await flush();
  expect(mockAtt.request).not.toHaveBeenCalled();
  expect(listen).toHaveBeenCalledTimes(1);

  const onChange = listen.mock.calls[0][1] as (s: string) => void;
  onChange('background');
  await flush();
  expect(mockAtt.request).not.toHaveBeenCalled();
  onChange('active');
  await flush();
  expect(mockAtt.request).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('the root layout uses the safe autocapture and asks for tracking itself, not index', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require('fs');
  const path = require('path');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8') as string;
  const layout = read('src/app/_layout.tsx');
  expect(layout).toMatch(/<PostHogProvider client=\{posthog\} autocapture=\{POSTHOG_AUTOCAPTURE\}>/);
  // LaunchPrompts (src/lib/launchPrompts.tsx, tested in launchPrompts.test.ts) asks for
  // notifications, then tracking, once Superwall has settled.
  expect(layout).toMatch(/<LaunchPrompts \/>/);
  expect(layout).not.toMatch(/requestTracking/);
  const prompts = read('src/lib/launchPrompts.tsx');
  expect(prompts).toMatch(/const settled = useSuperwallSettled\(\);/);
  expect(prompts).toMatch(/if \(settled\) void runLaunchPrompts\(\);\s*\}, \[settled\]\);/);
  expect(read('src/app/index.tsx')).not.toMatch(/requestTracking/);
});
