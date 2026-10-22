/**
 * Pure date, grouping and formatting logic for the Bookings tab. Every
 * wall-clock value is in the SHOP's timezone (an IANA name), never the
 * phone's: a barber travelling still sees "2:00 PM" as the shop's 2 PM.
 * Built on Intl only (no date library in the app).
 */

export type DateKey = string; // 'YYYY-MM-DD' in the shop's timezone

export type ApptStatus = 'booked' | 'done' | 'no_show' | 'cancelled';
export type PayStatus = 'none' | 'awaiting' | 'deposit' | 'paid' | 'refunded' | 'partially_refunded';

/** The columns of ab_appointments the tab reads (camelCase). */
export interface Appointment {
  id: string;
  shopId: string;
  memberId: string;
  serviceId: string | null;
  start: string; // ISO UTC
  end: string;
  serviceName: string;
  priceCents: number | null;
  durationMin: number;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  note: string | null;
  status: ApptStatus;
  paymentStatus: PayStatus;
  paymentMethod: string | null;
  amountPaidCents: number;
  customerSaysPaidAt: string | null;
  source: 'online' | 'walk_in';
}

export interface TimeOff {
  id: string;
  memberId: string;
  start: string;
  end: string;
  reason: string | null;
}

// ---- timezone maths -------------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface Parts { y: number; m: number; d: number; h: number; min: number }

export function zonedParts(ms: number, tz: string): Parts {
  const o: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, min: o.minute };
}

/** The zone's offset from UTC at an instant, in ms (east positive). */
function offsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const floored = Math.floor(ms / 60000) * 60000;
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - floored;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const makeKey = (y: number, m: number, d: number): DateKey => `${y}-${pad(m)}-${pad(d)}`;

export function parseKey(key: DateKey): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** The shop-local calendar date of an instant. */
export function dayKey(isoOrMs: string | number, tz: string): DateKey {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
  const p = zonedParts(ms, tz);
  return makeKey(p.y, p.m, p.d);
}

export const todayKey = (tz: string, now = Date.now()): DateKey => dayKey(now, tz);

