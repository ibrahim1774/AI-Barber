import type { AvailabilityRow } from '@/lib/shop';

export type DayHours = { open: boolean; startMin: number; endMin: number; breakStartMin: number | null; breakEndMin: number | null };

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const STEP_MIN = 30;

const closedDay = (): DayHours => ({ open: false, startMin: 9 * 60, endMin: 18 * 60, breakStartMin: null, breakEndMin: null });

/** Tue–Sat 9:00–18:00 (weekday 0 = Monday), matching /api/shop/setup. */
export function defaultWeek(): DayHours[] {
  return WEEKDAYS.map((_, i) => ({ ...closedDay(), open: i >= 1 && i <= 5 }));
}

/** Rows (one per open day) to the 7-day grid. */
export function rowsToWeek(rows: AvailabilityRow[]): DayHours[] {
  const week = WEEKDAYS.map(closedDay);
  for (const r of rows) {
    if (r.weekday < 0 || r.weekday > 6) continue;
    week[r.weekday] = {
      open: true, startMin: r.startMin, endMin: r.endMin, breakStartMin: r.breakStartMin, breakEndMin: r.breakEndMin,
    };
  }
  return week;
}

/** The grid to rows: closed days produce none. */
export function weekToRows(week: DayHours[]): AvailabilityRow[] {
  const rows: AvailabilityRow[] = [];
  week.forEach((d, weekday) => {
    if (!d.open) return;
    rows.push({ weekday, startMin: d.startMin, endMin: d.endMin, breakStartMin: d.breakStartMin, breakEndMin: d.breakEndMin });
  });
  return rows;
}

/** 540 -> "9:00 AM", 1080 -> "6:00 PM", 0 -> "12:00 AM", 1440 -> "12:00 AM". */
export function minutesLabel(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function dayLabel(d: DayHours): string {
  return d.open ? `${minutesLabel(d.startMin)} to ${minutesLabel(d.endMin)}` : 'Closed';
}

/** Moves the opening time by `delta` steps, always leaving at least one step before closing. */
export function stepStart(d: DayHours, steps: number): DayHours {
  const startMin = Math.min(Math.max(0, d.startMin + steps * STEP_MIN), d.endMin - STEP_MIN);
  return clearBreakIfOutside({ ...d, startMin });
}

/** Moves the closing time (max midnight, 1440). */
export function stepEnd(d: DayHours, steps: number): DayHours {
  const endMin = Math.max(Math.min(1440, d.endMin + steps * STEP_MIN), d.startMin + STEP_MIN);
  return clearBreakIfOutside({ ...d, endMin });
}

function clearBreakIfOutside(d: DayHours): DayHours {
  if (d.breakStartMin == null || d.breakEndMin == null) return d;
  const ok = d.breakStartMin >= d.startMin && d.breakEndMin <= d.endMin && d.breakEndMin > d.breakStartMin;
  return ok ? d : { ...d, breakStartMin: null, breakEndMin: null };
}

export function toggleDay(week: DayHours[], i: number): DayHours[] {
  return week.map((d, k) => (k === i ? { ...d, open: !d.open } : d));
}

export function setDay(week: DayHours[], i: number, d: DayHours): DayHours[] {
  return week.map((x, k) => (k === i ? d : x));
}

/** Copies day `i` (open flag and times) onto every day. */
export function copyToAll(week: DayHours[], i: number): DayHours[] {
  const src = week[i];
  return week.map(() => ({ ...src }));
}

/** A valid grid: at least one open day, and each open day opens before it closes. */
export function weekProblem(week: DayHours[]): string | null {
  if (!week.some((d) => d.open)) return 'Open at least one day, or customers will have nothing to book.';
  if (week.some((d) => d.open && d.endMin <= d.startMin)) return 'Each day must close after it opens.';
  return null;
}
