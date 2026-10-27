import type { WebsiteData } from '@/web/types';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export type HoursRow = NonNullable<WebsiteData['hours']>[number];
type Hours = NonNullable<WebsiteData['hours']>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Monday to Saturday 9:00 AM to 5:00 PM, Sunday closed: where every new site's hours start. */
export function defaultHours(): Hours {
  return DAYS.map((day) =>
    day === 'Sunday'
      ? { day, open: '09:00', close: '17:00', closed: true }
      : { day, open: '09:00', close: '17:00' },
  );
}

/** True when the site has no hours rows at all. */
export const hasNoHours = (d: WebsiteData): boolean => !d.hours || d.hours.length === 0;

/** Seeds the default week when (and only when) the site has no hours; imported or edited hours are never touched. */
export function withDefaultHours(d: WebsiteData): WebsiteData {
  return hasNoHours(d) ? { ...d, hours: defaultHours() } : d;
}

/** Sections row subtitle: 'Add' with no hours, else 'Mon-Sat 9:00 AM - 5:00 PM' (or 'N days open' when the days differ). */
export function hoursSummary(d: WebsiteData): string {
  if (hasNoHours(d)) return 'Add';
  const open = editableHours(d).filter((r) => !r.closed);
  if (open.length === 0) return 'Closed every day';
  const first = open[0];
  const same = open.every((r) => r.open === first.open && r.close === first.close);
  const idx = open.map((r) => DAYS.indexOf(r.day as (typeof DAYS)[number]));
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const short = (n: number) => DAYS[n].slice(0, 3);
  const range = open.length === 1 ? short(idx[0]) : consecutive ? `${short(idx[0])}-${short(idx[idx.length - 1])}` : '';
  if (same && range) return `${range} ${timeLabel(first.open)} - ${timeLabel(first.close)}`;
  return `Open ${open.length} ${open.length === 1 ? 'day' : 'days'}`;
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
  const existing = hasNoHours(d) ? defaultHours() : d.hours!;
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
