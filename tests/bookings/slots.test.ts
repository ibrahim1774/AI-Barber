import { describe, it, expect } from 'vitest';
import { freeSlots, freeSlotsAny, type AvailabilityRow, type SlotInput } from '../../lib/bookings/slots.js';

const NY = 'America/New_York';
const h = (hh: number, mm = 0) => hh * 60 + mm;
const allWeek = (start: number, end: number, extra: Partial<AvailabilityRow> = {}): AvailabilityRow[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_min: start, end_min: end, ...extra }));

// 2026-10-26 is a Monday (weekday 0). New York is on EDT (UTC-4) that week.
const MON = '2026-10-26';
const base = (over: Partial<SlotInput> = {}): SlotInput => ({
  timezone: NY,
  date: MON,
  availability: [{ weekday: 0, start_min: h(9), end_min: h(12) }],
  timeOff: [],
  busy: [],
  durationMin: 30,
  now: '2026-10-21T12:00:00Z',
  ...over,
});

describe('freeSlots', () => {
  it('basic day, 30-minute service: steps from open, last slot ends at close', () => {
    expect(freeSlots(base())).toEqual([
      '2026-10-26T13:00:00.000Z', '2026-10-26T13:30:00.000Z', '2026-10-26T14:00:00.000Z',
      '2026-10-26T14:30:00.000Z', '2026-10-26T15:00:00.000Z', '2026-10-26T15:30:00.000Z',
    ]);
  });

  it('respects the break (no slot overlaps it)', () => {
    const out = freeSlots(base({
      availability: [{ weekday: 0, start_min: h(9), end_min: h(17), break_start_min: h(12), break_end_min: h(13) }],
      durationMin: 60,
    }));
    // 9, 10, 11, then 13..16 local (EDT = UTC-4)
    expect(out).toEqual(['13', '14', '15', '17', '18', '19', '20'].map((hh) => `2026-10-26T${hh}:00:00.000Z`));
  });

  it('a slot that would straddle the break is dropped (45-minute service)', () => {
    const out = freeSlots(base({
      availability: [{ weekday: 0, start_min: h(11), end_min: h(14), break_start_min: h(12), break_end_min: h(13) }],
      durationMin: 45,
    }));
    // 11:00-11:45 ok; 11:45-12:30 hits the break; 12:30-13:15 hits the break; 13:15-14:00 ok
    expect(out).toEqual(['2026-10-26T15:00:00.000Z', '2026-10-26T17:15:00.000Z']);
  });

  it('time off overlapping part of the day removes the covered slots', () => {
    const out = freeSlots(base({ timeOff: [{ start: '2026-10-26T10:00:00-04:00', end: '2026-10-26T11:00:00-04:00' }] }));
    expect(out).toEqual([
      '2026-10-26T13:00:00.000Z', '2026-10-26T13:30:00.000Z', '2026-10-26T15:00:00.000Z', '2026-10-26T15:30:00.000Z',
    ]);
  });

  it('busy appointments block their time (any ISO offset format)', () => {
    const out = freeSlots(base({ busy: [{ start: '2026-10-26 14:00:00+00:00', end: '2026-10-26T14:30:00+00:00' }] }));
    expect(out).toEqual([
      '2026-10-26T13:00:00.000Z', '2026-10-26T13:30:00.000Z', // 9:00, 9:30
      '2026-10-26T14:30:00.000Z', '2026-10-26T15:00:00.000Z', '2026-10-26T15:30:00.000Z', // 10:30 onward
    ]);
  });

  it('busy appointments with a buffer: buffer after the new slot and after the existing one', () => {
    const out = freeSlots(base({
      busy: [{ start: '2026-10-26T14:00:00Z', end: '2026-10-26T14:30:00Z' }], // 10:00-10:30 local
      bufferMin: 10,
    }));
    // 9:00 (+10 -> 9:40) ok; 9:30 (+10 -> 10:10) hits it; 10:30 starts inside its 10:30-10:40 buffer
    expect(out).toEqual(['2026-10-26T13:00:00.000Z', '2026-10-26T15:00:00.000Z', '2026-10-26T15:30:00.000Z']);
  });

  it('buffer also keeps a gap before time off', () => {
    const out = freeSlots(base({
      timeOff: [{ start: '2026-10-26T15:00:00Z', end: '2026-10-26T16:00:00Z' }], // from 11:00 local
      bufferMin: 10,
    }));
    expect(out).toEqual(['2026-10-26T13:00:00.000Z', '2026-10-26T13:30:00.000Z', '2026-10-26T14:00:00.000Z']);
  });

  it('minimum notice when the day is today', () => {
    // Wednesday 2026-10-21, now 10:10 EDT, 2 h notice -> earliest 12:10 -> first slot 12:30
    const out = freeSlots(base({
      date: '2026-10-21',
      availability: allWeek(h(9), h(17)),
      now: '2026-10-21T14:10:00Z',
      minNoticeMin: 120,
    }));
    expect(out[0]).toBe('2026-10-21T16:30:00.000Z');
    expect(out.at(-1)).toBe('2026-10-21T20:30:00.000Z');
    expect(out).toHaveLength(9);
  });

  it('a slot exactly at now + notice is allowed', () => {
    const out = freeSlots(base({
      date: '2026-10-21', availability: allWeek(h(9), h(17)), now: '2026-10-21T14:30:00Z', minNoticeMin: 120,
    }));
    expect(out[0]).toBe('2026-10-21T16:30:00.000Z');
  });

  describe('lead days (shop-local calendar days, inclusive)', () => {
    const all = (date: string, over: Partial<SlotInput> = {}) =>
      freeSlots(base({ date, availability: allWeek(h(9), h(12)), leadDays: 30, ...over }));

    it('today + leadDays is bookable, the day after is not', () => {
      expect(all('2026-11-20')).toHaveLength(6);
      expect(all('2026-11-21')).toEqual([]);
    });

    it('past dates return nothing', () => {
      expect(all('2026-10-20')).toEqual([]);
    });

    it('"today" is the shop-local date, not the UTC date', () => {
      // 02:00Z on Oct 22 is still Oct 21, 22:00 in New York.
      const now = '2026-10-22T02:00:00Z';
      expect(all('2026-10-22', { now, leadDays: 0 })).toEqual([]); // that is "tomorrow" locally
      expect(all('2026-10-22', { now, leadDays: 1 })).toHaveLength(6);
      expect(all('2026-10-21', { now })).toEqual([]); // local today, but every slot has passed
    });
  });

  describe('45-minute service near closing', () => {
    it('never returns a slot that runs past close', () => {
      const out = freeSlots(base({ availability: [{ weekday: 0, start_min: h(9), end_min: h(11, 45) }], durationMin: 45 }));
      // 9:00, 9:45, 10:30 (ends 11:15); 11:15 would end 12:00 > 11:45
      expect(out).toEqual(['2026-10-26T13:00:00.000Z', '2026-10-26T13:45:00.000Z', '2026-10-26T14:30:00.000Z']);
    });

    it('with a 30-minute step', () => {
      const out = freeSlots(base({ durationMin: 45, stepMin: 30 }));
      // 9:00 .. 11:00 (ends 11:45); 11:30 would end 12:15
      expect(out).toEqual(['13:00', '13:30', '14:00', '14:30', '15:00'].map((t) => `2026-10-26T${t}:00.000Z`));
    });
  });

  it('closed days (no availability row for the weekday) return nothing', () => {
    expect(freeSlots(base({ date: '2026-10-27' }))).toEqual([]); // Tuesday
  });

  it('an empty or inverted window returns nothing', () => {
    expect(freeSlots(base({ availability: [{ weekday: 0, start_min: h(12), end_min: h(9) }] }))).toEqual([]);
  });

  it('works in other zones too (Europe/London)', () => {
    const avail = [0, 4].map((weekday) => ({ weekday, start_min: h(9), end_min: h(10) }));
    // Fri 2026-10-23 is BST (UTC+1); Mon 2026-10-26 is GMT (UTC+0, clocks went back Oct 25).
    expect(freeSlots(base({ timezone: 'Europe/London', date: '2026-10-23', availability: avail })))
      .toEqual(['2026-10-23T08:00:00.000Z', '2026-10-23T08:30:00.000Z']);
    expect(freeSlots(base({ timezone: 'Europe/London', date: '2026-10-26', availability: avail })))
      .toEqual(['2026-10-26T09:00:00.000Z', '2026-10-26T09:30:00.000Z']);
  });

  it('rejects an invalid timezone or date', () => {
    expect(() => freeSlots(base({ timezone: 'Mars/Olympus' }))).toThrow(/timezone/);
    expect(() => freeSlots(base({ date: '2026-02-30' }))).toThrow(/date/);
    expect(() => freeSlots(base({ date: '10/26/2026' }))).toThrow(/date/);
  });

  describe('DST, America/New_York (synthetic hours across 1-3 AM)', () => {
    const now = '2026-03-01T12:00:00Z';

    it('spring forward (Sun 2026-03-08): 2:00 and 2:30 do not exist and are skipped', () => {
      const out = freeSlots(base({ date: '2026-03-08', now, availability: [{ weekday: 6, start_min: 0, end_min: h(4) }] }));
      // 0:00, 0:30, 1:00, 1:30 EST (UTC-5); 3:00, 3:30 EDT (UTC-4). Contiguous in UTC, no duplicates.
      expect(out).toEqual(['05:00', '05:30', '06:00', '06:30', '07:00', '07:30'].map((t) => `2026-03-08T${t}:00.000Z`));
    });

    it('spring forward: a slot whose real end passes close is dropped', () => {
      // Close 3:00 EDT (07:00Z). 1:30 EST + 60 min = 3:30 EDT, past close, though "1:30 + 60 = 2:30" on the wall.
      const out = freeSlots(base({
        date: '2026-03-08', now, availability: [{ weekday: 6, start_min: 0, end_min: h(3) }], durationMin: 60, stepMin: 30,
      }));
      expect(out).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-08T05:30:00.000Z', '2026-03-08T06:00:00.000Z']);
    });

    it('spring forward: a close time inside the gap means the transition instant', () => {
      // Close "2:30" (does not exist) -> 3:00 EDT = 07:00Z; 1:30 EST + 30 = 07:00Z fits, nothing after.
      const out = freeSlots(base({ date: '2026-03-08', now, availability: [{ weekday: 6, start_min: h(1), end_min: h(2, 30) }] }));
      expect(out).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T06:30:00.000Z']);
    });

    it('fall back (Sun 2026-11-01): the repeated 1:00-2:00 hour is offered once, at its first occurrence', () => {
      const out = freeSlots(base({ date: '2026-11-01', now: '2026-10-25T12:00:00Z', availability: [{ weekday: 6, start_min: 0, end_min: h(4) }] }));
      // 0:00-1:30 EDT (UTC-4) -> 04:00..05:30Z; 2:00-3:30 EST (UTC-5) -> 07:00..08:30Z. No 06:00Z / 06:30Z.
      expect(out).toEqual(['04:00', '04:30', '05:00', '05:30', '07:00', '07:30', '08:00', '08:30'].map((t) => `2026-11-01T${t}:00.000Z`));
      expect(new Set(out).size).toBe(out.length);
    });

    it('fall back: fit is measured in real time (1:30 EDT + 60 min = 1:30 EST, before a 2:00 close)', () => {
      const out = freeSlots(base({
        date: '2026-11-01', now: '2026-10-25T12:00:00Z', availability: [{ weekday: 6, start_min: 0, end_min: h(2) }], durationMin: 60, stepMin: 30,
      }));
      expect(out).toEqual(['04:00', '04:30', '05:00', '05:30'].map((t) => `2026-11-01T${t}:00.000Z`));
    });

    it('fall back: an appointment in the second 1:00 hour blocks only real overlaps', () => {
      const out = freeSlots(base({
        date: '2026-11-01', now: '2026-10-25T12:00:00Z', availability: [{ weekday: 6, start_min: 0, end_min: h(4) }],
        busy: [{ start: '2026-11-01T01:00:00-05:00', end: '2026-11-01T02:30:00-05:00' }], // 06:00Z-07:30Z
      }));
      expect(out).toEqual(['04:00', '04:30', '05:00', '05:30', '07:30', '08:00', '08:30'].map((t) => `2026-11-01T${t}:00.000Z`));
    });
  });
});

