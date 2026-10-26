/**
 * Booking and shop as pages of the barber's own site (AI-Barber 989d7fb): the site's Book / Shop buttons
 * are the relative /book and /shop; old aibarber.org links are the same button; customers are sent to the
 * barber's own address (+ /book, /shop) once the site has the pages; the editor preview shows the homepage
 * "Book online" strip and the Shop section like the published page.
 */
import React from 'react';
import { act, allText, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return { Sheet: ({ visible, children }: any) => (visible ? R.createElement(R.Fragment, null, children) : null) };
});
jest.mock('@/components/QrScreen', () => ({ QrScreen: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const mockShop = jest.fn();
jest.mock('@/lib/shop', () => ({ ...jest.requireActual('@/lib/shop'), loadMyShop: () => mockShop() }));
jest.mock('@/lib/store/data', () => ({ ...jest.requireActual('@/lib/store/data'), loadStoreSettings: async () => ({ storeEnabled: true }) }));

import { generateContent } from '@/web/services/geminiService';
import { SHOP_PREVIEW_SCRIPT } from '@/web/lib/render/subpages';
import type { WebsiteData } from '@/web/types';
import { ShareSheet } from '@/components/ShareSheet';
import { canonicalLinks, resolveLinks, withChoice, type LinkContext } from '@/lib/bookingChoice';
import {
  customerBookingUrl, resetPagesChecksForTests, resolveCustomerLinks, sitePagesLive, useCustomerLinks, verifiedSiteBase,
} from '@/lib/customerLinks';
import { emitSiteLive } from '@/lib/siteEvents';
import { SHOP_PREVIEW_EDITOR_NOTE, SHOP_PREVIEW_PLACEHOLDER, buildPreviewHtml, stripMarkers, withShopPreview } from '@/lib/editable';
import { resetEntitlementsForTests, setEntitlementsFromStatus, getEntitlements } from '@/lib/entitlements';
import { setSharedPlan } from '@/lib/plan';
import { OWN_PLAN } from '../../test/ownPlan';
import { renderSite, forRender } from '@/lib/render';
import { isAiBarberBookingUrl, isAiBarberShopUrl, toShop } from '@/lib/shop';
import { stripLapsedLinks } from '@/lib/tierLinks';
import * as store from '@/lib/siteStore';

const OLD_BOOK = 'https://www.aibarber.org/book/fade-lab';
const OLD_SHOP = 'https://www.aibarber.org/shop/fade-lab';
const BASE = 'https://jacksbarbershop.com';

describe('link forms', () => {
  it('the site pages and the old aibarber.org links are AI Barber links; a barber\'s own link is not', () => {
    for (const u of ['/book', '/book?x=1', '/book#t', OLD_BOOK, 'aibarber.org/book/x']) expect(isAiBarberBookingUrl(u)).toBe(true);
    for (const u of ['/books', '/book/x', '//book', 'https://booksy.com/book', 'https://jacksbarbershop.com/book']) expect(isAiBarberBookingUrl(u)).toBe(false);
    for (const u of ['/shop', OLD_SHOP]) expect(isAiBarberShopUrl(u)).toBe(true);
    for (const u of ['/shops', 'https://myshop.com/shop']) expect(isAiBarberShopUrl(u)).toBe(false);
  });

  it('canonicalLinks: old and new forms are the same button', () => {
    expect(canonicalLinks({ bookingUrl: OLD_BOOK, shopUrl: OLD_SHOP })).toEqual({ bookingUrl: '/book', shopUrl: '/shop' });
    expect(canonicalLinks({ bookingUrl: 'https://booksy.com/x', shopUrl: null })).toEqual({ bookingUrl: 'https://booksy.com/x', shopUrl: null });
  });

  it('publish resolution sends /book and /shop; a downgrade strips /book (or the old form) back to the own link', () => {
    resetEntitlementsForTests();
    setSharedPlan({ ...OWN_PLAN }); // this account owns the purchase
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] });
    const ctx: LinkContext = { ents: getEntitlements(), shop: { slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true }, storeEnabled: true };
    const data = { shopName: 'Fade', bookingUrl: '/book' } as WebsiteData;
    const inputs = { ownBookingUrl: 'https://booksy.com/x', bookingChoice: 'aibarber' as const } as any;
    expect(resolveLinks(data, inputs, ctx)).toMatchObject({ bookingUrl: '/book', shopUrl: '/shop' });
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }] });
    expect(stripLapsedLinks({ bookingUrl: '/book', shopUrl: '/shop' } as any, getEntitlements(), 'https://booksy.com/x'))
      .toEqual({ bookingUrl: 'https://booksy.com/x' });
    expect(stripLapsedLinks({ bookingUrl: OLD_BOOK } as any, getEntitlements())).toEqual({});
  });

  it('choosing AI Barber in setup puts /book on the site', () => {
    const rec: any = { inputs: { ownBookingUrl: 'https://booksy.com/x' }, data: { bookingUrl: 'https://booksy.com/x' } };
    expect(withChoice(rec, 'aibarber', { slug: 'fade-lab' }).data.bookingUrl).toBe('/book');
  });
});

