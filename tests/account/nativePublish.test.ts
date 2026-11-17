import { describe, expect, it } from 'vitest';
import { linksForNative, minutesLabel, nativePublication, refreshStaffFromMembers, weeklyHoursOf, type MemberFact, type NativeFactsDeps } from '../../lib/account/nativePublish.js';

const shopOpen = { bookingsEnabled: true };
const full = { bookings: true, store: true, shop: shopOpen };

describe('linksForNative (port of linksToSend)', () => {
  it('AI Barber Book link survives only when bookings plan, a shop and the open switch are all there', () => {
    expect(linksForNative({ bookingUrl: '/book' }, full)).toMatchObject({ bookingUrl: '/book' });
    expect(linksForNative({ bookingUrl: '/book' }, { ...full, shop: null }).bookingUrl).toBeUndefined();
    expect(linksForNative({ bookingUrl: '/book' }, { ...full, shop: { bookingsEnabled: false } }).bookingUrl).toBeUndefined();
    expect(linksForNative({ bookingUrl: '/book' }, { ...full, bookings: false }).bookingUrl).toBeUndefined();
    expect(linksForNative({ bookingUrl: 'https://aibarber.org/book/fresh' }, full).bookingUrl).toBe('/book'); // old form is the same button
  });
  it('the barber\'s own link is kept whatever the plan, and no Book link stays none (the "call" choice)', () => {
    expect(linksForNative({ bookingUrl: ' https://booksy.com/x ' }, { bookings: false, store: false, shop: null }).bookingUrl).toBe('https://booksy.com/x');
    expect(linksForNative({}, full).bookingUrl).toBeUndefined();
  });
  it('Shop link only with the store plan and a shop', () => {
    expect(linksForNative({ shopUrl: '/shop' }, full).shopUrl).toBe('/shop');
    expect(linksForNative({ shopUrl: '/shop' }, { ...full, store: false }).shopUrl).toBeUndefined();
    expect(linksForNative({ shopUrl: '/shop' }, { ...full, shop: null }).shopUrl).toBeUndefined();
    expect(linksForNative({}, full).shopUrl).toBe('/shop'); // decided by the server, not the phone
  });
});

const week = (days: number[]) => days.map((weekday) => ({ weekday, start_min: 540, end_min: 1020 }));
const m = (id: string, over: Partial<MemberFact> = {}): MemberFact => ({ id, display_name: `Name ${id}`, photo_url: `https://img/${id}.jpg`, active: true, weeks: week([0, 1, 2]), ...over });

describe('refreshStaffFromMembers', () => {
  const staff = [{ name: 'Old A', memberId: 'a', photo: 'https://old', role: 'Owner' }, { name: 'Gone', memberId: 'z' }, { name: 'Off', memberId: 'o' }, { name: 'Website only' }];
  it('updates name, photo and hours; drops removed and inactive members; never adds; website-only entries untouched', () => {
    const out = refreshStaffFromMembers(staff, [m('a'), m('o', { active: false }), m('new')])!;
    expect(out.map((s) => s.name)).toEqual(['Name a', 'Website only']);
    expect(out[0]).toMatchObject({ memberId: 'a', photo: 'https://img/a.jpg', role: 'Owner' });
    expect(out[0].hours![0]).toEqual({ day: 'Monday', open: '9:00 AM', close: '5:00 PM' });
    expect(out[0].hours![6]).toEqual({ day: 'Sunday', open: '', close: '', closed: true });
  });
  it('a removed photo is removed; a list with no memberId is not touched', () => {
    expect(refreshStaffFromMembers([{ name: 'A', memberId: 'a', photo: 'x' }], [m('a', { photo_url: null })])![0].photo).toBeUndefined();
    expect(refreshStaffFromMembers([{ name: 'A' }], [])).toBeUndefined();
    expect(refreshStaffFromMembers(undefined, [])).toBeUndefined();
  });
  it('hours helpers', () => {
    expect(minutesLabel(0)).toBe('12:00 AM'); expect(minutesLabel(750)).toBe('12:30 PM');
    expect(weeklyHoursOf([]).filter((d) => !d.closed)).toHaveLength(6); // default Mon to Sat
  });
});

describe('nativePublication', () => {
  const deps = (o: Partial<NativeFactsDeps> = {}): NativeFactsDeps => ({
    plan: async () => ({ bookings: true, store: false }), shop: async () => ({ id: 's1', bookingsEnabled: true }), members: async () => [m('a')], ...o,
  });
  it('a removed team member has no card after a native publish; links are the server\'s', async () => {
    const p = await nativePublication('u', { bookingUrl: '/book', shopUrl: '/shop', staff: [{ name: 'A', memberId: 'a' }, { name: 'B', memberId: 'b' }] }, deps());
    expect(p.bookingUrl).toBe('/book');
    expect(p.shopUrl).toBeUndefined();
    expect(p.staff!.map((s) => s.memberId)).toEqual(['a']);
  });
  it('without a memberId nothing is read for the team', async () => {
    const p = await nativePublication('u', { staff: [{ name: 'W' }] }, deps({ members: async () => { throw new Error('not read'); } }));
    expect(p.staff).toBeUndefined();
  });
  it('a lookup failure throws (the caller answers 503; links are never guessed)', async () => {
    await expect(nativePublication('u', {}, deps({ plan: async () => { throw new Error('db'); } }))).rejects.toThrow('db');
    await expect(nativePublication('u', { staff: [{ name: 'A', memberId: 'a' }] }, deps({ members: async () => { throw new Error('db'); } }))).rejects.toThrow('db');
  });
});
