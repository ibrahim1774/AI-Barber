/**
 * STATE MATRIX: every user-reachable screen x every account state (test/matrix/screens.ts x states.ts).
 *
 * Why: a hand test found that a user who started from scratch (nothing paid, no account) saw an endless loading
 * screen on the Bookings and Store tabs. The flow tests only covered states after payment. Here each (screen, state)
 * pair renders the REAL screen on the REAL hooks/stores, with only the network (fetch -> FakeServer), StoreKit/Superwall
 * and Supabase faked, then asserts that once the answers (or failures) have arrived
 *   1. nothing is still loading (no ActivityIndicator, no "Loading" text), and
 *   2. there is a way forward (something pressable).
 * The "slow" state holds the plan answer first (loading is allowed then), releases it, and asserts the same.
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { FakeServer, boot, installFetch, type World } from '../e2e/harness';
import { wipeDisk } from '../e2e/mocks';
import { SCREENS, unreachableReason } from '../../test/matrix/screens';
import { STATES, installEmptyTables, type Ctx } from '../../test/matrix/states';

jest.mock('expo-superwall', () => require('../e2e/mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('../e2e/mocks').diskMock());
jest.mock('expo-router', () => {
  const R = require('react');
  const router = {
    push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissAll: jest.fn(), canGoBack: () => true, canDismiss: () => false, navigate: jest.fn(), setParams: jest.fn(),
  };
  return {
    router, useRouter: () => router, useLocalSearchParams: () => ({}), useGlobalSearchParams: () => ({}), usePathname: () => '/',
    useNavigation: () => ({ setOptions: jest.fn(), addListener: () => () => {}, getParent: () => undefined, isFocused: () => true }),
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []), useIsFocused: () => true,
    Redirect: () => null, Link: ({ children }: any) => children, Stack: { Screen: () => null }, Tabs: { Screen: () => null },
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: any) => children, SafeAreaProvider: ({ children }: any) => children,
}));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('react-native-webview', () => ({ WebView: () => null, default: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }), { virtual: true });

/* eslint-disable @typescript-eslint/no-require-imports */
const FLUSHES = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let openURL: jest.SpyInstance;
let server: FakeServer;
let world: World | null = null;
const trees: any[] = [];

beforeEach(() => {
  jest.useRealTimers();
  jest.resetModules();
  wipeDisk();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  for (const t of trees.splice(0)) { try { world?.act(() => t.unmount()); } catch { /* gone */ } }
  try { world?.unmount(); } catch { /* gone */ }
  world = null;
  jest.restoreAllMocks();
});

const flush = async (w: World) => {
  for (let i = 0; i < FLUSHES; i++) await w.act(async () => { await sleep(15); });
};

const textOf = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');
const screenText = (t: any): string => t.root.findAll((n: any) => n.type === 'Text').map(textOf).join(' | ');
const spinners = (t: any) => t.root.findAll((n: any) => n.type === 'ActivityIndicator').length;
const pressables = (t: any) =>
  t.root.findAll((n: any) => typeof n.props?.onPress === 'function' && n.props?.disabled !== true).length;

const cells = SCREENS.flatMap((s) => STATES.map((st) => ({ s, st, skip: unreachableReason(s, st) })));
const reachable = cells.filter((c) => !c.skip);
const skipped = cells.filter((c) => c.skip);

it('every unreachable pair names a reason and refers to a real state', () => {
  const ids = new Set(STATES.map((s) => s.id));
  for (const s of SCREENS) for (const [k, why] of Object.entries(s.unreachable ?? {})) { expect(ids.has(k)).toBe(true); expect(why.length).toBeGreaterThan(10); }
  for (const c of skipped) expect((c.skip as string).length).toBeGreaterThan(10);
  expect(reachable.length + skipped.length).toBe(SCREENS.length * STATES.length);
});

