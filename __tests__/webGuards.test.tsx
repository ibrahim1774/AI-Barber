/**
 * The web branch must leave the phone app alone: app.config.js adds the web-only settings only for the web export, the
 * service form checks run only in the browser, the plan screen is a no-op route on the phone, and the web plan shim
 * never claims "no plan" before /me has answered.
 */
jest.mock('@/constants/theme', () => require('./store/themeMock'));
import React from 'react';
import { Platform } from 'react-native';
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
import { isStripeUrl } from '@/lib/webBilling';
import { __resetWebPlan, isWebPlanActive, markWebPlanSettled, setWebPlanActive, webPlanCheckFailed, webPlanReady } from '@/lib/webPlan';
import { draftToPatch, draftErrors, type ServiceDraft } from '@/lib/setup/serviceDraft';
import { useTour, type TourController } from '@/components/tutorial/useTour';
import { TOURS, WEB_EDIT_STEPS } from '@/components/tutorial/tours';
import { formProblems } from '@/components/sections/ServicesSheet';

const asWeb = (fn: () => void) => {
  const spy = jest.replaceProperty(Platform, 'OS', 'web');
  try { fn(); } finally { spy.restore(); }
};

describe('app.config.js (item 1)', () => {
  const base = { name: 'Prime Barber', experiments: { typedRoutes: true, reactCompiler: true } };
  const cfg = require('../app.config.js');
  const saved = process.env.EXPO_WEB_EXPORT;
  afterEach(() => { if (saved === undefined) delete process.env.EXPO_WEB_EXPORT; else process.env.EXPO_WEB_EXPORT = saved; });
  it('native config is returned untouched (no baseUrl, no web block)', () => {
    delete process.env.EXPO_WEB_EXPORT;
    const out = cfg({ config: base });
    expect(out).toEqual(base);
    expect(out.experiments.baseUrl).toBeUndefined();
    expect(out.web).toBeUndefined();
  });
  it('the web export adds baseUrl /app and the single-page metro web settings', () => {
    process.env.EXPO_WEB_EXPORT = '1';
    const out = cfg({ config: base });
    expect(out.experiments).toEqual({ typedRoutes: true, reactCompiler: true, baseUrl: '/app' });
    expect(out.web).toEqual({ output: 'single', bundler: 'metro' });
  });
  it('app.json itself has no baseUrl or web block', () => {
    const j = require('../app.json').expo;
    expect(j.experiments.baseUrl).toBeUndefined();
    expect(j.web).toBeUndefined();
  });
});

describe('service form checks are web only (item 2)', () => {
  const d: ServiceDraft = { name: 'x'.repeat(81), price: '-5', durationMin: 700, description: '', photoUrl: null, depositType: 'none', deposit: '', showOnSite: true } as unknown as ServiceDraft;
  it('phone: draftToPatch does not apply the new limits (as before)', () => {
    expect(Platform.OS).toBe('ios');
    const r = draftToPatch({ ...d, price: '', durationMin: 700 });
    expect(r.ok).toBe(true);
  });
  it('phone: no inline problems for the sheet form', () => {
    expect(formProblems({ title: 'x'.repeat(90), price: '-3' } as never)).toEqual({});
  });
  it('web: draftToPatch refuses them and the sheet shows inline problems', () => {
    asWeb(() => {
      expect(draftToPatch({ ...d, price: '' }).ok).toBe(false);
      expect(Object.keys(draftErrors(d)).length).toBeGreaterThan(0);
      expect(formProblems({ title: 'x'.repeat(90), price: '-3' } as never)).toEqual(expect.objectContaining({ title: expect.any(String), price: expect.any(String) }));
    });
  });
});

