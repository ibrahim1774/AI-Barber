// REAL planIntent, REAL snapshot validation and REAL render; only storage and deploy are absent. The native account publish (links and team from the
// server) gives the same pages as the browser path when links and team are unchanged, and a removed team member has no card after a native publish.
import { describe, expect, it } from 'vitest';
import { planIntent, type Draft } from '../../lib/webApp/reliability.js';
import { validateWebSnapshot } from '../../lib/webApp/publishFlow.js';
import { renderPendingBundle } from '../../lib/publishSite.js';
import { nativePublication, refreshStaffFromMembers, type MemberFact, type NativeFactsDeps } from '../../lib/account/nativePublish.js';

const UID = '3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f';
const services = [{ id: 's1', name: 'Fade' }, { id: 's2', name: 'Beard' }];
const mike: MemberFact = { id: 'm1', display_name: 'Mike Rivera', photo_url: 'https://img.example/mike.jpg', bio: 'Fades since 2009.', active: true, title: 'Master barber', booking_url: null, serviceIds: null, weeks: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, start_min: 540, end_min: 1020 })) };
const sam: MemberFact = { ...mike, id: 'm2', display_name: 'Samuel Okafor', photo_url: 'https://img.example/sam.jpg', bio: 'Beard specialist.' };

// Staff entries exactly as the app would have saved them after a refresh, so a server refresh changes nothing.
const settled = refreshStaffFromMembers([{ name: 'x', memberId: 'm1' }, { name: 'y', memberId: 'm2' }], [mike, sam], services, true)!;

const base = () => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555-0100',
  hero: { heading: 'H', tagline: 'T', imageUrl: 'https://img.example/hero.jpg' }, about: { heading: 'A', description: ['d'], imageUrl: '' },
  services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [],
  contact: { address: '1 Main St', email: 'a@b.co' },
  bookingUrl: '/book', shopUrl: '/shop', staff: settled,
});
const draftRow = (): Draft => ({ user_id: UID, environment: 'test', draft_id: 'd1', revision: 3, site_data: { ...base(), source: 'web-app' }, deployed_url: null, suspended: false } as any);

const deps = (members: MemberFact[], over: Partial<NativeFactsDeps> = {}): NativeFactsDeps => ({
  plan: async () => ({ hosting: true, bookings: true, store: true }), shop: async () => ({ id: 'shop1', bookingsEnabled: true, storeEnabled: true }),
  profileLive: async () => true, members: async () => members, services: async () => services, ...over,
});
const render = (snapshot: any) => {
  const { pendingData, imageUrlMap } = validateWebSnapshot(snapshot);
  return renderPendingBundle({ siteData: JSON.parse(JSON.stringify(pendingData)), imageUrlMap });
};
// the render stamps a published-at time; everything else must match
const pagesOf = (r: ReturnType<typeof render>) => JSON.stringify(r.pages).replace(/name=\\"published-at\\" content=\\"\d+\\"/g, 'published-at');

describe('native account publish renders like the browser path', () => {
  it('identical pages when links and team are unchanged', async () => {
    const d = draftRow();
    const browser = await planIntent(UID, 'd1', 3, 'publish', null, d.site_data, false, d); // the browser sends the draft's own links and team
    const native = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, {}, deps([mike, sam])), false, d);
    expect(JSON.stringify(native.snapshot)).toBe(JSON.stringify(browser.snapshot));
    expect(pagesOf(render(native.snapshot))).toBe(pagesOf(render(browser.snapshot)));
    expect(pagesOf(render(native.snapshot))).toContain('Mike Rivera');
  });
  it('a removed or inactive team member has no card after a native publish, while the browser path would still print it', async () => {
    const d = draftRow();
    const native = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, {}, deps([mike, { ...sam, active: false }])), false, d);
    const browser = await planIntent(UID, 'd1', 3, 'publish', null, d.site_data, false, d);
    expect(pagesOf(render(native.snapshot))).not.toContain('Samuel Okafor');
    expect(pagesOf(render(native.snapshot))).toContain('Mike Rivera');
    expect(pagesOf(render(browser.snapshot))).toContain('Samuel Okafor');
  });
  it('store switched off: the published page has no Shop button; with it on it has one', async () => {
    const d = draftRow();
    const off = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, {}, deps([mike, sam], { shop: async () => ({ id: 'shop1', bookingsEnabled: true, storeEnabled: false }) })), false, d);
    const on = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, {}, deps([mike, sam])), false, d);
    expect((off.snapshot as any).shopUrl).toBeUndefined();
    expect((on.snapshot as any).shopUrl).toBe('/shop');
    expect(pagesOf(render(off.snapshot))).not.toBe(pagesOf(render(on.snapshot)));
  });
  it('own-link fallback when bookings lapse; built-in /book with live bookings; no shop leaves the team untouched', async () => {
    const d = draftRow();
    const OWN = 'https://booksy.com/fade-lab';
    const lapsed = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, { bookingChoice: 'aibarber', ownBookingUrl: OWN }, deps([mike, sam], { plan: async () => ({ hosting: true, bookings: false, store: false }) })), false, d);
    expect((lapsed.snapshot as any).bookingUrl).toBe(OWN);
    const live = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, { bookingChoice: 'aibarber', ownBookingUrl: OWN }, deps([mike, sam])), false, d);
    expect((live.snapshot as any).bookingUrl).toBe('/book');
    const noShop = await planIntent(UID, 'd1', 3, 'publish', null, await nativePublication(UID, d.site_data, {}, deps([], { shop: async () => null })), false, d);
    expect((noShop.snapshot as any).staff.map((s: any) => s.name)).toEqual(settled.map((s) => s.name));
  });
});
