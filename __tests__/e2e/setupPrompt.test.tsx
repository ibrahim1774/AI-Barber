/**
 * The "Add / Remove the Book / Shop button" prompt after Bookings or Store setup: when it shows (pure
 * helper), and that Update my site runs the publish flow (the /publishing screen) once per prompt.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, render } from '../store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
const mockCtx = jest.fn();
jest.mock('@/lib/linkContext', () => ({ loadLinkContext: () => mockCtx() }));

import { ALERT_SAFETY_MS, resetSetupPromptForTests, setupPrompt, useUpdateSitePrompt, NOT_NOW, UPDATE_SITE } from '@/lib/setupPrompt';
import * as store from '@/lib/siteStore';
import { resetEntitlementsForTests, setEntitlementsFromStatus, getEntitlements } from '@/lib/entitlements';
import type { SiteRecord } from '@/lib/siteStore';

const OWN = 'https://booksy.com/en-us/123_fade-lab';
const SQUARE = 'https://squareup.com/appointments/book/fade';
const AI = '/book';
const OLD_AI = 'https://www.aibarber.org/book/fade-lab';
const SHOP = '/shop';
const OLD_SHOP = 'https://www.aibarber.org/shop/fade-lab';
const L = (bookingUrl: string | null, shopUrl: string | null = null) => ({ bookingUrl, shopUrl });
const ON = { known: true, hosting: true };

describe('setupPrompt: when it shows', () => {
  const cases: [string, Parameters<typeof setupPrompt>[0], { title: string; message?: string } | null][] = [
    ['not published yet', { published: false, ents: ON, live: L(null), next: L(AI) }, null],
    ['entitlements unknown', { published: true, ents: { known: false, hosting: false }, live: L(null), next: L(AI) }, null],
    ['lapsed (hosting off)', { published: true, ents: { known: true, hosting: false }, live: L(null), next: L(AI) }, null],
    ['what is live is unknown', { published: true, ents: ON, live: null, next: L(AI) }, null],
    ['AI booking turned on over the own link', { published: true, ents: ON, live: L(OWN), next: L(AI) }, { title: 'Add the Book button to your website?' }],
    ['AI booking turned on, no Book button yet', { published: true, ents: ON, live: L(null), next: L(AI) }, { title: 'Add the Book button to your website?' }],
    ['old aibarber.org Book link live, /book next: the same button, no prompt', { published: true, ents: ON, live: L(OLD_AI), next: L(AI) }, null],
    ['old aibarber.org Shop link live, /shop next: the same button, no prompt', { published: true, ents: ON, live: L(OLD_AI, OLD_SHOP), next: L(AI, SHOP) }, null],
    ['old Book link live, bookings off with an own link: back to own', { published: true, ents: ON, live: L(OLD_AI), next: L(OWN) }, { title: 'Point your Book button back to your own booking link?', message: 'Bookings are off, so your Book buttons use your booking link for now.' }],
    ['old Shop link live, shop closed', { published: true, ents: ON, live: L(OWN, OLD_SHOP), next: L(OWN) }, { title: 'Remove the Shop button from your website?' }],
    ['AI Book button already live', { published: true, ents: ON, live: L(AI), next: L(AI) }, null],
    ['own link chosen and live', { published: true, ents: ON, live: L(OWN), next: L(OWN) }, null],
    ['own link edited (not a setup change)', { published: true, ents: ON, live: L(OWN), next: L(SQUARE) }, null],
    ['shop opened', { published: true, ents: ON, live: L(OWN), next: L(OWN, SHOP) }, { title: 'Add the Shop button to your website?' }],
    ['both turned on', { published: true, ents: ON, live: L(OWN), next: L(AI, SHOP) }, { title: 'Add the Book and Shop buttons to your website?' }],
    ['store switched off, never live', { published: true, ents: ON, live: L(OWN), next: L(OWN) }, null],
    ['shop closed while live', { published: true, ents: ON, live: L(OWN, SHOP), next: L(OWN) }, { title: 'Remove the Shop button from your website?' }],
    ['bookings off, no own link', { published: true, ents: ON, live: L(AI), next: L(null) }, { title: 'Remove the Book button from your website?', message: 'Bookings are off, so your Book buttons are hidden for now.' }],
    ['bookings and shop both off', { published: true, ents: ON, live: L(AI, SHOP), next: L(null) }, { title: 'Remove the Book and Shop buttons from your website?', message: 'Bookings are off, so your Book buttons are hidden for now.' }],
    ['bookings off with an own link', { published: true, ents: ON, live: L(AI), next: L(OWN) }, { title: 'Point your Book button back to your own booking link?', message: 'Bookings are off, so your Book buttons use your booking link for now.' }],
    ['bookings on, shop closed', { published: true, ents: ON, live: L(OWN, SHOP), next: L(AI) }, { title: 'Add the Book button to your website?', message: 'Remove the Shop button from your website?' }],
  ];
  it.each(cases)('%s', (_n, input, want) => {
    expect(setupPrompt(input)).toEqual(want);
  });
});

describe('useUpdateSitePrompt', () => {
  let api: ReturnType<typeof useUpdateSitePrompt>;
  function Probe() {
    api = useUpdateSitePrompt('bookings');
    return null;
  }
  const site = (over: Partial<SiteRecord> = {}): SiteRecord => ({
    draftId: 'd1',
    inputs: { shopName: 'Fade Lab', area: 'Brooklyn', phone: '555', ownBookingUrl: OWN, bookingChoice: 'aibarber' },
    data: { shopName: 'Fade Lab', area: 'Brooklyn', phone: '555', bookingUrl: AI, hero: {}, about: {}, services: [], gallery: [] } as any,
    updatedAt: 2, slug: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', transactionId: 'tx-1',
    liveLinks: { bookingUrl: OWN, shopUrl: null },
    ...over,
  });
  const ctx = (bookingsEnabled = true) => ({
    ents: getEntitlements(), shop: { slug: 'fade-lab', bookingsEnabled, purchaseLinked: true }, storeEnabled: false,
  });

  let alert: jest.SpyInstance;
  beforeEach(async () => {
    mockPush.mockClear();
    resetSetupPromptForTests();
    resetEntitlementsForTests();
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }] });
    mockCtx.mockReset().mockImplementation(async () => ctx());
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await store.clearSite();
  });
  afterEach(() => jest.restoreAllMocks());

  const press = (text: string) => {
    const buttons = alert.mock.calls.at(-1)[2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === text)?.onPress?.();
  };

  it('asks, and Update my site opens the publish flow once however many times it is tapped', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    let out: string | undefined;
    await act(async () => {
      out = await api.offer();
    });
    expect(out).toBe('prompted');
    expect(alert).toHaveBeenCalledWith('Add the Book button to your website?', undefined, [
      expect.objectContaining({ text: NOT_NOW, style: 'cancel' }),
      expect.objectContaining({ text: UPDATE_SITE }),
    ], expect.objectContaining({ cancelable: true }));
    press(UPDATE_SITE);
    press(UPDATE_SITE);
    api.update();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/publishing');
    // The next setup change asks again, and its Update works.
    await act(async () => {
      await api.offer();
    });
    press(UPDATE_SITE);
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('Not now does nothing', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    await act(async () => {
      await api.offer();
    });
    press(NOT_NOW);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('not published yet: no prompt (the caller keeps its "Publish to add…" note)', async () => {
    await store.saveSite(site({ deployedUrl: null, slug: null, liveLinks: undefined }));
    await render(<Probe />);
    let out: string | undefined;
    await act(async () => {
      out = await api.offer();
    });
    expect(out).toBe('unpublished');
    expect(alert).not.toHaveBeenCalled();
  });

  it('the shop lookup failing: nothing is asked (no guessing)', async () => {
    await store.saveSite(site());
    mockCtx.mockImplementation(async () => null);
    await render(<Probe />);
    let out: string | undefined;
    await act(async () => {
      out = await api.offer();
    });
    expect(out).toBe('no-change');
    expect(alert).not.toHaveBeenCalled();
  });

  it('bookings switched off while the AI Book button is live: offers to point it back to the own link', async () => {
    await store.saveSite(site({ liveLinks: { bookingUrl: AI, shopUrl: null } }));
    mockCtx.mockImplementation(async () => ctx(false));
    await render(<Probe />);
    await act(async () => {
      await api.offer();
    });
    expect(alert.mock.calls[0][0]).toBe('Point your Book button back to your own booking link?');
  });

  it('a site published before live links were tracked: reads them from the server copy', async () => {
    await store.saveSite(site({ liveLinks: undefined }));
    require('@/lib/supabase').sb.setSession({ access_token: 'tok-u1', user: { id: 'u1' } }); // /api/ios/site needs the account
    (global as any).fetch = jest.fn(async () => ({
      status: 200, ok: true,
      text: async () => JSON.stringify({ siteId: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', active: true, siteData: { shopName: 'Fade Lab', bookingUrl: AI } }),
    }));
    await render(<Probe />);
    let out: string | undefined;
    await act(async () => {
      out = await api.offer();
    });
    expect(out).toBe('no-change'); // the AI Book button is already live
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
  });

  it('rapid toggles: the folded re-check asks about the LATEST state, once', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    // Toggle 1: bookings on (the AI Book button would be added). Its shop lookup is slow.
    let release!: (v: unknown) => void;
    mockCtx.mockImplementationOnce(() => new Promise((r) => (release = r)));
    let first!: Promise<string>;
    await act(async () => {
      first = api.offer();
      await new Promise((r) => setTimeout(r, 0));
    });
    // Toggles 2 and 3 while it runs: bookings back off, and the live site already shows the AI button.
    await store.saveSite(site({ liveLinks: { bookingUrl: AI, shopUrl: null } }));
    mockCtx.mockImplementation(async () => ctx(false));
    await act(async () => {
      void api.offer();
      void api.offer();
      release(ctx(true));
      await first;
    });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('Point your Book button back to your own booking link?');
  });

  it('a check while an alert is up asks nothing, across screens; Update opens /publishing once', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    await act(async () => {
      await api.offer();
    });
    let other!: ReturnType<typeof useUpdateSitePrompt>;
    function Other() {
      other = useUpdateSitePrompt('store');
      return null;
    }
    await render(<Other />);
    await act(async () => {
      expect(await other.offer()).toBe('no-change');
    });
    expect(alert).toHaveBeenCalledTimes(1);
    press(UPDATE_SITE);
    other.update();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('an alert dismissed without a button (onDismiss) re-arms the queue', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    await act(async () => {
      await api.offer();
    });
    const opts = alert.mock.calls[0][3];
    expect(opts).toMatchObject({ cancelable: true });
    opts.onDismiss();
    await act(async () => {
      await api.offer();
    });
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it('an alert that is never answered (never shown) stops blocking after the safety timeout', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    await act(async () => {
      await api.offer();
    });
    await act(async () => {
      expect(await api.offer()).toBe('no-change');
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ALERT_SAFETY_MS + 1);
    });
    await act(async () => {
      expect(await api.offer()).toBe('prompted');
    });
    expect(alert).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('a check started right after another finished runs fresh (no lost offer)', async () => {
    await store.saveSite(site({ liveLinks: { bookingUrl: AI, shopUrl: null } })); // nothing to ask
    await render(<Probe />);
    let out1: string | undefined;
    await act(async () => {
      out1 = await api.offer().then(async (r) => {
        // Same tick the first check ended: the state changes and another toggle checks.
        await store.saveSite(site());
        return r;
      });
    });
    expect(out1).toBe('no-change');
    await act(async () => {
      expect(await api.offer()).toBe('prompted');
    });
  });

  it('after Not now, the next change can ask again', async () => {
    await store.saveSite(site());
    await render(<Probe />);
    await act(async () => {
      await api.offer();
    });
    press(NOT_NOW);
    await act(async () => {
      await api.offer();
    });
    expect(alert).toHaveBeenCalledTimes(2);
  });
});
