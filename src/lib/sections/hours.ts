import type { WebsiteData } from '@/web/types';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export type HoursRow = NonNullable<WebsiteData['hours']>[number];
type Hours = NonNullable<WebsiteData['hours']>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultHours(): Hours {
  return DAYS.map((day) =>
    day === 'Monday' || day === 'Sunday'
      ? { day, open: '09:00', close: '18:00', closed: true }
      : { day, open: '09:00', close: '18:00' },
  );
}

/** '06:00' to '22:00' in 30-minute steps. */
export const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
})();

/** '09:00' becomes '9:00 AM'; anything that isn't 24-hour HH:MM comes back unchanged. */
export function timeLabel(hhmm: string): string {
  if (!HHMM.test(hhmm)) return hhmm;
  const h = Number(hhmm.slice(0, 2));
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${hhmm.slice(3)} ${suffix}`;
}

/** Index in DAYS for a stored day name ('Mon', 'monday', 'Mon.'), or -1. */
function dayIndex(name: string): number {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  if (n.length < 3) return -1;
  return DAYS.findIndex((d) => d.toLowerCase().startsWith(n));
}

const rank = (name: string) => (dayIndex(name) < 0 ? DAYS.length : dayIndex(name));

/** Always 7 rows in DAYS order. Days the data lacks are closed. */
export function editableHours(d: WebsiteData): HoursRow[] {
  const existing = d.hours ?? [];
  return DAYS.map((day, i) => {
    const row = existing.find((r) => dayIndex(r.day) === i);
    if (!row) return { day, open: '09:00', close: '18:00', closed: true };
    return { day, open: row.open, close: row.close, closed: !!row.closed };
  });
}

export interface DayPatch {
  closed?: boolean;
  open?: string;
  close?: string;
}

/** True when both times are 24-hour and the close comes before the open. */
function backwards(r: { open: string; close: string }): boolean {
  return HHMM.test(r.open) && HHMM.test(r.close) && r.close < r.open;
}

/**
 * Changes one day. Only that day's row is rewritten; other rows (including
 * imported ones like 'By appointment') keep their exact strings. Seeds
 * defaultHours() when the site has no hours. A close earlier than the open
 * returns the data unchanged.
 */
export function setDay(d: WebsiteData, day: string, patch: DayPatch): WebsiteData {
  const idx = dayIndex(day);
  if (idx < 0) return d;
  const base: Hours = d.hours && d.hours.length > 0 ? d.hours : defaultHours();
  const pos = base.findIndex((r) => dayIndex(r.day) === idx);
  const cur: HoursRow = pos >= 0 ? base[pos] : { day: DAYS[idx], open: '09:00', close: '18:00', closed: true };
  const next: HoursRow = { ...cur };
  if (patch.open !== undefined) next.open = patch.open;
  if (patch.close !== undefined) next.close = patch.close;
  if (patch.closed !== undefined) {
    if (patch.closed) next.closed = true;
    else delete next.closed;
  }
  if (!next.closed && backwards(next)) return d;
  const rows = pos >= 0 ? base.map((r, i) => (i === pos ? next : r)) : [...base, next];
  if (pos < 0) rows.sort((a, b) => rank(a.day) - rank(b.day));
  return { ...d, hours: rows };
}

/** Copies one open day's times onto every other open day. No-op if that day is closed. */
export function copyDayToOpenDays(d: WebsiteData, from: string): WebsiteData {
  const rows = editableHours(d);
  const src = rows.find((r) => dayIndex(r.day) === dayIndex(from));
  if (!src || src.closed) return d;
  let out = d;
  for (const r of rows) {
    if (r.closed || r.day === src.day) continue;
    out = setDay(out, r.day, { open: src.open, close: src.close });
  }
  return out;
}
