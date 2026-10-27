import type { WebsiteData } from '@/web/types';
import { hoursSummary, withDefaultHours, DAYS, TIME_OPTIONS, copyDayToOpenDays, defaultHours, editableHours, setDay, timeLabel } from '@/lib/sections/hours';

const site = (hours?: WebsiteData['hours']) => ({ shopName: 'S', hours } as WebsiteData);

describe('hours', () => {
  it('defaultHours is Monday-Saturday 9-5 with only Sunday closed', () => {
    const h = defaultHours();
    expect(h.map((r) => r.day)).toEqual([...DAYS]);
    expect(h.filter((r) => r.closed).map((r) => r.day)).toEqual(['Sunday']);
    expect(h[1]).toMatchObject({ open: '09:00', close: '17:00' });
  });
  it('TIME_OPTIONS runs 06:00 to 22:00 by half hours', () => {
    expect(TIME_OPTIONS[0]).toBe('06:00');
    expect(TIME_OPTIONS[1]).toBe('06:30');
    expect(TIME_OPTIONS[TIME_OPTIONS.length - 1]).toBe('22:00');
    expect(TIME_OPTIONS).toHaveLength(33);
  });
  it('timeLabel formats 24-hour times and passes the rest through', () => {
    expect(timeLabel('09:00')).toBe('9:00 AM');
    expect(timeLabel('13:30')).toBe('1:30 PM');
    expect(timeLabel('00:00')).toBe('12:00 AM');
    expect(timeLabel('12:00')).toBe('12:00 PM');
    expect(timeLabel('9am')).toBe('9am');
  });
  it('editableHours matches by day prefix and closes missing days', () => {
    const rows = editableHours(site([{ day: 'Mon', open: '9am', close: '5pm' }]));
    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual({ day: 'Monday', open: '9am', close: '5pm', closed: false });
    expect(rows[1].closed).toBe(true);
  });
  it('leaves unparseable days unchanged', () => {
    const d = site([
      { day: 'Monday', open: 'By appointment', close: 'By appointment' },
      { day: 'Tuesday', open: '09:00', close: '17:00' },
    ]);
    const out = setDay(d, 'Tuesday', { open: '10:00' });
    expect(out.hours![0]).toEqual({ day: 'Monday', open: 'By appointment', close: 'By appointment' });
    expect(out.hours![1]).toMatchObject({ open: '10:00', close: '17:00' });
    expect(out.hours).toHaveLength(2);
  });
  it('seeds defaults when the site had no hours', () => {
    const out = setDay(site(), 'Wednesday', { close: '20:00' });
    expect(out.hours).toHaveLength(7);
    expect(out.hours![2]).toMatchObject({ day: 'Wednesday', open: '09:00', close: '20:00' });
  });
  it('rejects a close earlier than the open', () => {
    const d = site(defaultHours());
    expect(setDay(d, 'Tuesday', { close: '08:00' })).toBe(d);
    expect(setDay(d, 'Tuesday', { open: '19:00' })).toBe(d);
  });
  it('opens and closes a day', () => {
    const d = site(defaultHours());
    expect(setDay(d, 'Monday', { closed: false }).hours![0].closed).toBeUndefined();
    expect(setDay(d, 'Tuesday', { closed: true }).hours![1].closed).toBe(true);
  });
  it('adds a missing day in week order', () => {
    const d = site([{ day: 'Friday', open: '09:00', close: '17:00' }]);
    const out = setDay(d, 'Monday', { closed: false, open: '10:00', close: '16:00' });
    expect(out.hours!.map((r) => r.day)).toEqual(['Monday', 'Friday']);
  });
  it('copies one open day onto the other open days only', () => {
    // Monday is closed here on purpose: the default week is now open Monday to Saturday.
    const d = setDay(site(defaultHours()), 'Monday', { closed: true });
    const edited = setDay(d, 'Tuesday', { open: '10:00', close: '16:00' });
    const out = copyDayToOpenDays(edited, 'Tuesday');
    expect(out.hours![2]).toMatchObject({ open: '10:00', close: '16:00' });
    expect(out.hours![5]).toMatchObject({ open: '10:00', close: '16:00' });
    expect(out.hours![0]).toEqual(edited.hours![0]); // Monday still closed, untouched
    expect(copyDayToOpenDays(edited, 'Monday')).toBe(edited);
  });
  it('withDefaultHours seeds only when there are no hours', () => {
    const seeded = withDefaultHours(site());
    expect(seeded.hours).toEqual(defaultHours());
    expect(withDefaultHours(site([])).hours).toEqual(defaultHours());
    const found = site([{ day: 'Mon', open: '10:00', close: '15:00' }]);
    expect(withDefaultHours(found)).toBe(found);
    const allClosed = site(defaultHours().map((r) => ({ ...r, closed: true })));
    expect(withDefaultHours(allClosed)).toBe(allClosed);
  });
  it('editableHours shows the 9-5 week for a site with no hours', () => {
    const rows = editableHours(site());
    expect(rows.filter((r) => !r.closed)).toHaveLength(6);
    expect(rows[0]).toMatchObject({ day: 'Monday', open: '09:00', close: '17:00' });
  });
  it('hoursSummary', () => {
    expect(hoursSummary(site())).toBe('Add');
    expect(hoursSummary(site(defaultHours()))).toBe('Mon-Sat 9:00 AM - 5:00 PM');
    expect(hoursSummary(setDay(site(defaultHours()), 'Tuesday', { open: '10:00' }))).toBe('Open 6 days');
  });
});

describe('new sites start with the default hours', () => {
  const { seedDefaultHours } = require('@/lib/flow');
  const store = require('@/lib/siteStore');
  const put = (hours?: any) => store.saveSite({ draftId: 'd', inputs: {}, data: { shopName: 'S', hours }, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null });
  const hoursNow = async () => (await store.loadSite()).data.hours;
  it('seeds a draft that found no hours (booking link, Google listing and scratch all end here)', async () => {
    await put();
    await seedDefaultHours();
    expect(await hoursNow()).toEqual(defaultHours());
  });
  it('keeps hours an import found or the barber edited', async () => {
    const found = [{ day: 'Monday', open: '10:00', close: '14:00' }];
    await put(found);
    await seedDefaultHours();
    expect(await hoursNow()).toEqual(found);
  });
});
