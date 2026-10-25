import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { SITE_BOOK_PATH, SITE_SHOP_PATH } from '@/web/lib/render/subpages';
import { eligiblePages } from '@/web/lib/render/pages';
import { manualSite, toShopSite } from '@/lib/importer';
import { bookTargetStatus, bookingPrefs, linksToSend, resolveLinks, type LinkContext } from '@/lib/bookingChoice';
import { switchBookButton } from '@/lib/setup/bookingSwitch';
import type { Entitlements } from '@/lib/entitlements';

const booksy = require('./fixtures/scrape-booksy.json');

const INPUT = { shopName: 'Fade Lab', area: 'Austin, TX', address: '512 Congress Ave, Austin, TX', phone: '(512) 555-0142', colorTheme: DEFAULT_SWATCH };
const rec = async () => { const r = await manualSite(INPUT); return { inputs: r.inputs, data: r.site }; };
const ents = (o: Partial<Entitlements>): Entitlements => ({ known: true, hosting: true, bookings: false, store: false, ...o } as Entitlements);
const ctx = (e: Partial<Entitlements>, shop: Partial<NonNullable<LinkContext['shop']>> | null = { slug: 's', purchaseLinked: true, bookingsEnabled: true }, storeEnabled = true): LinkContext => ({
  ents: ents(e), shop: shop ? ({ slug: 's', purchaseLinked: true, ...shop } as LinkContext['shop']) : null, storeEnabled,
});

describe('Book and Shop buttons on a scratch site', () => {
  it('defaults to the built-in scheduler with no own link', async () => {
    expect(bookingPrefs(await rec())).toEqual({ own: null, choice: 'aibarber' });
  });

  it('Bookings plan + bookings on + linked: Book goes to /book and a Book page exists', async () => {
    const { inputs, data } = await rec();
    const out = resolveLinks(data, inputs, ctx({ bookings: true }, undefined, false));
    expect(out.bookingUrl).toBe(SITE_BOOK_PATH);
    expect(out.shopUrl).toBeUndefined();
    expect(eligiblePages(out)).toContain('book');
  });

  it('Store plan + open linked shop: Shop goes to /shop; both plans give both', async () => {
    const { inputs, data } = await rec();
    const store = resolveLinks(data, inputs, ctx({ store: true }));
    expect(store.shopUrl).toBe(SITE_SHOP_PATH);
    expect(store.bookingUrl).toBeUndefined();
    const both = resolveLinks(data, inputs, ctx({ store: true, bookings: true }));
    expect([both.bookingUrl, both.shopUrl]).toEqual([SITE_BOOK_PATH, SITE_SHOP_PATH]);
    expect(eligiblePages(both)).toEqual(expect.arrayContaining(['book', 'shop']));
  });

  it('no plan: no Book or Shop button, and the status says no-plan with nothing to fall back to', async () => {
    const { inputs, data } = await rec();
    const c = ctx({});
    const out = resolveLinks(data, inputs, c);
    expect(out.bookingUrl).toBeUndefined();
    expect(out.shopUrl).toBeUndefined();
    expect(linksToSend(data, inputs, c).bookingUrl).toBeUndefined();
    expect(bookTargetStatus(c, null)).toEqual({ status: 'no-plan', fallback: 'none' });
  });

  it('bookings switched off keeps the scheduler out: no /book without the switch', async () => {
    const { inputs, data } = await rec();
    expect(resolveLinks(data, inputs, ctx({ bookings: true }, { bookingsEnabled: false })).bookingUrl).toBeUndefined();
    expect(resolveLinks(data, inputs, ctx({ bookings: true }, { bookingsEnabled: true, purchaseLinked: false })).bookingUrl).toBeUndefined();
  });

  it('the Bookings setup switch sets /book on a scratch site', async () => {
    expect(switchBookButton((await rec()).data).bookingUrl).toBe(SITE_BOOK_PATH);
  });

  it('an imported record keeps the barber\'s own link when chosen, by the same rule', () => {
    const r = toShopSite({ ...booksy, bookingUrl: 'https://booksy.com/en-us/x' }, '', 'booking');
    const own = r.site.bookingUrl;
    expect(own).toBeTruthy();
    const inputs = { ...r.inputs, ownBookingUrl: own, bookingChoice: 'own' as const };
    expect(resolveLinks(r.site, inputs, ctx({ bookings: true })).bookingUrl).toBe(own);
    expect(resolveLinks(r.site, { ...inputs, bookingChoice: 'aibarber' }, ctx({ bookings: true })).bookingUrl).toBe(SITE_BOOK_PATH);
  });
});
