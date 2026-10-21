import { DateTime } from 'luxon';

/**
 * Free-slot engine for bookings. Pure: no I/O, no host-time-zone dependence.
 *
 * Model:
 * - Availability rows are wall-clock minutes after local midnight in the shop's IANA zone
 *   (weekday 0 = Monday ... 6 = Sunday), exactly as stored in `ab_availability`.
 * - Candidate starts are generated on the wall clock: open, open + step, ... A wall time that
 *   does not exist (spring-forward gap) is skipped. An ambiguous wall time (fall-back hour)
 *   is used once, at its first occurrence (the earlier instant, i.e. daylight time).
 * - Every fit/overlap check is done on absolute instants (epoch ms), half-open [start, end).
 *   The slot end is start + durationMin of real elapsed time, so on DST days a slot never
 *   runs past close or into a break even though the day is 23 or 25 hours long.
 */

export interface AvailabilityRow {
  weekday: number; // 0 = Monday ... 6 = Sunday
  start_min: number; // minutes after local midnight (0..1440)
  end_min: number;
  break_start_min?: number | null;
  break_end_min?: number | null;
}

export interface TimeRange {
  start: string; // ISO 8601 instant (any offset)
  end: string;
}

export interface SlotInput {
  timezone: string; // IANA, e.g. 'America/New_York'
  date: string; // 'YYYY-MM-DD', shop-local
  availability: AvailabilityRow[];
  timeOff: TimeRange[];
  busy: TimeRange[]; // existing non-cancelled appointments
  durationMin: number;
  bufferMin?: number; // default 0
  stepMin?: number | null; // default durationMin
  minNoticeMin?: number; // default 0
  leadDays?: number; // default: no limit
  now: string; // ISO 8601 instant
}

export interface MemberSchedule {
  id: string;
  availability: AvailabilityRow[];
  timeOff: TimeRange[];
  busy: TimeRange[];
}

export interface AnySlot {
  start: string;
  memberId: string;
}

const MIN = 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseInstant(s: string, what: string): number {
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new Error(`slots: invalid ${what} '${s}'`);
  return ms;
}

/** The local calendar date as a UTC-anchored DateTime (pure date arithmetic, zone-free). */
function calendarDate(date: string): DateTime {
  if (!DATE_RE.test(date)) throw new Error(`slots: invalid date '${date}'`);
  const d = DateTime.fromISO(date, { zone: 'utc' });
  if (!d.isValid) throw new Error(`slots: invalid date '${date}'`);
  return d;
}

/**
 * Wall-clock minute `m` (may be 1440 = next local midnight) on `day` in `zone`.
 * Returns the instant, or null when that wall time does not exist (DST gap).
 * Ambiguous wall times resolve to their first occurrence (luxon's behaviour, pinned by tests).
 */
function wallToInstant(day: DateTime, m: number, zone: string): number | null {
  const w = day.plus({ minutes: m }); // wall components, carried over midnight if needed
  const dt = DateTime.fromObject(
    { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute },
    { zone },
  );
  if (!dt.isValid) return null;
  // luxon silently shifts a non-existent time forward; detect that by round-tripping.
  if (dt.year !== w.year || dt.month !== w.month || dt.day !== w.day || dt.hour !== w.hour || dt.minute !== w.minute) {
    return null;
  }
  return dt.toMillis();
}

/**
 * Like wallToInstant, for window/break boundaries: a boundary inside a DST gap maps to the
 * transition instant (the first wall minute after the gap), which keeps the wall->instant
 * mapping monotonic.
 */
function boundaryInstant(day: DateTime, m: number, zone: string): number {
  for (let k = m; k <= m + 24 * 60; k++) {
    const t = wallToInstant(day, k, zone);
    if (t != null) return t;
  }
  throw new Error(`slots: cannot resolve wall minute ${m} in ${zone}`);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** ISO UTC start times ('...Z') free for one member on one shop-local date, ascending. */
export function freeSlots(input: SlotInput): string[] {
  const { timezone: zone, durationMin } = input;
  if (!DateTime.local().setZone(zone).isValid) throw new Error(`slots: invalid timezone '${zone}'`);
  if (!(Number.isFinite(durationMin) && durationMin > 0)) return [];
  const step = input.stepMin != null && Number.isFinite(input.stepMin) && input.stepMin > 0 ? input.stepMin : durationMin;
  const buffer = Math.max(0, input.bufferMin ?? 0) * MIN;
  const nowMs = parseInstant(input.now, 'now');
  const earliest = nowMs + Math.max(0, input.minNoticeMin ?? 0) * MIN;

  // Lead-day window, in shop-local calendar days: 0 (today) .. leadDays inclusive.
  const day = calendarDate(input.date);
  const today = calendarDate(DateTime.fromMillis(nowMs, { zone }).toISODate()!);
  const offsetDays = Math.round(day.diff(today, 'days').days);
  if (offsetDays < 0) return [];
  if (input.leadDays != null && offsetDays > input.leadDays) return [];

  const weekday = day.weekday - 1; // luxon: 1 = Monday
  const rows = input.availability.filter((r) => r.weekday === weekday);
  if (rows.length === 0) return [];

  // Existing appointments carry their own buffer after them; the new slot carries one too.
  const busy = input.busy.map((b) => [parseInstant(b.start, 'busy.start'), parseInstant(b.end, 'busy.end') + buffer] as const);
  const off = input.timeOff.map((t) => [parseInstant(t.start, 'timeOff.start'), parseInstant(t.end, 'timeOff.end')] as const);

  const out = new Set<number>();
  for (const r of rows) {
    if (!(r.end_min > r.start_min)) continue;
    const close = boundaryInstant(day, r.end_min, zone);
    const hasBreak = r.break_start_min != null && r.break_end_min != null && r.break_end_min > r.break_start_min;
    const brStart = hasBreak ? boundaryInstant(day, r.break_start_min!, zone) : 0;
    const brEnd = hasBreak ? boundaryInstant(day, r.break_end_min!, zone) : 0;

    for (let m = r.start_min; m < r.end_min; m += step) {
      const start = wallToInstant(day, m, zone);
      if (start == null) continue; // wall time skipped by spring-forward
      const end = start + durationMin * MIN;
      if (end > close) continue;
      if (hasBreak && overlaps(start, end, brStart, brEnd)) continue;
      if (start < earliest) continue;
      const padded = end + buffer;
      if (busy.some(([s, e]) => overlaps(start, padded, s, e))) continue;
      if (off.some(([s, e]) => overlaps(start, padded, s, e))) continue;
      out.add(start);
    }
  }
  return [...out].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());
}

/**
 * "Any available": union of every member's free slots by start time. When several members
 * are free at the same start, the first one in `members` order wins. Ascending by start.
 */
export function freeSlotsAny(
  input: Omit<SlotInput, 'availability' | 'timeOff' | 'busy'>,
  members: MemberSchedule[],
): AnySlot[] {
  const byStart = new Map<string, string>();
  for (const m of members) {
    const slots = freeSlots({ ...input, availability: m.availability, timeOff: m.timeOff, busy: m.busy });
    for (const s of slots) if (!byStart.has(s)) byStart.set(s, m.id);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([start, memberId]) => ({ start, memberId }));
}
