// The public booking and store endpoints, for a shop whose site has the /book and /shop pages.
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAppointment, getManage, getShop } from '../lib/bookings/publicFlow.js';
import { createOrder, getOrder, getStoreShop } from '../lib/store/publicFlow.js';
import { world } from './bookings/fakeRepo.js';
import { storeWorld } from './store/fakeRepo.js';
import { publicSiteView } from '../lib/customerUrls.js';

const SITE = 'https://freshcuts.com';
const LOOK = { template: 'prime', accent: '#d4a64a', bg: '#0a0a0a', text: '#f0ece4', heroUrl: 'https://img.test/h.jpg' };
const T10 = '2026-11-03T15:00:00.000Z';
const customer = { name: 'Sam Lee', phone: '(555) 123-4567', email: 'sam@example.com' };

describe('publicSiteView', () => {
  it('is the base and a cleaned look, or nulls', () => {
    expect(publicSiteView({ site_base_url: SITE, site_look: LOOK })).toEqual({ baseUrl: SITE, look: LOOK });
    expect(publicSiteView({})).toEqual({ baseUrl: null, look: null });
    expect(publicSiteView({ site_base_url: 'http://x.com', site_look: 'nope' as any })).toEqual({ baseUrl: null, look: null });
    expect(publicSiteView({ site_look: { template: 'evil', accent: 'red;}', bg: '#000', text: '#fff', heroUrl: 'javascript:x' } })).toEqual({
      baseUrl: null, look: { template: 'luxe', accent: null, bg: '#000000', text: '#ffffff', heroUrl: null },
    });
  });
});

describe('bookings with a site', () => {
  it('GET shop and GET manage carry the site; the booking\'s manage link is on the site', async () => {
    const w = world({ shop: { site_base_url: SITE, site_look: LOOK } as any });
    const s = await getShop({ slug: 'fresh-cuts' }, w.deps);
    expect((s.body as any).site).toEqual({ baseUrl: SITE, look: LOOK });
    const r = await createAppointment({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start: T10, customer, pay: 'shop' }, w.deps);
    expect(r.status).toBe(201);
    const token = w.state.appointments[0].manage_token;
    expect((r.body as any).appointment.manageUrl).toBe(`${SITE}/book/manage/${token}`);
    const m = await getManage({ token }, w.deps);
    expect((m.body as any).site).toEqual({ baseUrl: SITE, look: LOOK });
  });

  it('without a site: aibarber.org links and no site field', async () => {
    const w = world();
    expect('site' in ((await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any)).toBe(false);
    const r = await createAppointment({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start: T10, customer, pay: 'shop' }, w.deps);
    expect((r.body as any).appointment.manageUrl).toMatch(/^https:\/\/www\.aibarber\.org\/book\/manage\//);
  });
});

describe('store with a site', () => {
  it('GET shop and GET order carry the site; the order status link is on the site', async () => {
    const w = storeWorld({ shop: { site_base_url: SITE, site_look: LOOK } as any });
    expect(((await getStoreShop({ slug: 'fresh-cuts' }, w.deps)).body as any).site).toEqual({ baseUrl: SITE, look: LOOK });
    const r = await createOrder({
      slug: 'fresh-cuts', clientKey: randomUUID(), items: [{ productId: w.ids.oil, quantity: 2 }], customer,
      fulfilment: 'pickup', pay: 'manual', method: 'cashapp', expectedTotalCents: 3000,
    }, w.deps);
    expect(r.status).toBe(201);
    const statusUrl = (r.body as any).order.statusUrl as string;
    expect(statusUrl.startsWith(`${SITE}/shop/manage/`)).toBe(true);
    const token = decodeURIComponent(statusUrl.split('/').pop()!);
    expect(((await getOrder({ token }, w.deps)).body as any).site).toEqual({ baseUrl: SITE, look: LOOK });
  });
});
