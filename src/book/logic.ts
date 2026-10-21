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

/** Shown on the details step when payOptions() leaves nothing for the chosen service. */
export const NO_WAY_TO_PAY = "This service can't be booked online right now. Please call the shop.";

/** Stripe's minimum card charge; the server refuses a card booking below it. */
export const CARD_MIN_CENTS = 50;

/** What a card booking for this service would charge: the deposit if there is one, else the price. */
export function cardChargeCents(service: Pick<Service, 'priceCents' | 'depositCents'>): number {
  return service.depositCents || service.priceCents || 0;
}

/**
 * Ways to pay for this shop (and, once picked, this service). A shop with nothing configured
 * still takes bookings, paid in shop (the server agrees: /api/book/shop reports inShop then).
 * Card is dropped for a service whose charge is under Stripe's 50¢ minimum (e.g. an "ask"
 * price with no deposit). That can leave nothing, for a card-only shop: the caller then asks
 * the customer to call the shop rather than offering a choice the server would refuse.
 */
export function payOptions(pay: Shop['pay'], service?: Pick<Service, 'priceCents' | 'depositCents'> | null): PayKind[] {
  const out: PayKind[] = [];
  if (pay.inShop) out.push('shop');
  if (pay.card) out.push('card');
  if (manualMethods(pay.manual).length) out.push('manual');
  const base: PayKind[] = out.length ? out : ['shop'];
  if (service && cardChargeCents(service) < CARD_MIN_CENTS) return base.filter((o) => o !== 'card');
  return base;
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

/* ---------- card checkout return (?checkout=) ---------- */

export type CheckoutReturn = 'success' | 'cancelled' | null;
export function parseCheckout(search: string): CheckoutReturn {
  const v = new URLSearchParams(search).get('checkout');
  return v === 'success' || v === 'cancelled' ? v : null;
}
export const CHECKOUT_POLL_MS = 3000;
export const CHECKOUT_POLL_MAX_MS = 30000;
/** After checkout=success: confirmed once the webhook has moved paymentStatus off 'awaiting'. */
export function paymentConfirmed(paymentStatus: string): boolean {
  return paymentStatus !== 'awaiting';
}
export function shouldKeepPolling(paymentStatus: string, elapsedMs: number): boolean {
  return !paymentConfirmed(paymentStatus) && elapsedMs < CHECKOUT_POLL_MAX_MS;
}
/** Ids for reschedule: prefer the API's, fall back to name matching when absent. */
export function resolveIds(
  a: { serviceId?: string | null; memberId?: string; serviceName: string; memberName: string },
  shop: { services: Service[]; members: Member[] },
): { serviceId: string; memberId: string } | null {
  const serviceId = a.serviceId || shop.services.find((s) => s.name === a.serviceName)?.id;
  if (!serviceId) return null;
  const memberId = a.memberId || shop.members.find((m) => m.name === a.memberName)?.id || 'any';
  return { serviceId, memberId };
}

/* ---------- friendly API error messages ---------- */

export type ErrLike = { status: number; code: string; field?: string; serverMessage?: string };

export const RATE_LIMITED_FALLBACK = 'Too many bookings right now. Please try again in a few minutes.';

/** Plain-words message for a failed booking create, or null when the caller has special handling (paused, slot-taken). */
export function bookingErrorMessage(e: ErrLike): string {
  if (e.status === 429 || e.code === 'rate-limited') return e.serverMessage?.trim() || RATE_LIMITED_FALLBACK;
  if (e.status === 409 && e.code === 'duplicate') return 'You already have a booking at that time. Check your email for the manage link.';
  if (e.status === 409) return 'Sorry, that time was just taken.';
  if (e.status === 400 && e.field === 'method') return 'Please choose how you want to send payment.';
  if (e.status === 400) return `Please check your ${e.field || 'details'}.`;
  if (e.status === 404) return 'This shop is no longer available.';
  return 'Something went wrong. Please try again.';
}

/** Plain-words message for a failed reschedule. */
export function rescheduleErrorMessage(e: ErrLike): string {
  if (e.status === 409 && e.code === 'duplicate') return 'You already have a booking at that time.';
  if (e.status === 409 && e.code === 'appointment-changed') return 'This booking was just changed. Reload to see the latest.';
  if (e.status === 409) return 'Sorry, that time was just taken.';
  if (e.status === 403) return "It's too late to reschedule online. Please call the shop.";
  if (e.status === 423) return 'Bookings are paused for now \u2014 call the shop.';
  if (e.status === 429) return 'Too many tries. Wait a minute and try again.';
  return 'Something went wrong. Please try again.';
}

/** Plain-words message for a failed "I've sent it". */
export function sentErrorMessage(e: ErrLike | null): string {
  if (e && e.status === 409 && e.code === 'not-awaiting-payment') return "This booking doesn't need a payment sent.";
  return "Couldn't record that. Try again.";
}
