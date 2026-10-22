/**
 * Double taps and overlapping runs: Publish (two entry points, plus the launch
 * retry) and the upgrade buttons.
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());

import { Alert } from 'react-native';
import { FakeServer, P, boot, draft, installFetch, type World } from './harness';
import { wipeDisk } from './mocks';

let server: FakeServer;
let w: World;

beforeEach(async () => {
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  try {
    w?.unmount();
  } catch {
    /* unmounted */
  }
  jest.restoreAllMocks();
});

const drain = () => new Promise((r) => setTimeout(r, 20));

async function liveSite() {
  w = await boot(server, { user: 'u1' });
  await w.m.siteStore.saveSite(draft());
  w.willBuy(P.websiteMonthly);
  const site = await w.site();
  expect(await w.m.publish.publishFlow(site!, w.deps)).toMatchObject({ kind: 'live' });
  await drain();
  await w.superwallSync();
}

describe('publish', () => {
  it('two Publish runs at once never overlap on the network; the second waits and builds on the first', async () => {
    await liveSite();
    let inFlight = 0;
    let maxInFlight = 0;
    const real = (globalThis as any).fetch;
    (globalThis as any).fetch = async (url: string, init: any) => {
      const isPublish = url.endsWith('/api/ios/publish');
      if (isPublish) maxInFlight = Math.max(maxInFlight, ++inFlight);
      try {
        await drain();
        return await real(url, init);
      } finally {
        if (isPublish) inFlight--;
      }
    };
    const site = await w.site();
    const a = w.m.publish.publishFlow(site!, w.deps);
    const b = w.m.publish.publishFlow(site!, w.deps);
    expect(w.m.publish.publishBusy()).toBe(true);
    expect(await a).toMatchObject({ kind: 'live' });
    expect(await b).toMatchObject({ kind: 'live' });
    expect(maxInFlight).toBe(1);
    const bases = server.calls.filter((c) => c.path === '/api/ios/publish').map((c) => c.body.baseVersion);
    expect(bases).toEqual([undefined, 1, 2]);
    expect(w.m.publish.publishBusy()).toBe(false);
  });

  it('the launch retry and a Publish tap: one after the other, the pending one first, nothing lost', async () => {
    await liveSite();
    server.fail('/api/ios/publish', { kind: 'json', status: 503, body: { error: 'temporarily-unavailable' } });
    const site = await w.site();
    expect(await w.m.publish.publishFlow(site!, w.deps)).toMatchObject({ kind: 'pending' });
    const retry = w.m.publish.resumePendingPublish(w.deps);
    const tap = w.m.publish.publishFlow((await w.site())!, w.deps);
    expect(await retry).toMatchObject({ kind: 'live' });
    expect(await tap).toMatchObject({ kind: 'live' });
    expect(await w.pending()).toBeNull();
  });
});

describe('upgrade buttons', () => {
  // BUG (low): useUpgrade guards with `busy` state; two presses before React re-renders both open a paywall
  // (the first is then superseded and reported as a decline).
  it.failing('BUG: two presses of "See the Bookings plan" in one frame register one placement', async () => {
    await liveSite();
    const register = jest.fn(() => new Promise<void>(() => {}));
    w.sw.register = register;
    const up = await w.probe(() => w.m.tierAccess.useUpgrade('bookings_upgrade'));
    await w.act(async () => {
      void up.get().run();
      void up.get().run();
    });
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('a second press after the re-render is ignored while the paywall is up', async () => {
    await liveSite();
    const register = jest.fn(() => new Promise<void>(() => {}));
    w.sw.register = register;
    const up = await w.probe(() => w.m.tierAccess.useUpgrade('bookings_upgrade'));
    await w.act(async () => {
      void up.get().run();
    });
    expect(up.get().busy).toBe(true);
    await w.act(async () => {
      void up.get().run();
    });
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('Store bought while Superwall still reports Bookings: declined after the 10 s window, then the tab unlocks when the mirror catches up', async () => {
    await liveSite();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    w.sw.register = async () => {
      server.buy(P.storeMonthly); // StoreKit has it; Superwall's entitlements have not caught up
    };
    let out: string | null = null;
    const p = w.show('store_upgrade').then((r) => (out = r));
    await jest.advanceTimersByTimeAsync(9_500);
    expect(out).toBeNull();
    await jest.advanceTimersByTimeAsync(1_500);
    await p;
    expect(out).toBe('declined');
    jest.useRealTimers();
    await w.superwallSync();
    expect(w.m.entitlements.getEntitlements().store).toBe(true);
    const gate = await w.probe(() => w.m.tierAccess.useTierAccess('store'));
    expect(gate.get()).toMatchObject({ status: 'ready', entitled: true });
  });
});
