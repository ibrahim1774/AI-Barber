import { DateTime } from 'luxon';
import type { ManualHandles, ManualMethod, Member, Service, Shop } from './types';

/* ---------- routing ---------- */

export type Route =
  | { kind: 'book'; slug: string }
  | { kind: 'manage'; token: string }
  | { kind: 'none' };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'book' || !parts[1]) return { kind: 'none' };
  if (parts[1] === 'manage') {
    return parts[2] ? { kind: 'manage', token: decodeURIComponent(parts[2]) } : { kind: 'none' };
  }
  return { kind: 'book', slug: decodeURIComponent(parts[1]) };
}

export function tokenFromManageUrl(url: string): string {
  const m = /\/book\/manage\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : '';
}

/* ---------- money ---------- */

export function formatMoney(cents: number | null | undefined): string {
  if (cents == null) return '';
  const d = cents / 100;
  return Number.isInteger(d) ? `$${d}` : `$${d.toFixed(2)}`;
}

export function amountDecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Amount a manual payment should cover: the deposit if there is one, else the full price. */
export function manualAmountCents(priceCents: number | null, depositCents: number): number | null {
  if (depositCents > 0) return depositCents;
  return priceCents;
}

/* ---------- time, always in the SHOP's timezone ---------- */

export function inZone(iso: string, tz: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
}
export function formatTime(iso: string, tz: string): string {
  return inZone(iso, tz).toFormat('h:mm a');
}
export function formatDay(iso: string, tz: string): string {
  return inZone(iso, tz).toFormat('EEE, MMM d');
}
export function formatDayLong(iso: string, tz: string): string {
  return inZone(iso, tz).toFormat('EEEE, MMMM d');
}
export function formatWhen(iso: string, tz: string): string {
  return `${formatDay(iso, tz)} at ${formatTime(iso, tz)}`;
}
export function tzAbbrev(iso: string, tz: string): string {
  return inZone(iso, tz).toFormat('ZZZZ');
}
export function dateKey(iso: string, tz: string): string {
  return inZone(iso, tz).toFormat('yyyy-MM-dd');
}
export function todayKey(tz: string, now: DateTime = DateTime.now()): string {
  return now.setZone(tz).toFormat('yyyy-MM-dd');
}
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}
export function shiftMonth(month: string, delta: number): string {
  return DateTime.fromFormat(month + '-01', 'yyyy-MM-dd', { zone: 'utc' }).plus({ months: delta }).toFormat('yyyy-MM');
}
export function monthLabel(month: string): string {
  return DateTime.fromFormat(month + '-01', 'yyyy-MM-dd', { zone: 'utc' }).toFormat('MMMM yyyy');
}

export type DayCell = { date: string; day: number; enabled: boolean } | null;

/** Month grid, weeks start Sunday. Null cells are padding. A day is enabled only if the API listed it and it is not in the past. */
export function monthGrid(month: string, days: Record<string, boolean>, today: string): DayCell[] {
  const first = DateTime.fromFormat(month + '-01', 'yyyy-MM-dd', { zone: 'utc' });
  const lead = first.weekday % 7; // Sunday = 0
  const cells: DayCell[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= first.daysInMonth!; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    cells.push({ date, day: d, enabled: !!days[date] && date >= today });
  }
  return cells;
}

/* ---------- deep links for manual payment ---------- */

const clean = (h: string) => h.trim().replace(/^https?:\/\/(www\.)?/i, '');

