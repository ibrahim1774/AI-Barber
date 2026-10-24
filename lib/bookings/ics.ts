/**
 * iCalendar (RFC 5545) generation for bookings. Pure: no I/O.
 *
 * - Times are written in UTC (`YYYYMMDDTHHMMSSZ`), so no VTIMEZONE block is needed.
 * - TEXT values are escaped (backslash, semicolon, comma, newline).
 * - Content lines are folded at 75 octets (UTF-8 bytes, never splitting a character),
 *   continuation lines start with a single space, and every line ends in CRLF.
 */

export interface IcsEvent {
  uid: string;
  start: string | Date;
  end: string | Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  status?: 'CONFIRMED' | 'CANCELLED' | 'TENTATIVE';
  /** DTSTAMP; defaults to the calendar's `now`. */
  stamp?: string | Date;
  /** Revision number; bump it when the event changes so calendar apps replace the old copy. */
  sequence?: number | null;
}

export interface IcsCalendarOptions {
  /** X-WR-CALNAME, shown by Apple/Google Calendar as the subscription's name. */
  name?: string;
  /** DTSTAMP for events without their own. Defaults to the current time. */
  now?: Date;
}

const CRLF = '\r\n';

/** RFC 5545 §3.3.11 TEXT escaping (other control characters, which TEXT forbids, are dropped). */
export function escapeText(value: string): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** UTC date-time, e.g. 20261024T180000Z. Throws on an invalid date. */
export function formatUtc(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) throw new Error(`ics: invalid date ${String(value)}`);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 §3.1 line folding: at most 75 octets per physical line, excluding the CRLF. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75; // continuation lines carry a leading space, so they hold 74 octets of content
  for (const ch of line) {
    // for..of iterates code points, so surrogate pairs (emoji) stay whole
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join(CRLF + ' ');
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function eventLines(e: IcsEvent, now: Date): string[] {
  const lines = [
    'BEGIN:VEVENT',
    prop('UID', escapeText(e.uid)),
    prop('DTSTAMP', formatUtc(e.stamp ?? now)),
    prop('DTSTART', formatUtc(e.start)),
    prop('DTEND', formatUtc(e.end)),
    prop('SUMMARY', escapeText(e.summary)),
  ];
  if (e.location) lines.push(prop('LOCATION', escapeText(e.location)));
  if (e.description) lines.push(prop('DESCRIPTION', escapeText(e.description)));
  // URI values are not TEXT: no escaping, but strip anything that would break the line.
  if (e.url) lines.push(prop('URL', e.url.replace(/[\r\n]/g, '')));
  if (e.sequence != null && Number.isFinite(e.sequence) && e.sequence >= 0) lines.push(prop('SEQUENCE', String(Math.floor(e.sequence))));
  lines.push(prop('STATUS', e.status ?? 'CONFIRMED'));
  lines.push('END:VEVENT');
  return lines;
}

/** A full VCALENDAR (METHOD:PUBLISH) with CRLF line endings. */
export function buildCalendar(events: IcsEvent[], opts: IcsCalendarOptions = {}): string {
  const now = opts.now ?? new Date();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prime Barber//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (opts.name) {
    lines.push(prop('X-WR-CALNAME', escapeText(opts.name)));
  }
  for (const e of events) lines.push(...eventLines(e, now));
  lines.push('END:VCALENDAR');
  return lines.join(CRLF) + CRLF;
}

// ---------------------------------------------------------------------------
// Bookings-specific wrappers
// ---------------------------------------------------------------------------

/** What the barber's calendar feed needs per appointment (plain shape, not the DB row). */
export interface FeedAppointment {
  id: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  serviceName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  status: 'booked' | 'done' | 'no_show' | 'cancelled';
  /** Last change (ISO); becomes SEQUENCE so subscribed calendars pick up moves and cancellations. */
  updatedAt?: string | null;
}

/** SEQUENCE from a last-modified time: whole seconds since 2026-01-01 (monotonic, fits in int32). */
export function sequenceFrom(updatedAt: string | Date | null | undefined): number | null {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((ms - Date.UTC(2026, 0, 1)) / 1000));
}

export interface FeedOptions {
  /** e.g. "Mike · Fade Factory"; becomes X-WR-CALNAME. */
  calendarName: string;
  /** Shop address, written as each event's LOCATION. */
  location?: string | null;
  now?: Date;
}

export const appointmentUid = (id: string) => `${id}@aibarber.org`;

/**
 * The barber's subscription feed (GET /api/book/ics). Cancelled appointments are kept with
 * STATUS:CANCELLED so calendar apps that already imported them remove/strike them.
 */
export function appointmentsToIcs(appointments: FeedAppointment[], opts: FeedOptions): string {
  const events: IcsEvent[] = appointments.map((a) => {
    const who = a.customerName?.trim();
    const desc = [
      who ? `Customer: ${who}` : null,
      a.customerPhone ? `Phone: ${a.customerPhone}` : null,
      a.note ? `Note: ${a.note}` : null,
      a.status === 'no_show' ? 'No-show' : null,
    ].filter(Boolean).join('\n');
    return {
      uid: appointmentUid(a.id),
      start: a.start,
      end: a.end,
      summary: who ? `${a.serviceName} · ${who}` : a.serviceName,
      description: desc || null,
      location: opts.location ?? null,
      status: a.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
      sequence: sequenceFrom(a.updatedAt),
    };
  });
  return buildCalendar(events, { name: opts.calendarName, now: opts.now });
}

export interface CustomerIcsInput {
  appointmentId: string;
  start: string;
  end: string;
  serviceName: string;
  shopName: string;
  memberName?: string | null;
  address?: string | null;
  manageUrl: string;
  cancelled?: boolean;
  /** Last change (ISO), for SEQUENCE. */
  updatedAt?: string | null;
  now?: Date;
}

/** The single-event .ics attached to the customer's confirmation / reschedule email. */
export function customerAppointmentIcs(i: CustomerIcsInput): string {
  const desc = [
    i.memberName ? `With ${i.memberName}` : null,
    `Manage or cancel: ${i.manageUrl}`,
  ].filter(Boolean).join('\n');
  return buildCalendar(
    [{
      uid: appointmentUid(i.appointmentId),
      start: i.start,
      end: i.end,
      summary: `${i.serviceName} at ${i.shopName}`,
      description: desc,
      location: i.address ?? null,
      url: i.manageUrl,
      status: i.cancelled ? 'CANCELLED' : 'CONFIRMED',
      sequence: sequenceFrom(i.updatedAt),
    }],
    { now: i.now },
  );
}
