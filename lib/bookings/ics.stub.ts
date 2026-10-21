// Placeholder for S2's lib/bookings/ics.ts, so the calendar feed works on this branch.
// Same appointmentsToIcs signature as S2's file (plain camelCase input, not DB rows).
// Swap the import in ./deps.ts to './ics.js' once S2's branch is merged.

export interface FeedAppointment {
  id: string;
  start: string; // ISO UTC
  end: string; // ISO UTC
  serviceName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  status: 'booked' | 'done' | 'no_show' | 'cancelled';
}

export interface FeedOptions {
  calendarName: string;
  location?: string | null;
  now?: Date;
}

const stamp = (iso: string | Date) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function appointmentsToIcs(appointments: FeedAppointment[], opts: FeedOptions): string {
  const now = opts.now ?? new Date();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Barber//Bookings//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(opts.calendarName)}`];
  for (const a of appointments) {
    const desc = [a.customerPhone ? `Phone: ${a.customerPhone}` : '', a.note ? `Note: ${a.note}` : '']
      .filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${a.id}@aibarber.org`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(a.start)}`,
      `DTEND:${stamp(a.end)}`, `SUMMARY:${esc(a.customerName?.trim() ? `${a.serviceName} · ${a.customerName.trim()}` : a.serviceName)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    if (opts.location) lines.push(`LOCATION:${esc(opts.location)}`);
    lines.push(`STATUS:${a.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
