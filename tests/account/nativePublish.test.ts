import { describe, expect, it } from 'vitest';
import { bookingInputsFrom, isAiBarberBook, linksForNative, minutesLabel, nativePublication, refreshStaffFromMembers, weeklyHoursOf, type LinkFacts, type MemberFact, type NativeFactsDeps } from '../../lib/account/nativePublish.js';

const full: LinkFacts = { hosting: true, bookings: true, store: true, shop: { bookingsEnabled: true, storeEnabled: true } };

describe('isAiBarberBook (the app\'s isAiBarberBookingUrl, web build)', () => {
  it('recognises aibarber.org and primebarber.org book pages and subdomains, and the site\'s /book; never Booksy or /bookings', () => {
    for (const u of ['/book', 'https://www.aibarber.org/book/fresh', 'aibarber.org/book', 'https://www.primebarber.org/book', 'https://shop.primebarber.org/book?x=1']) expect(isAiBarberBook(u), u).toBe(true);
    for (const u of ['https://booksy.com/x', 'https://www.primebarber.org/bookings', 'https://notaibarber.org/book', '']) expect(isAiBarberBook(u), u).toBe(false);
  });
});

describe('bookingInputsFrom', () => {
  it('absent fields give nothing; valid ones pass; invalid ones are 400', () => {
    expect(bookingInputsFrom({})).toEqual({});
    expect(bookingInputsFrom({ bookingChoice: 'aibarber', ownBookingUrl: ' https://booksy.com/x ' })).toEqual({ bookingChoice: 'aibarber', ownBookingUrl: 'https://booksy.com/x' });
    for (const bad of [{ bookingChoice: 'built-in' }, { bookingChoice: 5 }, { ownBookingUrl: 'ftp://x.com' }, { ownBookingUrl: 'javascript:alert(1)' }, { ownBookingUrl: 'https://x.com/a b' },
      { ownBookingUrl: 'https://www.primebarber.org/book' }, { ownBookingUrl: 'https://primebarber.org/x' }, { ownBookingUrl: 'https://www.aibarber.org/' }, { ownBookingUrl: `https://x.com/${'a'.repeat(2100)}` }]) {
      expect(() => bookingInputsFrom(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe('linksForNative (port of linksToSend / resolveLinks / stripLapsedLinks)', () => {
  const OWN = 'https://booksy.com/fade';
  it('chose aibarber with live bookings: /book', () => {
    expect(linksForNative({}, full, { bookingChoice: 'aibarber', ownBookingUrl: OWN }).bookingUrl).toBe('/book');
  });
  it('chose aibarber but bookings lapsed, or no shop, or the shop switch off: the own link when one was given, else none', () => {
    const inp = { bookingChoice: 'aibarber' as const, ownBookingUrl: OWN };
    expect(linksForNative({}, { ...full, bookings: false }, inp).bookingUrl).toBe(OWN);
    expect(linksForNative({}, { ...full, shop: null }, inp).bookingUrl).toBe(OWN);
    expect(linksForNative({}, { ...full, shop: { bookingsEnabled: false, storeEnabled: true } }, inp).bookingUrl).toBe(OWN);
    expect(linksForNative({}, { ...full, bookings: false }, { bookingChoice: 'aibarber' }).bookingUrl).toBeUndefined();
  });
  it('own and call choices', () => {
    expect(linksForNative({}, full, { bookingChoice: 'own', ownBookingUrl: OWN }).bookingUrl).toBe(OWN);
    expect(linksForNative({}, full, { bookingChoice: 'call', ownBookingUrl: OWN }).bookingUrl).toBeUndefined();
    expect(linksForNative({}, full, { bookingChoice: 'own' }).bookingUrl).toBe('/book'); // no own link: the app makes it aibarber
  });
  it('no stored choice: the app\'s default (an own link in the draft means own; an AI Barber link means aibarber)', () => {
    expect(linksForNative({ bookingUrl: OWN }, full, { ownBookingUrl: OWN }).bookingUrl).toBe(OWN);
    expect(linksForNative({ bookingUrl: '/book' }, full, { ownBookingUrl: OWN }).bookingUrl).toBe('/book');
    expect(linksForNative({}, full, { ownBookingUrl: OWN }).bookingUrl).toBe(OWN);
  });
  it('neither field sent: today\'s derive-from-draft behaviour', () => {
    expect(linksForNative({ bookingUrl: '/book' }, full).bookingUrl).toBe('/book');
    expect(linksForNative({ bookingUrl: '/book' }, { ...full, bookings: false }).bookingUrl).toBeUndefined();
    expect(linksForNative({ bookingUrl: OWN }, { ...full, bookings: false }).bookingUrl).toBe(OWN);
    expect(linksForNative({}, full).bookingUrl).toBeUndefined();
  });
  it('Shop link needs the store plan, a shop AND store_enabled; the phone\'s own shopUrl is ignored', () => {
    expect(linksForNative({}, full).shopUrl).toBe('/shop');
    expect(linksForNative({ shopUrl: '/shop' }, { ...full, shop: { bookingsEnabled: true, storeEnabled: false } }).shopUrl).toBeUndefined();
    expect(linksForNative({ shopUrl: '/shop' }, { ...full, store: false }).shopUrl).toBeUndefined();
    expect(linksForNative({ shopUrl: '/shop' }, { ...full, shop: null }).shopUrl).toBeUndefined();
  });
  it('plan not active (not confirmable): built-in Book falls back to the own link, Shop dropped', () => {
    const f = { ...full, hosting: false };
    expect(linksForNative({}, f, { bookingChoice: 'aibarber', ownBookingUrl: OWN })).toEqual({ bookingUrl: OWN });
  });
});

const week = (days: number[]) => days.map((weekday) => ({ weekday, start_min: 540, end_min: 1020 }));
const m = (id: string, over: Partial<MemberFact> = {}): MemberFact => ({ id, display_name: `Name ${id}`, photo_url: `https://img/${id}.jpg`, bio: `Bio ${id}`, active: true, title: 'Master', booking_url: 'https://b.example/x', serviceIds: ['s1'], weeks: week([0, 1, 2]), ...over });
const services = [{ id: 's1', name: 'Fade' }, { id: 's2', name: 'Beard' }];

describe('refreshStaffFromMembers (siteEntryFor port)', () => {
  const staff = [{ name: 'Old A', memberId: 'a', photo: 'https://old', role: 'Old role', serviceNames: ['x'] }, { name: 'Gone', memberId: 'z' }, { name: 'Off', memberId: 'o' }, { name: 'Website only' }];
  it('updates name, photo, bio, title, link, services and hours; drops removed and inactive; never adds; website-only untouched', () => {
    const out = refreshStaffFromMembers(staff, [m('a'), m('o', { active: false }), m('new')], services, true)!;
    expect(out.map((s) => s.name)).toEqual(['Name a', 'Website only']);
    expect(out[0]).toMatchObject({ memberId: 'a', photo: 'https://img/a.jpg', bio: 'Bio a', role: 'Master', bookingUrl: 'https://b.example/x', serviceIds: ['s1'], serviceNames: ['Fade'] });
    expect(out[0].hours![0]).toEqual({ day: 'Monday', open: '9:00 AM', close: '5:00 PM' });
    expect(out[0].hours![6]).toEqual({ day: 'Sunday', open: '', close: '', closed: true });
  });
  it('no serviceIds rows = every service (up to three names, no serviceIds)', () => {
    const many = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase() }));
    const out = refreshStaffFromMembers([{ name: 'A', memberId: 'a', serviceIds: ['x'] }], [m('a', { serviceIds: null })], many, true)![0];
    expect(out.serviceIds).toBeUndefined();
    expect(out.serviceNames).toEqual(['A', 'B', 'C']);
  });
  it('before migration 015 the title and link stay as the site had them', () => {
    const out = refreshStaffFromMembers([{ name: 'A', memberId: 'a', role: 'Kept', bookingUrl: 'https://kept.example' }], [m('a')], services, false)![0];
    expect(out).toMatchObject({ role: 'Kept', bookingUrl: 'https://kept.example' });
  });
  it('a removed photo or bio is removed; a list with no memberId is not touched', () => {
    const out = refreshStaffFromMembers([{ name: 'A', memberId: 'a', photo: 'x', bio: 'y' }], [m('a', { photo_url: null, bio: null })], services, true)![0];
    expect(out.photo).toBeUndefined(); expect(out.bio).toBeUndefined();
    expect(refreshStaffFromMembers([{ name: 'A' }], [], [], true)).toBeUndefined();
  });
  it('hours helpers', () => {
    expect(minutesLabel(0)).toBe('12:00 AM'); expect(minutesLabel(750)).toBe('12:30 PM');
    expect(weeklyHoursOf([]).filter((d) => !d.closed)).toHaveLength(6);
  });
});

describe('nativePublication', () => {
  const deps = (o: Partial<NativeFactsDeps> = {}): NativeFactsDeps => ({
    plan: async () => ({ hosting: true, bookings: true, store: false }), shop: async () => ({ id: 's1', bookingsEnabled: true, storeEnabled: true }),
    profileLive: async () => true, members: async () => [m('a')], services: async () => services, ...o,
  });
  it('a removed team member has no card after a native publish; links are the server\'s', async () => {
    const p = await nativePublication('u', { bookingUrl: '/book', shopUrl: '/shop', staff: [{ name: 'A', memberId: 'a' }, { name: 'B', memberId: 'b' }] }, {}, deps());
    expect(p.bookingUrl).toBe('/book');
    expect(p.shopUrl).toBeUndefined();
    expect(p.staff!.map((s) => s.memberId)).toEqual(['a']);
  });
  it('no shop row: staff is left untouched (undefined), never every card dropped', async () => {
    const p = await nativePublication('u', { staff: [{ name: 'A', memberId: 'a' }] }, {}, deps({ shop: async () => null, members: async () => { throw new Error('not read'); } }));
    expect(p.staff).toBeUndefined();
  });
  it('without a memberId nothing is read for the team', async () => {
    const p = await nativePublication('u', { staff: [{ name: 'W' }] }, {}, deps({ members: async () => { throw new Error('not read'); } }));
    expect(p.staff).toBeUndefined();
  });
  it('a lookup failure throws (the caller answers 503)', async () => {
    await expect(nativePublication('u', {}, {}, deps({ plan: async () => { throw new Error('db'); } }))).rejects.toThrow('db');
    await expect(nativePublication('u', { staff: [{ name: 'A', memberId: 'a' }] }, {}, deps({ members: async () => { throw new Error('db'); } }))).rejects.toThrow('db');
  });
});