describe('customer links (share, QR, copy)', () => {
  const shop = (siteBaseUrl: string | null) => ({ slug: 'fade-lab', siteBaseUrl });
  const LIVE_SITE = { deployedUrl: 'https://fade-lab.vercel.app/', liveLinks: { bookingUrl: '/book', shopUrl: null } };
  let fetched: string[];
  const serve = (status: number, body: unknown) => {
    fetched = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      fetched.push(url);
      return { status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
    });
  };
  beforeEach(() => resetPagesChecksForTests());

  it('the server\'s stored base wins: never aibarber.org, no check needed', async () => {
    serve(500, {});
    expect(await resolveCustomerLinks(shop(BASE), LIVE_SITE)).toEqual({ booking: `${BASE}/book`, shop: `${BASE}/shop` });
    expect(customerBookingUrl(shop(BASE))).toBe(`${BASE}/book`);
    expect(fetched).toEqual([]);
  });

  it('no stored base: the live address only when its /ab-site.json confirms the pages', async () => {
    serve(200, { slug: 'fade-lab' });
    expect(await resolveCustomerLinks(shop(null), LIVE_SITE)).toEqual({
      booking: 'https://fade-lab.vercel.app/book', shop: 'https://fade-lab.vercel.app/shop',
    });
    expect(fetched).toEqual(['https://fade-lab.vercel.app/ab-site.json']);
  });

  // Review F1: the app recorded /book (what it sent), but the server found no shop and shipped no pages.
  it.each([
    ['404 (no pages shipped)', 404, 'Not found'],
    ['200 HTML (not the config)', 200, '<html></html>'],
    ['200 without a slug', 200, {}],
  ])('no stored base and the check fails (%s): the aibarber.org page, never a 404 link', async (_n, status, body) => {
    serve(status as number, body);
    expect(await resolveCustomerLinks(shop(null), LIVE_SITE)).toEqual({ booking: OLD_BOOK, shop: OLD_SHOP });
  });

  it('offline or hanging: aibarber.org (3 s cap)', async () => {
    (global as any).fetch = jest.fn(() => Promise.reject(new TypeError('offline')));
    expect(await resolveCustomerLinks(shop(null), LIVE_SITE)).toEqual({ booking: OLD_BOOK, shop: OLD_SHOP });
    resetPagesChecksForTests();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    (global as any).fetch = jest.fn((_u: string, init: any) => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))));
    const p = resolveCustomerLinks(shop(null), LIVE_SITE);
    await jest.advanceTimersByTimeAsync(3_100);
    expect(await p).toEqual({ booking: OLD_BOOK, shop: OLD_SHOP });
    jest.useRealTimers();
  });

  it('a confirmed check is cached for the session; a failed one is retried after a minute', async () => {
    serve(404, 'x');
    const t0 = Date.now();
    expect(await sitePagesLive('https://a.vercel.app', t0)).toBe(false);
    expect(await sitePagesLive('https://a.vercel.app', t0 + 10_000)).toBe(false);
    expect(fetched).toHaveLength(1);
    serve(200, { slug: 'a' });
    expect(await sitePagesLive('https://a.vercel.app', t0 + 61_000)).toBe(true);
    expect(await sitePagesLive('https://a.vercel.app', t0 + 10 * 60_000)).toBe(true);
    expect(fetched).toHaveLength(1);
  });

  it('a site without the pages in its last publish (old links, own link, unpublished) is never checked', async () => {
    serve(200, { slug: 'fade-lab' });
    for (const site of [
      { deployedUrl: 'https://fade-lab.vercel.app', liveLinks: { bookingUrl: OLD_BOOK, shopUrl: null } },
      { deployedUrl: 'https://fade-lab.vercel.app', liveLinks: { bookingUrl: 'https://booksy.com/x', shopUrl: null } },
      { deployedUrl: null, liveLinks: undefined },
    ]) {
      expect(await resolveCustomerLinks(shop(null), site as any)).toEqual({ booking: OLD_BOOK, shop: OLD_SHOP });
    }
    expect(fetched).toEqual([]);
    expect(await verifiedSiteBase(null, null)).toBeNull();
  });

  it('useCustomerLinks: the no-network answer first, then the verified one; re-resolved after a publish', async () => {
    serve(404, 'x');
    await store.saveSite({ draftId: 'd', inputs: {} as any, data: {} as any, updatedAt: 1, slug: 'fade-lab', ...LIVE_SITE, transactionId: 'tx' });
    let got: any;
    function Probe() {
      got = useCustomerLinks(shop(null));
      return null;
    }
    await render(<Probe />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(got).toEqual({ booking: OLD_BOOK, shop: OLD_SHOP });
    // The pages ship with the next publish: the screen updates without a remount.
    resetPagesChecksForTests();
    serve(200, { slug: 'fade-lab' });
    await act(async () => {
      emitSiteLive((await store.loadSite())!);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(got.booking).toBe('https://fade-lab.vercel.app/book');
  });

  it('toShop reads site_base_url only as an https origin', () => {
    expect(toShop({ id: 's', site_base_url: 'https://jacksbarbershop.com/' }).siteBaseUrl).toBe(BASE);
    expect(toShop({ id: 's', site_base_url: 'http://x.com' }).siteBaseUrl).toBeNull();
    expect(toShop({ id: 's', site_base_url: 'https://x.com/path' }).siteBaseUrl).toBeNull();
    expect(toShop({ id: 's' }).siteBaseUrl).toBeNull();
  });

  it('the Share sheet offers the barber-domain booking and shop links', async () => {
    resetPagesChecksForTests();
    mockShop.mockResolvedValue({ id: 's1', slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true, siteBaseUrl: BASE });
    resetEntitlementsForTests();
    setSharedPlan({ ...OWN_PLAN }); // this account owns the purchase
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] });
    const tree = await render(<ShareSheet visible shopName="Fade Lab" links={[{ kind: 'website', url: BASE }]} source="live" onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const text = allText(tree).join(' | ');
    expect(text).toContain('jacksbarbershop.com/book');
    expect(text).toContain('jacksbarbershop.com/shop');
    expect(text).not.toContain('aibarber.org');
  });

  it("a second account on the same Apple ID gets no booking or shop row in the Share sheet", async () => {
    resetPagesChecksForTests();
    mockShop.mockResolvedValue({ id: 's1', slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true, siteBaseUrl: BASE });
    resetEntitlementsForTests();
    setSharedPlan({ ...OWN_PLAN, purchaseAccount: 'other', purchaseHint: null });
    setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] });
    const tree = await render(<ShareSheet visible shopName="Fade Lab" links={[{ kind: 'website', url: BASE }]} source="live" onClose={() => {}} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const text = allText(tree).join(' | ');
    expect(text).not.toContain('/book');
    expect(text).not.toContain('/shop');
  });
});

