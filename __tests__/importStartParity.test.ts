// The booking-link start behaves like Build from scratch / Find me on Google: scraped prices, durations and hours are kept
// (in the shapes the editor reads), what the page lacked falls back to the same defaults, and the Book button is as adjustable.
import { toShopSite } from '@/lib/importer';
import { SAMPLE_PRICES, migrateSamplePrices, samplePriceCents } from '@/lib/samplePrices';
import { defaultHours, editableHours, hoursSummary, withDefaultHours } from '@/lib/sections/hours';
import { seedWeek } from '@/lib/setup/availability';
import { buildPreviewHtml, needsAddButton } from '@/lib/editable';
import { MAIN_BOOK_KEY, routeTap } from '@/lib/ctaButtons';
import { applyButtonChange } from '@/lib/buttonChange';
import { bookingPrefs, syncOwnLink } from '@/lib/bookingChoice';
import type { SiteRecord } from '@/lib/siteStore';
import type { TemplateId } from '@/web/types';

const booksy = require('./fixtures/scrape-booksy.json');
const LINK = 'https://booksy.com/en-us/998736_asr-cuts_barber-shop_dallas';
const imp = (over: Record<string, unknown> = {}) => toShopSite({ ...booksy, bookingUrl: LINK, ...over }, '', 'booking');
const rec = (over: Record<string, unknown> = {}, template: TemplateId = 'luxe'): SiteRecord => {
  const r = imp(over);
  return { draftId: 'd', inputs: r.inputs as any, data: { ...r.site, template }, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null };
};

describe('prices and durations from the booking page', () => {
  const services = [
    { title: 'Skin fade', price: '35', duration: '45min', category: 'Haircuts' },
    { title: 'Beard', price: '$25 - $40', duration: 'PT30M' },
    { title: 'Lineup', price: '$15+', duration: '15' },
    { title: 'From price', price: 'from $30.00' },
    { title: 'Fade', price: '', duration: '' },
    { title: 'Hair color', price: 'Varies' },
  ];
  const out = () => imp({ services }).site.services!;
  test('every price the page had is kept in a display form', () => {
    expect(out().map((s) => s.price)).toEqual(['$35', '$25 - $40', '$15+', 'from $30', '', '']);
  });
  test('durations are mapped', () => expect(out().slice(0, 3).map((s) => s.duration)).toEqual(['45 min', '30 min', '15 min']));
  test('the migration fills only the blanks: the scraped price of "Fade" is kept, a blank "Fade" gets $35, an unknown name stays blank', () => {
    const r: any = migrateSamplePrices({ data: { services: out() }, inputs: { importedFrom: 'booking' } } as any);
    expect(r.data.services.map((s: any) => s.price)).toEqual(['$35', '$25 - $40', '$15+', 'from $30', '$35', '']);
    expect(r.inputs.samplePricesFilled).toBe(true);
  });
  test('nothing blank: no flag on an import', () => {
    const r: any = migrateSamplePrices({ data: { services: out().slice(0, 4) }, inputs: { importedFrom: 'booking' } } as any);
    expect(r.inputs.samplePricesFilled).toBeUndefined();
  });
  test('the Willi Barber fixture keeps its real prices untouched', () => {
    const r: any = migrateSamplePrices({ data: { services: imp().site.services }, inputs: { importedFrom: 'booking' } } as any);
    expect(r.data.services.map((s: any) => s.price)).toEqual(booksy.services.map((s: any) => s.price));
    expect(r.inputs.samplePricesFilled).toBeUndefined();
  });
});

describe('the extended sample-price list', () => {
  test.each([
    ['Kids haircut', 25], ["Kid's Haircut", 25], ['Boys cut', 25], ['Fade', 35], ['Line up', 15], ['Line-up', 15], ['Lineup', 15], ['Edge up', 15],
    ['Shave', 25], ['Hot towel shave', 30], ['Haircut & shave', 50], ['Haircut and Shave', 50], ['Haircut + shave', 50], ['Beard line up', 15],
    ['Eyebrows', 10], ['Senior cut', 25], ['Haircut', 30], ['Beard trim', 20], ['Haircut & beard', 45],
  ])('%s -> $%i', (name, dollars) => expect(samplePriceCents(name)).toBe(dollars * 100));
  test('unknown names have none, and the list is plain whole-dollar values in one place', () => {
    expect(samplePriceCents('Hair color')).toBeNull();
    for (const v of Object.values(SAMPLE_PRICES)) expect(Number.isInteger(v) && v > 0).toBe(true);
  });
  test('migration fills the new names once, never overwrites, and does not run twice', () => {
    const base = { data: { services: [{ title: 'Kids haircut' }, { title: 'Line up', price: '$12' }, { title: 'Hot towel shave', price: '' }] }, inputs: {} } as any;
    const first: any = migrateSamplePrices(base);
    expect(first.data.services.map((s: any) => s.price)).toEqual(['$25', '$12', '$30']);
    expect(migrateSamplePrices(first)).toBe(first);
  });
});

