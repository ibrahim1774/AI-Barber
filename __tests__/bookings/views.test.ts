import {
  addMonths, bucketAppointments, countText, timeOffSpans, monthLabel, weekLabel, closedWeekdays, dayLayout, hourWindow, memberColors, monthGrid, viewRange, weekRange,
  type Appointment,
} from '@/lib/bookings/calendar';
import { fetchAllPages } from '@/lib/bookings/api';

const NY = 'America/New_York';
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', shopId: 's', memberId: 'm1', serviceId: 'sv', start: '2026-10-23T18:00:00Z', end: '2026-10-23T18:30:00Z',
  serviceName: 'Fade', priceCents: 3000, durationMin: 30, customerName: 'Sam', customerPhone: null,
  customerEmail: null, note: null, status: 'booked', paymentStatus: 'none', paymentMethod: null, amountPaidCents: 0,
  customerSaysPaidAt: null, source: 'online', ...over,
});

describe('weekRange', () => {
  it('starts on Monday and has 7 keys', () => {
    // 2026-10-23 is a Friday.
    expect(weekRange('2026-10-23', NY)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
  });
  it('a Monday and a Sunday stay in their own week', () => {
    expect(weekRange('2026-10-19', NY)[0]).toBe('2026-10-19');
    expect(weekRange('2026-10-25', NY)[0]).toBe('2026-10-19');
    expect(weekRange('2026-10-26', NY)[0]).toBe('2026-10-26');
  });
  it('a DST week still has 7 distinct keys', () => {
    // US fall back: Sun 2026-11-01.
    const w = weekRange('2026-11-01', NY);
    expect(w).toHaveLength(7);
    expect(new Set(w).size).toBe(7);
    expect(w[0]).toBe('2026-10-26');
    expect(w[6]).toBe('2026-11-01');
    const spring = weekRange('2026-03-08', NY);
    expect(spring).toHaveLength(7);
    expect(spring[6]).toBe('2026-03-08');
  });
  it('crosses a year boundary', () => {
    expect(weekRange('2027-01-01', NY)).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });
});

describe('monthGrid', () => {
  it('is 42 cells, Monday first, with leading and trailing days flagged', () => {
    const g = monthGrid(2026, 10, NY);
    expect(g).toHaveLength(42);
    // Oct 1 2026 is a Thursday: Mon Sep 28 .. Wed Sep 30 lead.
    expect(g[0]).toEqual({ key: '2026-09-28', day: 28, inMonth: false });
    expect(g[3]).toEqual({ key: '2026-10-01', day: 1, inMonth: true });
    expect(g.filter((c) => c.inMonth)).toHaveLength(31);
    expect(g[41].inMonth).toBe(false);
    expect(g[41].key).toBe('2026-11-08');
  });
  it('a month starting on Monday has no leading days', () => {
    const g = monthGrid(2026, 6, NY); // June 1 2026 is a Monday
    expect(g[0]).toEqual({ key: '2026-06-01', day: 1, inMonth: true });
    expect(g).toHaveLength(42);
  });
  it('February in a leap year', () => {
    expect(monthGrid(2028, 2, NY).filter((c) => c.inMonth)).toHaveLength(29);
  });
});

describe('addMonths', () => {
  it('clamps the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-10');
  });
});

describe('viewRange', () => {
  it('week is the 7 days; month is the whole 6-week grid; end is exclusive', () => {
    expect(viewRange('week', '2026-10-23', NY)).toEqual({ from: '2026-10-19', to: '2026-10-26' });
    expect(viewRange('month', '2026-10-23', NY)).toEqual({ from: '2026-09-28', to: '2026-11-09' });
  });
});

describe('bucketAppointments', () => {
  it('puts a 23:30 local appointment on its local day, not the UTC day', () => {
    // 2026-10-24T03:30Z = 23:30 on the 23rd in New York.
    const a = appt({ id: 'late', start: '2026-10-24T03:30:00Z', end: '2026-10-24T04:00:00Z' });
    const b = bucketAppointments([a], weekRange('2026-10-23', NY), NY);
    expect(b['2026-10-23'].map((x) => x.id)).toEqual(['late']);
    expect(b['2026-10-24']).toEqual([]);
  });
  it('drops cancelled and out-of-range, sorts by start, accepts grid cells', () => {
    const list = [
      appt({ id: 'b', start: '2026-10-23T19:00:00Z' }),
      appt({ id: 'a', start: '2026-10-23T15:00:00Z' }),
      appt({ id: 'x', status: 'cancelled' }),
      appt({ id: 'far', start: '2027-02-01T15:00:00Z' }),
    ];
    const b = bucketAppointments(list, monthGrid(2026, 10, NY), NY);
    expect(b['2026-10-23'].map((x) => x.id)).toEqual(['a', 'b']);
    expect(Object.values(b).flat().some((x) => x.id === 'far')).toBe(false);
  });
  it('filters to one barber', () => {
    const list = [appt({ id: '1', memberId: 'm1' }), appt({ id: '2', memberId: 'm2' })];
    expect(bucketAppointments(list, ['2026-10-23'], NY, 'm2')['2026-10-23'].map((x) => x.id)).toEqual(['2']);
  });
});

describe('memberColors', () => {
  it('is stable by member sort order, not by list position', () => {
    const ms = [{ id: 'z', sort: 2 }, { id: 'a', sort: 0 }, { id: 'm', sort: 1 }];
    const c = memberColors(ms);
    const again = memberColors([...ms].reverse());
    expect(c.get('a')).toBe(again.get('a'));
    expect(c.get('z')).toBe(again.get('z'));
    expect(new Set([c.get('a'), c.get('m'), c.get('z')]).size).toBe(3);
  });
  it('wraps past the palette', () => {
    const ms = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, sort: i }));
    expect(memberColors(ms).get('m11')).toBeTruthy();
  });
});

