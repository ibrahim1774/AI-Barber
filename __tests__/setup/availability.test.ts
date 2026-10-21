import {
  copyToAll, defaultWeek, dayLabel, minutesLabel, rowsToWeek, stepEnd, stepStart, toggleDay, weekProblem, weekToRows,
} from '@/lib/setup/availability';

describe('availability grid', () => {
  it('defaults to Tue-Sat 9-6 with weekday 0 = Monday', () => {
    const rows = weekToRows(defaultWeek());
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toEqual({ weekday: 1, startMin: 540, endMin: 1080, breakStartMin: null, breakEndMin: null });
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
    expect(dayLabel(defaultWeek()[0])).toBe('Closed');
    expect(dayLabel(defaultWeek()[1])).toBe('9:00 AM to 6:00 PM');
  });
  it('steps by 30 minutes and never crosses', () => {
    const d = defaultWeek()[1];
    expect(stepStart(d, 1).startMin).toBe(570);
    expect(stepEnd(d, -1).endMin).toBe(1050);
    expect(stepStart({ ...d, startMin: 1050 }, 5).startMin).toBe(1050);
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
});
