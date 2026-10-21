import { describe, it, expect } from 'vitest';
import { escapeText, formatUtc, foldLine, buildCalendar, appointmentsToIcs, customerAppointmentIcs } from '../../lib/bookings/ics.js';

const bytes = (s: string) => new TextEncoder().encode(s).length;
const unfold = (s: string) => s.replace(/\r\n /g, '');

describe('ics', () => {
  it('escapes TEXT per RFC 5545', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('formats UTC date-times', () => {
    expect(formatUtc('2026-10-24T14:00:00-04:00')).toBe('20261024T180000Z');
    expect(formatUtc(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 678)))).toBe('20260102T030405Z');
    expect(() => formatUtc('nope')).toThrow();
  });

  it('folds at 75 octets without splitting multi-byte characters', () => {
    const line = 'DESCRIPTION:' + 'Fade 💈 with José ñ '.repeat(12);
    const folded = foldLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    physical.forEach((l, i) => {
      expect(bytes(l)).toBeLessThanOrEqual(75);
      if (i > 0) expect(l.startsWith(' ')).toBe(true);
      expect(l).not.toMatch(/�/);
    });
    expect(unfold(folded)).toBe(line);
    expect(foldLine('SHORT:x')).toBe('SHORT:x');
  });

  it('builds a CRLF calendar with required properties', () => {
    const ics = buildCalendar([{ uid: 'u1@x', start: '2026-10-24T18:00:00Z', end: '2026-10-24T18:30:00Z', summary: 'Cut, shave; done' }],
      { name: 'Mike', now: new Date('2026-10-01T00:00:00Z') });
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    for (const p of ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Barber//Bookings//EN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mike',
      'BEGIN:VEVENT', 'UID:u1@x', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261024T180000Z', 'DTEND:20261024T183000Z',
      'SUMMARY:Cut\\, shave\\; done', 'STATUS:CONFIRMED', 'END:VEVENT']) {
      expect(ics).toContain(p + '\r\n');
    }
  });

  it('appointmentsToIcs: feed events, cancelled kept as CANCELLED', () => {
    const ics = appointmentsToIcs([
      { id: 'a1', start: '2026-10-24T18:00:00Z', end: '2026-10-24T18:30:00Z', serviceName: 'Fade', customerName: 'Sam', customerPhone: '+1 555', note: 'line\nup', status: 'booked' },
      { id: 'a2', start: '2026-10-25T18:00:00Z', end: '2026-10-25T18:30:00Z', serviceName: 'Beard', status: 'cancelled' },
    ], { calendarName: 'Mike · Fade Factory', location: '1 Main St, NYC', now: new Date('2026-10-01T00:00:00Z') });
    const u = unfold(ics);
    expect(u).toContain('UID:a1@aibarber.org');
    expect(u).toContain('SUMMARY:Fade · Sam');
    expect(u).toContain('DESCRIPTION:Customer: Sam\\nPhone: +1 555\\nNote: line\\nup');
    expect(u).toContain('LOCATION:1 Main St\\, NYC');
    expect(u).toMatch(/UID:a2@aibarber.org[\s\S]*SUMMARY:Beard[\s\S]*STATUS:CANCELLED/);
    expect(u.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it('customerAppointmentIcs: one event with the manage link', () => {
    const u = unfold(customerAppointmentIcs({
      appointmentId: 'a1', start: '2026-10-24T18:00:00Z', end: '2026-10-24T18:30:00Z', serviceName: 'Fade', shopName: 'Fade Factory',
      memberName: 'Mike', address: '1 Main St', manageUrl: 'https://www.aibarber.org/book/manage/tok', now: new Date('2026-10-01T00:00:00Z'),
    }));
    expect(u).toContain('SUMMARY:Fade at Fade Factory');
    expect(u).toContain('URL:https://www.aibarber.org/book/manage/tok');
    expect(u).toContain('DESCRIPTION:With Mike\\nManage or cancel: https://www.aibarber.org/book/manage/tok');
  });
});