describe('web-paywall route (item 3)', () => {
  it('on the phone it redirects and never calls checkout', () => {
    jest.doMock('expo-router', () => ({ Redirect: (p: { href: string }) => require('react').createElement('Redirect', p), router: { replace: jest.fn(), back: jest.fn() } }));
    const fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation((() => Promise.reject(new Error('no network'))) as never);
    jest.isolateModules(() => {
      const Route = require('../src/app/web-paywall').default;
      let t: any;
      act(() => { t = TestRenderer.create(React.createElement(Route)); });
      expect(JSON.stringify(t.toJSON())).toContain('"/"');
      expect(JSON.stringify(t.toJSON())).not.toContain('Continue to checkout');
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('isStripeUrl (nit)', () => {
  it('accepts only https Stripe checkout / billing pages', () => {
    expect(isStripeUrl('https://checkout.stripe.com/c/pay/cs_1')).toBe(true);
    expect(isStripeUrl('https://billing.stripe.com/p/session/x')).toBe(true);
    for (const u of ['http://checkout.stripe.com/x', 'https://evil.com/checkout.stripe.com', 'https://checkout.stripe.com.evil.com/', 'javascript:alert(1)', '', null, undefined, 5]) expect(isStripeUrl(u)).toBe(false);
  });
});

describe('webPlan (items 5, 6)', () => {
  beforeEach(() => __resetWebPlan());
  it('a failed check settles webPlanReady at once without turning the plan on', async () => {
    markWebPlanSettled({ failed: true });
    await expect(webPlanReady(5000)).resolves.toBeUndefined();
    expect(isWebPlanActive()).toBe(false);
    expect(webPlanCheckFailed()).toBe(true);
  });
  it('a good answer clears the failed flag and is the plan state', () => {
    markWebPlanSettled({ failed: true });
    setWebPlanActive(true);
    expect(webPlanCheckFailed()).toBe(false);
    expect(isWebPlanActive()).toBe(true);
  });
});

describe('superwall web shim (items 4, 7)', () => {
  let me: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  let session: () => Promise<unknown>;
  let wp: typeof import('@/lib/webPlan');
  function load() {
    let shim: any;
    jest.isolateModules(() => {
      jest.doMock('expo-router', () => ({ router: { push: jest.fn() } }));
      jest.doMock('react-native', () => ({ Text: 'Text', Pressable: 'Pressable', View: 'View' }));
      jest.doMock('../src/lib/supabase', () => ({ supabase: { auth: { getSession: () => session(), onAuthStateChange: () => {} } } }));
      const g = globalThis as any; const w = g.window;
      g.window = { addEventListener: () => {}, location: { search: '' } };
      try { shim = require('../web-shims/superwall.js'); } finally { g.window = w; }
      wp = require('../src/lib/webPlan');
    });
    return shim;
  }
  beforeEach(() => {
    jest.useFakeTimers();
    __resetWebPlan();
    session = async () => ({ data: { session: { access_token: 't' } } });
    (globalThis as any).fetch = jest.fn(() => me());
  });
  afterEach(() => { jest.useRealTimers(); });

  it('starts UNKNOWN and stays UNKNOWN when /me fails, then retries with backoff', async () => {
    me = async () => ({ ok: false, json: async () => ({}) });
    const shim = load();
    expect(shim.__state().status.status).toBe('UNKNOWN');
    await shim.__refreshWebSubscription();
    expect(shim.__state().status.status).toBe('UNKNOWN');
    expect(wp.webPlanCheckFailed()).toBe(true);
    me = async () => ({ ok: true, json: async () => ({ entitled: true, tier: 'bookings', interval: 'month', subscriptionId: 'sub_1' }) });
    await jest.advanceTimersByTimeAsync(2100);
    expect(shim.__state().status.status).toBe('ACTIVE');
    expect(wp.webPlanCheckFailed()).toBe(false);
  });

  it('a /me answer for an earlier call cannot apply after a newer one', async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => { release = r; });
    me = async () => { await slow; return { ok: true, json: async () => ({ entitled: true, tier: 'store', interval: 'month', subscriptionId: 'old' }) }; };
    const shim = load();
    const first = shim.__refreshWebSubscription();            // account A, in flight
    await Promise.resolve(); await Promise.resolve();
    session = async () => ({ data: { session: null } });       // signed out
    await shim.__refreshWebSubscription();
    expect(shim.__state().status.status).toBe('INACTIVE');
    release(); await first;
    expect(shim.__state().status.status).toBe('INACTIVE');     // A's late answer was ignored
    expect(wp.isWebPlanActive()).toBe(false);
  });
});

describe('coach marks on web (replaced steps, same auto-start rule)', () => {
  let ctl: TourController;
  function Probe() { ctl = useTour('edit', { auto: 'edit', ignoreFlag: true, ready: true }); return null; }
  const mount = async () => { await act(async () => { TestRenderer.create(React.createElement(Probe)); }); };
  it('phone: the Edit tour opens by itself with its own steps', async () => {
    await mount();
    expect(ctl.tour?.steps).toBe(TOURS.edit.steps);
  });
  it('web: it opens by itself with the short web steps (max 6, ends at Publish)', async () => {
    const spy = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await mount();
      expect(ctl.tour?.steps).toBe(WEB_EDIT_STEPS);
      expect(WEB_EDIT_STEPS.length).toBeLessThanOrEqual(6);
      expect(WEB_EDIT_STEPS[WEB_EDIT_STEPS.length - 1].target).toBe('edit.publish');
      expect(WEB_EDIT_STEPS.map((x) => x.target)).toEqual(expect.arrayContaining(['edit.changeImage', 'edit.text', 'edit.sections']));
    } finally { spy.restore(); }
  });
});
