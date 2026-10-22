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

import { setupPrompt, useUpdateSitePrompt, NOT_NOW, UPDATE_SITE } from '@/lib/setupPrompt';
import * as store from '@/lib/siteStore';
import { resetEntitlementsForTests, setEntitlementsFromStatus, getEntitlements } from '@/lib/entitlements';
import type { SiteRecord } from '@/lib/siteStore';

const OWN = 'https://booksy.com/en-us/123_fade-lab';
const SQUARE = 'https://squareup.com/appointments/book/fade';
const AI = 'https://www.aibarber.org/book/fade-lab';
const AI_OTHER = 'https://www.aibarber.org/book/fade-lab-2';
const SHOP = 'https://www.aibarber.org/shop/fade-lab';
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
    ['the booking page moved (new slug)', { published: true, ents: ON, live: L(AI_OTHER), next: L(AI) }, { title: 'Add the Book button to your website?' }],
    ['AI Book button already live', { published: true, ents: ON, live: L(AI), next: L(AI) }, null],
    ['own link chosen and live', { published: true, ents: ON, live: L(OWN), next: L(OWN) }, null],
    ['own link edited (not a setup change)', { published: true, ents: ON, live: L(OWN), next: L(SQUARE) }, null],
    ['shop opened', { published: true, ents: ON, live: L(OWN), next: L(OWN, SHOP) }, { title: 'Add the Shop button to your website?' }],
    ['both turned on', { published: true, ents: ON, live: L(OWN), next: L(AI, SHOP) }, { title: 'Add the Book and Shop buttons to your website?' }],
    ['store switched off, never live', { published: true, ents: ON, live: L(OWN), next: L(OWN) }, null],
    ['shop closed while live', { published: true, ents: ON, live: L(OWN, SHOP), next: L(OWN) }, { title: 'Remove the Shop button from your website?' }],
    ['bookings off, no own link', { published: true, ents: ON, live: L(AI), next: L(null) }, { title: 'Remove the Book button from your website?' }],
    ['bookings and shop both off', { published: true, ents: ON, live: L(AI, SHOP), next: L(null) }, { title: 'Remove the Book and Shop buttons from your website?' }],
    ['bookings off with an own link', { published: true, ents: ON, live: L(AI), next: L(OWN) }, { title: 'Point your Book button back to your own booking link?' }],
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
      { text: NOT_NOW, style: 'cancel' },
      expect.objectContaining({ text: UPDATE_SITE }),
    ]);
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
});