describe.each(SCREENS.map((s) => [s.title, s] as const))('%s', (_t, screen) => {
  it.each(STATES.filter((st) => !unreachableReason(screen, st)).map((st) => [`${st.id} ${st.title}`, st] as const))('%s', async (_n, st) => {
    server = new FakeServer();
    const net = { offline: false };
    const db: any[] = [];
    const ctx: Ctx = { server, db, net };
    (globalThis as any).fetch = (url: string, init: any) => (net.offline ? Promise.reject(new TypeError('Network request failed')) : server.handle(url, init));
    st.prepare(ctx);
    let release: () => void = () => {};
    if (st.slowPlan) {
      const held = new Promise<void>((r) => { release = r; });
      server.fail('/api/shop/plan', { kind: 'held', release: held }, 50);
    }
    world = await boot(server, { user: st.user });
    world.sb.rows = db;
    // The claim screen waits out transient publish answers by itself; a virtual clock lets the wait finish at once.
    const wait = require('@/lib/claim').waitConfig;
    let vclock = 0;
    wait.now = () => vclock;
    wait.sleep = async (ms: number) => { vclock += ms; };
    installEmptyTables(require('@/lib/supabase').supabase, world.sb, net);
    const act = screen.prime?.(world);
    const Screen = screen.load();
    const PlanSync = require('@/lib/planSync').PlanSync;
    const tree = await world.render(
      React.createElement(React.Fragment, null, React.createElement(PlanSync), React.createElement(Screen)),
    );
    trees.push(tree);
    await flush(world);
    if (act) { await world.act(async () => { await act(); }); await flush(world); }
    if (st.slowPlan) {
      release();
      await flush(world);
    }
    const text = screenText(tree);
    const { router } = require('expo-router');
    const left = ['push', 'replace', 'back', 'dismissAll', 'navigate'].some((k) => (router[k] as jest.Mock).mock.calls.length > 0);
    if (process.env.MX_DUMP) require('fs').appendFileSync(process.env.MX_DUMP, `${screen.id} ${st.id} left=${left} :: ${text.slice(0, 160)}\n`);
    const verdict = { spinners: spinners(tree), loading: /\bloading\b/i.test(text), pressables: pressables(tree) };
    // A screen that hands over to another one (a redirect, a closed paywall, a finished publish) has its way forward.
    const ok = verdict.spinners === 0 && !verdict.loading && (verdict.pressables > 0 || left);
    if (!ok) throw new Error(`NOT SETTLED ${JSON.stringify(verdict)} text=[${text.slice(0, 200)}]`);
    // The payment lock (payment failed / revoked blocks, Apple's retry is a banner, everything else shows neither: active,
    // loading, offline, a server error, another account's purchase, never purchased).
    const lockText = /Payment failed|Subscription ended|Please renew your payment/;
    if (screen.payment && st.payment === 'block') {
      if (screen.payment === 'gated') {
        const m = st.id === 'S14' ? /Subscription ended[\s\S]*refunded or cancelled[\s\S]*Update payment method[\s\S]*check again/ : /Payment failed[\s\S]*Please renew your payment to keep editing your site\. Your subscription could not be renewed\.[\s\S]*Update payment method[\s\S]*check again/;
        if (!m.test(text)) throw new Error(`PAYMENT BLOCK missing in [${text.slice(0, 300)}]`);
        // Blocked: the screen's own content is gone.
        if (/Add service|Publish\b.*Pages|Set up bookings|Products \| Orders/.test(text)) throw new Error(`PAYMENT BLOCK must replace the content: [${text.slice(0, 300)}]`);
      } else if (!/Offline[\s\S]*Update payment method/.test(text)) {
        throw new Error(`PAYMENT: Settings must show Offline + Update payment method in [${text.slice(0, 300)}]`);
      }
      const press = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function' && /Update payment method/.test(textOf(n)));
      expect(press.length).toBeGreaterThan(0);
      await world.act(async () => { await press[0].props.onPress(); });
      expect(openURL).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
      return;
    }
    if (screen.payment && st.payment === 'banner') {
      if (!/Payment failed\. Update your payment method to keep your site\./.test(text)) throw new Error(`PAYMENT BANNER missing in [${text.slice(0, 300)}]`);
      if (/Please renew your payment/.test(text)) throw new Error('a retry window must not block');
      const press = tree.root.findAll((n: any) => typeof n.props?.onPress === 'function' && /Update payment method/.test(textOf(n)));
      expect(press.length).toBeGreaterThan(0);
      await world.act(async () => { await press[0].props.onPress(); });
      expect(openURL).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
    } else if (!st.payment && lockText.test(text)) {
      throw new Error(`NO PAYMENT NOTICE expected in this state, got [${text.slice(0, 300)}]`);
    }
    const want = screen.expects?.[st.id] ?? screen.expects?.['*'];
    if (want && !want.test(text)) throw new Error(`WRONG CONTENT: expected ${want} in [${text.slice(0, 300)}]`);
    const nope = screen.forbids?.[st.id] ?? screen.forbids?.['*'];
    if (nope && nope.test(text)) throw new Error(`WRONG CONTENT: ${nope} must not appear in [${text.slice(0, 300)}]`);
  });
});