describe('closedWeekdays', () => {
  it('lists weekdays (0 = Monday) with no hours for anyone, nothing when no hours are set at all', () => {
    expect(closedWeekdays([])).toEqual([]);
    const rows = [0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMin: 540, endMin: 1020 }));
    expect(closedWeekdays(rows)).toEqual([6]);
  });
});

describe('hourWindow', () => {
  it('is the open hours plus an hour each side', () => {
    expect(hourWindow([{ startMin: 9 * 60, endMin: 17 * 60 }], [], NY)).toEqual({ startHour: 8, endHour: 18 });
  });
  it('defaults when no hours are set, and clamps to the day', () => {
    expect(hourWindow([], [], NY)).toEqual({ startHour: 8, endHour: 20 });
    expect(hourWindow([{ startMin: 30, endMin: 23 * 60 + 30 }], [], NY)).toEqual({ startHour: 0, endHour: 24 });
  });
  it('grows to include an appointment outside the hours', () => {
    const early = appt({ start: '2026-10-23T10:00:00Z', end: '2026-10-23T10:30:00Z' }); // 6:00 AM NY
    expect(hourWindow([{ startMin: 9 * 60, endMin: 17 * 60 }], [early], NY).startHour).toBe(6);
  });
});

describe('dayLayout', () => {
  it('gives overlapping appointments their own lanes', () => {
    const a = appt({ id: 'a', start: '2026-10-23T14:00:00Z', end: '2026-10-23T15:00:00Z' });
    const b = appt({ id: 'b', start: '2026-10-23T14:30:00Z', end: '2026-10-23T15:30:00Z' });
    const c = appt({ id: 'c', start: '2026-10-23T16:00:00Z', end: '2026-10-23T16:30:00Z' });
    const l = dayLayout([a, b, c], '2026-10-23', NY);
    const by = Object.fromEntries(l.map((x) => [x.appt.id, x]));
    expect(by.a.lanes).toBe(2);
    expect(by.b.lanes).toBe(2);
    expect(by.a.lane).not.toBe(by.b.lane);
    expect(by.c.lanes).toBe(1);
    expect(by.a.startMin).toBe(10 * 60);
    expect(by.a.endMin).toBe(11 * 60);
  });
  it('clamps an appointment running past local midnight to the day', () => {
    const a = appt({ start: '2026-10-24T03:30:00Z', end: '2026-10-24T05:00:00Z' }); // 23:30 -> 01:00 NY
    const [l] = dayLayout([a], '2026-10-23', NY);
    expect(l.startMin).toBe(23 * 60 + 30);
    expect(l.endMin).toBe(24 * 60);
  });
});

describe('fetchAllPages', () => {
  it('keeps asking until a short page, past the 1,000-row cap', async () => {
    const pages = [Array(1000).fill(1), Array(1000).fill(2), Array(250).fill(3)];
    const calls: [number, number][] = [];
    const out = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return pages[calls.length - 1];
    }, 1000);
    expect(out).toHaveLength(2250);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('stops after one short page', async () => {
    const fn = jest.fn(async () => [1, 2, 3]);
    expect(await fetchAllPages(fn, 1000)).toEqual([1, 2, 3]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('an exact full last page asks once more and gets an empty one', async () => {
    const pages = [Array(1000).fill(1), []];
    let i = 0;
    expect(await fetchAllPages(async () => pages[i++], 1000)).toHaveLength(1000);
    expect(i).toBe(2);
  });
});

describe('labels', () => {
  it('week, month and count text', () => {
    expect(weekLabel(weekRange('2026-10-23', NY))).toBe('Oct 19 - 25');
    expect(weekLabel(weekRange('2026-11-01', NY))).toBe('Oct 26 - Nov 1');
    expect(monthLabel('2026-10-23')).toBe('October 2026');
    expect([countText(4), countText(9), countText(10)]).toEqual(['4', '9', '9+']);
  });
});

describe('timeOffSpans (greyed blocks in Week view)', () => {
  const off = (over = {}) => ({ id: 't1', memberId: 'm1', start: '2026-10-23T16:00:00Z', end: '2026-10-23T18:00:00Z', reason: null, ...over });
  it('gives local minutes on the day, 12:00 to 14:00 New York', () => {
    expect(timeOffSpans([off()], '2026-10-23', NY, null)).toEqual([{ id: 't1', startMin: 720, endMin: 840 }]);
  });
  it('clips a block that runs past midnight to each day it touches', () => {
    const t = off({ start: '2026-10-23T22:00:00Z', end: '2026-10-24T14:00:00Z' });
    expect(timeOffSpans([t], '2026-10-23', NY, null)).toEqual([{ id: 't1', startMin: 1080, endMin: 1440 }]);
    expect(timeOffSpans([t], '2026-10-24', NY, null)).toEqual([{ id: 't1', startMin: 0, endMin: 600 }]);
    expect(timeOffSpans([t], '2026-10-25', NY, null)).toEqual([]);
  });
  it('filters to one barber when one is selected', () => {
    expect(timeOffSpans([off({ memberId: 'm2' })], '2026-10-23', NY, 'm1')).toEqual([]);
    expect(timeOffSpans([off({ memberId: 'm2' })], '2026-10-23', NY, 'm2')).toHaveLength(1);
  });
});
