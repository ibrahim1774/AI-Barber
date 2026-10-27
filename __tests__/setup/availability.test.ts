import {
  copyToAll, defaultWeek, seedWeek, dayLabel, minutesLabel, rowsToWeek, stepEnd, stepStart, toggleDay, weekProblem, weekToRows,
} from '@/lib/setup/availability';

describe('availability grid', () => {
  it('defaults to Mon-Sat 9-5 (Sunday closed) with weekday 0 = Monday, like the site hours', () => {
    const rows = weekToRows(defaultWeek());
    expect(rows.map((r) => r.weekday)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows[0]).toEqual({ weekday: 0, startMin: 540, endMin: 1020, breakStartMin: null, breakEndMin: null });
  });
  it('round-trips rows, including a break', () => {
    const rows = [{ weekday: 0, startMin: 600, endMin: 1020, breakStartMin: 780, breakEndMin: 840 }];
    const week = rowsToWeek(rows);
    expect(week[0].open).toBe(true);
    expect(week[1].open).toBe(false);
    expect(weekToRows(week)).toEqual(rows);
  });
  it('labels minutes', () => {
    expect(minutesLabel(540)).toBe('9:00 AM');
    expect(minutesLabel(1080)).toBe('6:00 PM');
    expect(minutesLabel(0)).toBe('12:00 AM');
    expect(minutesLabel(1440)).toBe('12:00 AM');
    expect(minutesLabel(750)).toBe('12:30 PM');
    expect(dayLabel(defaultWeek()[6])).toBe('Closed');
    expect(dayLabel(defaultWeek()[0])).toBe('9:00 AM to 5:00 PM');
  });
  it('steps by 30 minutes and never crosses', () => {
    const d = defaultWeek()[1];
    expect(stepStart(d, 1).startMin).toBe(570);
    expect(stepEnd(d, -1).endMin).toBe(990);
    expect(stepStart({ ...d, startMin: 960 }, 5).startMin).toBe(990);
    expect(stepEnd({ ...d, endMin: 1400 }, 5).endMin).toBe(1440);
    expect(stepStart({ ...d, startMin: 0 }, -1).startMin).toBe(0);
  });
  it('drops a break that falls outside the new hours', () => {
    const d = { open: true, startMin: 540, endMin: 1080, breakStartMin: 550, breakEndMin: 600 };
    expect(stepStart(d, 1).breakStartMin).toBeNull();
  });
  it('copies one day to all and validates', () => {
    const w = copyToAll(defaultWeek(), 1);
    expect(w.every((d) => d.open && d.startMin === 540)).toBe(true);
    expect(weekProblem(w)).toBeNull();
    expect(weekProblem(w.map((d) => ({ ...d, open: false })))).toMatch(/at least one day/);
    expect(weekToRows(toggleDay(w, 0))).toHaveLength(6);
  });

  describe('seedWeek (where the Bookings wizard hours start)', () => {
    const site = (hours?: any[]) => ({ shopName: 'x', hours } as any);
    it('no site hours: Mon-Sat 9-5, the same as the site default', () => {
      expect(seedWeek(site())).toEqual(defaultWeek());
      expect(seedWeek(site([]))).toEqual(defaultWeek());
      expect(seedWeek(null)).toEqual(defaultWeek());
      const rows = weekToRows(seedWeek(undefined));
      expect(rows.map((r) => r.weekday)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(rows.every((r) => r.startMin === 540 && r.endMin === 1020)).toBe(true);
    });
    it('the site default hours seed the identical week', () => {
      const { defaultHours } = require('@/lib/sections/hours');
      expect(seedWeek(site(defaultHours()))).toEqual(defaultWeek());
    });
    it('existing site hours win: custom times, closed days, unreadable days', () => {
      const w = seedWeek(site([
        { day: 'Monday', open: '10:00', close: '19:30' },
        { day: 'Tuesday', open: '', close: '', closed: true },
        { day: 'Wednesday', open: 'By appointment', close: '' },
        { day: 'Sunday', open: '12:00', close: '16:00' },
      ]));
      expect(w[0]).toMatchObject({ open: true, startMin: 600, endMin: 1170 });
      expect(w[1].open).toBe(false);
      expect(w[2]).toMatchObject({ open: true, startMin: 540, endMin: 1020 });
      expect(w[3].open).toBe(false);
      expect(w[6]).toMatchObject({ open: true, startMin: 720, endMin: 960 });
    });
  });
});