describe('editor preview: the homepage sections like the published page', () => {
  let base: WebsiteData;
  beforeAll(async () => {
    base = await generateContent({ shopName: 'Fade Lab', area: 'Brooklyn', phone: '555', services: [{ title: 'Haircut', price: '$30' }, { title: 'Beard trim' }] });
  });

  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: "Book online" with the services and a Book button to /book, in preview and published', (t) => {
    const d = { ...base, template: t, bookingUrl: '/book' };
    const preview = stripMarkers(buildPreviewHtml(d, true));
    const published = renderSite(forRender(d));
    for (const html of [preview, published]) {
      expect(html).toContain('id="book-online"');
      expect(html).toContain('Book online');
      expect(html).toContain('href="/book"');
    }
    expect(preview).toContain('Haircut');
  });

  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: an old aibarber.org Book link shows no strip in either (the server converts it on republish)', (t) => {
    const d = { ...base, template: t, bookingUrl: OLD_BOOK };
    expect(buildPreviewHtml(d, true)).not.toContain('id="book-online"');
    expect(renderSite(forRender(d))).not.toContain('id="book-online"');
  });

  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: the Shop section shows the app\'s products (no fetch script) with an editor-only note', (t) => {
    const d = { ...base, template: t, shopUrl: '/shop' } as WebsiteData;
    expect(renderSite(forRender(d))).toContain('id="shop-preview"'); // published: hidden until its script loads products
    const html = buildPreviewHtml(d, true, [
      { name: 'Beard oil', priceCents: 1200, photo: 'https://cdn.example/p.jpg' },
      { name: 'Pomade <b>', priceCents: 950 },
    ]);
    expect(html).toMatch(/<section id="shop-preview"[^>]*>/);
    expect(html).not.toMatch(/<section id="shop-preview"[^>]*hidden/);
    expect(html).toContain('<span class="ab-sp-name">Beard oil</span><span class="ab-sp-price">$12</span>');
    expect(html).toContain('Pomade &lt;b&gt;');
    expect(html).toContain('$9.50');
    expect(html).toContain(SHOP_PREVIEW_EDITOR_NOTE);
    expect(html).not.toContain(SHOP_PREVIEW_SCRIPT);
  });

  it('no products yet: one placeholder card; no Shop link on the site: nothing added', () => {
    const d = { ...base, template: 'luxe', shopUrl: '/shop' } as WebsiteData;
    expect(buildPreviewHtml(d, true, [])).toContain(SHOP_PREVIEW_PLACEHOLDER);
    expect(buildPreviewHtml(d, true, null)).toContain(SHOP_PREVIEW_PLACEHOLDER);
    const html = '<html><body><p>hi</p></body></html>';
    expect(withShopPreview(html, [{ name: 'x', priceCents: 1 }])).toBe(html);
  });

  it('at most 4 products, like the published script', () => {
    const d = { ...base, template: 'luxe', shopUrl: '/shop' } as WebsiteData;
    const html = buildPreviewHtml(d, true, Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, priceCents: 100 })));
    expect((html.match(/class="ab-sp-card"/g) ?? []).length).toBe(4);
  });
});

afterAll(async () => {
  await store.clearSite();
});