describe('freeSlotsAny', () => {
  const input = { timezone: NY, date: MON, durationMin: 30, now: '2026-10-21T12:00:00Z' };
  const A = { id: 'a', availability: [{ weekday: 0, start_min: h(9), end_min: h(11) }], timeOff: [], busy: [{ start: '2026-10-26T13:30:00Z', end: '2026-10-26T14:00:00Z' }] };
  const B = { id: 'b', availability: [{ weekday: 0, start_min: h(10), end_min: h(12) }], timeOff: [], busy: [] };

  it('unions by start time; the first member in order wins shared times', () => {
    expect(freeSlotsAny(input, [A, B])).toEqual([
      { start: '2026-10-26T13:00:00.000Z', memberId: 'a' }, // 9:00
      // 9:30: A is busy, B not open yet -> absent
      { start: '2026-10-26T14:00:00.000Z', memberId: 'a' },
      { start: '2026-10-26T14:30:00.000Z', memberId: 'a' },
      { start: '2026-10-26T15:00:00.000Z', memberId: 'b' },
      { start: '2026-10-26T15:30:00.000Z', memberId: 'b' },
    ]);
  });

  it('order of members decides the winner; each start appears once', () => {
    const out = freeSlotsAny(input, [B, A]);
    expect(out.map((s) => s.memberId)).toEqual(['a', 'b', 'b', 'b', 'b']);
    expect(new Set(out.map((s) => s.start)).size).toBe(out.length);
  });

  it('no members, or nobody free, gives an empty list', () => {
    expect(freeSlotsAny(input, [])).toEqual([]);
    expect(freeSlotsAny({ ...input, date: '2026-10-27' }, [A, B])).toEqual([]);
  });
});