export function cashAppLink(handle: string, cents: number | null): string {
  const tag = clean(handle).replace(/^cash\.app\//i, '').replace(/^\$/, '').split(/[/?#]/)[0];
  const base = `https://cash.app/$${encodeURIComponent(tag)}`;
  return cents && cents > 0 ? `${base}/${amountDecimal(cents)}` : base;
}

export function venmoLink(handle: string, cents: number | null, note = ''): string {
  const user = clean(handle).replace(/^(account\.)?venmo\.com\/(u\/)?/i, '').replace(/^@/, '').split(/[/?#]/)[0];
  const p = new URLSearchParams({ txn: 'pay' });
  if (cents && cents > 0) p.set('amount', amountDecimal(cents));
  if (note) p.set('note', note);
  return `https://venmo.com/${encodeURIComponent(user)}?${p.toString()}`;
}

export function paypalLink(handle: string, cents: number | null): string {
  const name = clean(handle).replace(/^paypal\.(me|com\/paypalme)\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  const base = `https://paypal.me/${encodeURIComponent(name)}`;
  return cents && cents > 0 ? `${base}/${amountDecimal(cents)}USD` : base;
}

export const METHOD_LABEL: Record<ManualMethod, string> = {
  cashapp: 'Cash App',
  venmo: 'Venmo',
  zelle: 'Zelle',
  paypal: 'PayPal',
};

export function manualMethods(manual: ManualHandles): ManualMethod[] {
  return (['cashapp', 'venmo', 'zelle', 'paypal'] as ManualMethod[]).filter((m) => !!manual[m]?.trim());
}

/** Deep link for a method, or null where none exists (Zelle: copy the handle). */
export function manualLink(method: ManualMethod, handle: string, cents: number | null, note = ''): string | null {
  switch (method) {
    case 'cashapp': return cashAppLink(handle, cents);
    case 'venmo': return venmoLink(handle, cents, note);
    case 'paypal': return paypalLink(handle, cents);
    default: return null;
  }
}

/* ---------- accent colour ---------- */

export const DEFAULT_ACCENT = '#c9a24b';

export function safeAccent(accent: string | null | undefined): string {
  if (!accent) return DEFAULT_ACCENT;
  const a = accent.trim();
  if (/^#[0-9a-f]{6}$/i.test(a)) return a;
  if (/^#[0-9a-f]{3}$/i.test(a)) return '#' + a.slice(1).split('').map((c) => c + c).join('');
  return DEFAULT_ACCENT;
}

/** Black or white, whichever reads better on the accent. */
export function onAccent(hex: string): string {
  const n = parseInt(safeAccent(hex).slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? '#111111' : '#ffffff';
}

/* ---------- step state machine ---------- */

export type Step = 'service' | 'barber' | 'day' | 'time' | 'details' | 'payment' | 'confirmed';
export type StepCtx = {
  /** Barbers who can do the chosen service. */
  barberCount: number;
  /** Number of ways to pay at booking time (in shop, card, manual). */
  payOptionCount: number;
};

export function eligibleMembers(members: Member[], serviceId: string | null): Member[] {
  if (!serviceId) return members;
  return members.filter((m) => m.serviceIds == null || m.serviceIds.includes(serviceId));
}

export function payOptions(pay: Shop['pay']): PayKind[] {
  const out: PayKind[] = [];
  if (pay.inShop) out.push('shop');
  if (pay.card) out.push('card');
  if (manualMethods(pay.manual).length) out.push('manual');
  // A shop with nothing configured still takes bookings, paid in shop.
  return out.length ? out : ['shop'];
}
type PayKind = 'shop' | 'card' | 'manual';

export function nextStep(step: Step, ctx: StepCtx): Step {
  switch (step) {
    case 'service': return ctx.barberCount > 1 ? 'barber' : 'day';
    case 'barber': return 'day';
    case 'day': return 'time';
    case 'time': return 'details';
    case 'details': return ctx.payOptionCount > 1 ? 'payment' : 'confirmed';
    case 'payment': return 'confirmed';
    default: return 'confirmed';
  }
}

export function prevStep(step: Step, ctx: StepCtx): Step {
  switch (step) {
    case 'barber': return 'service';
    case 'day': return ctx.barberCount > 1 ? 'barber' : 'service';
    case 'time': return 'day';
    case 'details': return 'time';
    case 'payment': return 'details';
    default: return step;
  }
}

export const STEP_ORDER: Step[] = ['service', 'barber', 'day', 'time', 'details', 'payment'];

/** Progress as 1-based index among the steps this customer will actually see. */
export function progress(step: Step, ctx: StepCtx): { index: number; total: number } {
  const seen = STEP_ORDER.filter((s) => (s !== 'barber' || ctx.barberCount > 1) && (s !== 'payment' || ctx.payOptionCount > 1));
  const i = seen.indexOf(step);
  return { index: i < 0 ? seen.length : i + 1, total: seen.length };
}

/* ---------- calendar / directions ---------- */

const icsStamp = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' }).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

export function buildIcs(a: { id: string; start: string; end: string; summary: string; location?: string | null; description?: string }): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Barber//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.id}@aibarber.org`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(a.start)}`,
    `DTEND:${icsStamp(a.end)}`,
    `SUMMARY:${icsEscape(a.summary)}`,
  ];
  if (a.location) lines.push(`LOCATION:${icsEscape(a.location)}`);
  if (a.description) lines.push(`DESCRIPTION:${icsEscape(a.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function telUrl(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function serviceLabel(s: Service): string {
  return [formatMoney(s.priceCents), `${s.durationMin} min`].filter(Boolean).join(' · ');
}
