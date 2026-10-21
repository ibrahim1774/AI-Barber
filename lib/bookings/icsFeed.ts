// Calendar subscription feed for one barber (GET /api/book/ics?t=<member ics_token>).
// RFC 5545, UTC times, CRLF line endings, long lines folded at 75 octets.
import type { AppointmentRow, MemberRow, ShopRow } from './repo.js';

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line to <= 75 octets per physical line (continuations start with a space). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    const max = out.length === 0 ? 75 : 74;
    if (bytes + n > max) {
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

export function buildIcsFeed(input: { shop: ShopRow; member: MemberRow; appointments: AppointmentRow[]; now: number }): string {
  const { shop, member, appointments, now } = input;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Barber//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(`${shop.name} – ${member.display_name}`)}`,
    `X-WR-TIMEZONE:${icsEscape(shop.timezone)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const a of appointments) {
    if (a.status === 'cancelled') continue;
    const who = a.customer_name || 'Walk-in';
    const desc = [
      a.customer_phone ? `Phone: ${a.customer_phone}` : '',
      a.customer_email ? `Email: ${a.customer_email}` : '',
      a.note ? `Note: ${a.note}` : '',
      a.status === 'no_show' ? 'No-show' : '',
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${a.id}@aibarber.org`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(Date.parse(a.start_at))}`,
      `DTEND:${stamp(Date.parse(a.end_at))}`,
      `SUMMARY:${icsEscape(`${who} – ${a.service_name}`)}`,
    );
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    if (shop.address) lines.push(`LOCATION:${icsEscape(shop.address)}`);
    lines.push('STATUS:CONFIRMED', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