export function addDays(key: DateKey, n: number): DateKey {
  const p = parseKey(key)!;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return makeKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The instant (ms) at `minutes` after local midnight on `key` in `tz`. DST-safe. */
export function zonedToUtc(key: DateKey, minutes: number, tz: string): number {
  const p = parseKey(key)!;
  const guess = Date.UTC(p.y, p.m - 1, p.d, 0, minutes);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return second;
}

/** [start of day, start of next day) as ISO strings; 23 or 25 hours long on DST days. */
export function dayRange(key: DateKey, tz: string): { start: string; end: string } {
  return {
    start: new Date(zonedToUtc(key, 0, tz)).toISOString(),
    end: new Date(zonedToUtc(addDays(key, 1), 0, tz)).toISOString(),
  };
}

/** Local minutes after midnight of an instant. */
export function minutesOfDay(iso: string, tz: string): number {
  const p = zonedParts(Date.parse(iso), tz);
  return p.h * 60 + p.min;
}

// ---- formatting -----------------------------------------------------------

/** '2:00 PM' */
export function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(m)} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function formatTime(iso: string, tz: string): string {
  return formatMinutes(minutesOfDay(iso, tz));
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayOf(key: DateKey): number {
  const p = parseKey(key)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}
export const weekdayShort = (key: DateKey) => WEEKDAYS[weekdayOf(key)];
export const dayOfMonth = (key: DateKey) => parseKey(key)!.d;

/** 'Fri, Oct 24' */
export function formatDay(key: DateKey): string {
  const p = parseKey(key)!;
  return `${weekdayShort(key)}, ${MONTHS[p.m - 1]} ${p.d}`;
}

/** 'Today' / 'Tomorrow' / 'Fri, Oct 24' */
export function dayHeading(key: DateKey, today: DateKey): string {
  if (key === today) return 'Today';
  if (key === addDays(today, 1)) return 'Tomorrow';
  if (key === addDays(today, -1)) return 'Yesterday';
  return formatDay(key);
}

/** 3000 -> "$30", 3050 -> "$30.50", 125000 -> "$1,250" (the same grouping as the other price formatters). */
export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return 'Ask';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.round(Math.abs(cents));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = abs % 100;
  return `${sign}$${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

// ---- grouping -------------------------------------------------------------

/** A booking blocks the calendar unless cancelled. */
export const isLive = (a: Appointment) => a.status !== 'cancelled';

/** One day's live appointments in time order, optionally for one barber. */
export function appointmentsForDay(
  list: Appointment[], key: DateKey, tz: string, memberId: string | null = null,
): Appointment[] {
  return list
    .filter((a) => isLive(a) && dayKey(a.start, tz) === key && (!memberId || a.memberId === memberId))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

/** Time off touching a day (it may start the day before or end the day after). */
export function timeOffForDay(
  list: TimeOff[], key: DateKey, tz: string, memberId: string | null = null,
): TimeOff[] {
  const { start, end } = dayRange(key, tz);
  const s = Date.parse(start), e = Date.parse(end);
  return list
    .filter((t) => Date.parse(t.start) < e && Date.parse(t.end) > s && (!memberId || t.memberId === memberId))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Live appointments per day, for the date strip's dots. */
export function countsByDay(list: Appointment[], tz: string, memberId: string | null = null): Record<DateKey, number> {
  const out: Record<DateKey, number> = {};
  for (const a of list) {
    if (!isLive(a) || (memberId && a.memberId !== memberId)) continue;
    const k = dayKey(a.start, tz);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** The days the strip shows: `back` days before today through `ahead` days after. */
export function stripDays(today: DateKey, back = 14, ahead = 60): DateKey[] {
  const out: DateKey[] = [];
  for (let i = -back; i <= ahead; i++) out.push(addDays(today, i));
  return out;
}

// ---- status chip ----------------------------------------------------------

export type ChipTone = 'neutral' | 'good' | 'warn' | 'bad';
export interface Chip { label: string; tone: ChipTone }

/** Booked / Paid / Deposit / No-show / Done (+ Awaiting for an unconfirmed payment). */
export function statusChip(a: Pick<Appointment, 'status' | 'paymentStatus'>): Chip {
  if (a.status === 'no_show') return { label: 'No-show', tone: 'bad' };
  if (a.status === 'cancelled') return { label: 'Cancelled', tone: 'bad' };
  if (a.status === 'done') return { label: 'Done', tone: 'good' };
  switch (a.paymentStatus) {
    case 'paid': return { label: 'Paid', tone: 'good' };
    case 'deposit': return { label: 'Deposit', tone: 'good' };
    case 'awaiting': return { label: 'Awaiting', tone: 'warn' };
    default: return { label: 'Booked', tone: 'neutral' };
  }
}

/** What the detail sheet offers for an appointment. */
export function availableActions(a: Pick<Appointment, 'status' | 'paymentStatus' | 'paymentMethod' | 'customerPhone'>) {
  const live = a.status === 'booked';
  // Same rule as the server's mark endpoint: card money is Stripe's to record.
  const owed = a.paymentMethod !== 'card' && ['none', 'awaiting', 'deposit'].includes(a.paymentStatus);
  return {
    call: !!digits(a.customerPhone),
    text: !!digits(a.customerPhone),
    markPaid: a.status !== 'cancelled' && a.status !== 'no_show' && owed,
    markDone: live,
    noShow: live,
    reschedule: live,
    cancel: live,
    rebind: a.status === 'done' && !!digits(a.customerPhone),
  };
}

// ---- contact links --------------------------------------------------------

/** Phone number reduced to digits (and a leading +). */
export function digits(phone: string | null | undefined): string {
  const raw = (phone ?? '').trim();
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  return raw.startsWith('+') ? `+${d}` : d;
}

export const telUrl = (phone: string) => `tel:${digits(phone)}`;
export const smsUrl = (phone: string, body?: string) =>
  body ? `sms:${digits(phone)}&body=${encodeURIComponent(body)}` : `sms:${digits(phone)}`;

export const REBOOK_MESSAGE = (link: string) => `Thanks for coming in! Book your next cut: ${link}`;

// ---- pushes & time pickers ------------------------------------------------

/**
 * The day a tapped booking push should open. The push data carries `start`
 * (ISO) or `date` (YYYY-MM-DD); anything else opens on today (null).
 */
export function dateFromPushData(data: unknown, tz: string): DateKey | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.date === 'string' && parseKey(d.date)) return d.date;
  if (typeof d.start === 'string' && !Number.isNaN(Date.parse(d.start))) return dayKey(d.start, tz);
  return null;
}

/** Quarter-hour start times (minutes after midnight) for the pickers, 6:00 AM to 10:00 PM. */
export function timeChoices(from = 6 * 60, to = 22 * 60, step = 15): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
}

/** The next quarter hour at or after now, as minutes after midnight (capped to the day). */
export function nextQuarter(now: number, tz: string): number {
  const p = zonedParts(now, tz);
  return Math.min(23 * 60 + 45, Math.ceil((p.h * 60 + p.min) / 15) * 15);
}

// ---- building instants from picker choices --------------------------------

/** ISO UTC of `minutes` after local midnight on `key` in the shop's timezone. */
export function startIso(key: DateKey, minutes: number, tz: string): string {
  return new Date(zonedToUtc(key, minutes, tz)).toISOString();
}

/**
 * A time-off range from the Block time form: all day = the whole local day,
 * else [from, to) on that date. null when the range is empty or backwards.
 */
export function blockRange(
  key: DateKey, tz: string, allDay: boolean, fromMin: number, toMin: number,
): { start: string; end: string } | null {
  if (allDay) return dayRange(key, tz);
  if (toMin <= fromMin) return null;
  return { start: startIso(key, fromMin, tz), end: startIso(key, toMin, tz) };
}