describe('hours from the booking page', () => {
  test('a clock-text provider (theCut / Setmore / Google) lands as HH:MM rows the Hours editor and bookings wizard read', () => {
    const r = imp({ hours: [
      { day: 'Monday', open: '7 AM', close: '7 PM' }, { day: 'Tuesday', open: '9:00 AM', close: '5:30 PM' },
      { day: 'Wednesday', open: '', close: '', closed: true },
    ] });
    expect(r.site.hours).toEqual([
      { day: 'Monday', open: '07:00', close: '19:00' }, { day: 'Tuesday', open: '09:00', close: '17:30' },
      { day: 'Wednesday', open: '', close: '', closed: true },
    ]);
    const d = r.site;
    expect(editableHours(d)[0]).toEqual({ day: 'Monday', open: '07:00', close: '19:00', closed: false });
    const week = seedWeek(d);
    expect([week[0].startMin, week[0].endMin, week[0].open]).toEqual([420, 1140, true]);
    expect(week[2].open).toBe(false);
  });
  test('Booksy 24-hour hours are kept as they are', () => {
    expect(imp().site.hours![0]).toEqual({ day: 'Monday', open: '08:00', close: '12:00' });
    expect(hoursSummary(imp().site)).not.toBe('Add');
  });
  test('no hours (or all closed): the default Mon-Sat 9-5 week', () => {
    for (const hours of [undefined, [], [{ day: 'Monday', open: '', close: '', closed: true }]]) {
      const d = withDefaultHours(imp({ hours }).site);
      expect(d.hours).toEqual(defaultHours());
    }
  });
});

describe('what the page could not give', () => {
  test('phone and address are never invented', () => {
    const r = imp({ phone: '', address: '', area: '' });
    expect(r.site.phone).toBe('');
    expect(r.site.contact?.address).toBe('');
  });
  test('about text falls back to the generic welcome; photos stay what the page had (honest sites, no samples on an import)', () => {
    const r = imp({ description: '', photos: ['https://example.com/a.jpg'] });
    expect(r.site.about?.description?.length).toBeGreaterThan(0);
    expect(r.site.gallery![0]).toBe('https://example.com/a.jpg');
    expect(r.site.gallery!.slice(1).every((u) => !u)).toBe(true);
  });
  test('a Google import keeps its gallery as it was (no sample photos added)', () => {
    const g = toShopSite({ ...booksy, photos: [], bookingUrl: '' }, '', 'gbp');
    expect(g.site.gallery!.every((u) => !u)).toBe(true);
  });
});

describe('the Book button on an import is as adjustable as on scratch', () => {
  test.each(['luxe', 'prime', 'euphoria'] as TemplateId[])('%s: the Book button is tappable and opens the chooser in Book mode', (t) => {
    const r = rec({}, t);
    const html = buildPreviewHtml(r.data, true);
    const key = MAIN_BOOK_KEY[t];
    expect(html).toContain(`data-edit="labels.${key}"`);
    expect(routeTap(`labels.${key}`, r.data)).toEqual({ sheet: 'button', kind: 'book', labelKey: key });
    expect(routeTap('bookingUrl', r.data)).toMatchObject({ sheet: 'button', kind: 'book' });
    expect(needsAddButton(r.data)).toBe(false);
  });
  test('the default is the barber\'s own link, kept as the label-editable Booking link option', () => {
    const r = rec();
    expect(bookingPrefs(r)).toEqual({ own: LINK, choice: 'own' });
    const edited = applyButtonChange(r, 'bookButton', { text: 'Reserve', book: { choice: 'own' } });
    expect((edited.data.labels as any).bookButton).toBe('Reserve');
    expect(edited.data.bookingUrl).toBe(LINK);
  });
  test('Call my number -> Built-in booking -> Booking link again, and Remove + Add a button', () => {
    let r = rec();
    r = syncOwnLink(r, applyButtonChange(r, 'bookButton', { text: 'Book Now', callText: 'Ring us', phone: '(214) 555-0100', book: { choice: 'call' } }));
    expect(r.data.bookingUrl).toBeUndefined();
    expect(r.data.phone).toBe('(214) 555-0100');
    expect(needsAddButton(r.data)).toBe(true);
    expect(buildPreviewHtml(r.data, true)).toContain('data-ab-add-button');
    r = syncOwnLink(r, applyButtonChange(r, 'bookButton', { text: 'Book Now', book: { choice: 'aibarber' } }));
    expect(r.data.bookingUrl).toBe('/book');
    expect(bookingPrefs(r).own).toBe(LINK);
    r = syncOwnLink(r, applyButtonChange(r, 'bookButton', { text: 'Book', book: { choice: 'own' } }));
    expect(r.data.bookingUrl).toBe(LINK);
    r = syncOwnLink(r, applyButtonChange(r, 'bookButton', { text: 'Book', book: { choice: 'own', url: 'https://square.site/book/x' } }));
    expect(r.data.bookingUrl).toBe('https://square.site/book/x');
    r = syncOwnLink(r, applyButtonChange(r, 'bookButton', { text: 'Book', book: { choice: 'call' } }));
    expect(needsAddButton(r.data)).toBe(true);
    expect(bookingPrefs(r).own).toBe('https://square.site/book/x');
  });
  test('hours and service cards are tappable in the preview exactly like a scratch site', () => {
    const html = buildPreviewHtml(withDefaultHours(rec().data), true);
    expect(html).toMatch(/data-edit="hours\.0\.open"/);
    expect(html).toContain('data-ab-service');
  });
});
