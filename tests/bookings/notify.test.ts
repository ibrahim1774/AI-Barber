import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notify, runReminders, runDailySummary, shortWhen, dollars,
  type NotifyContext, type NotifyDeps, type ReminderDeps, type DailySummaryDeps,
} from '../../lib/bookings/notify.js';

// Fri 2026-10-23 14:00 New York = 18:00Z
const ctx = (over: Partial<NotifyContext['appt']> = {}, shopOver: Partial<NotifyContext['shop']> = {}): NotifyContext => ({
  appt: {
    id: 'appt-1', shop_id: 'shop-1', member_id: 'm1', start_at: '2026-10-23T18:00:00Z', end_at: '2026-10-23T18:30:00Z',
    service_name: 'Fade', price_cents: 3000, customer_name: 'Sam <b>', customer_email: 'sam@example.com',
    status: 'booked', cancelled_by: null, payment_status: 'none', payment_method: 'shop',
    amount_paid_cents: 0, amount_refunded_cents: 0, manage_token: 'tok_abc', source: 'online', ...over,
  },
  shop: { id: 'shop-1', name: 'Fade Factory', slug: 'fade-factory', timezone: 'America/New_York', owner_id: 'owner-1', address: '1 Main St', ...shopOver },
  memberName: 'Mike',
  memberUserId: null,
  ownerEmail: 'owner@example.com',
});

function mkDeps(c: NotifyContext | null = ctx()): NotifyDeps & { sendEmail: any; push: any } {
  return {
    loadContext: vi.fn(async () => c),
    sendEmail: vi.fn(async () => 'sent' as const),
    push: vi.fn(async () => ({})),
    now: () => Date.UTC(2026, 9, 21, 12),
  };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

const DATA = { kind: 'booking', appointmentId: 'appt-1', start: '2026-10-23T18:00:00.000Z' };

describe('formatting', () => {
  it('shop-local short time and dollars', () => {
    expect(shortWhen('2026-10-23T18:00:00Z', 'America/New_York')).toBe('Fri 2:00 PM');
    expect(dollars(3000)).toBe('$30');
    expect(dollars(2550)).toBe('$25.50');
  });
});

describe('notify', () => {
  it('booking_created: push copy + data, confirmation email with .ics, manage link and escaping', async () => {
    const d = mkDeps();
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d);
    expect(d.push).toHaveBeenCalledWith(['owner-1'], { body: 'New booking: Sam <b>, Fade, Fri 2:00 PM', data: DATA });
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.to).toBe('sam@example.com');
    expect(m.fromName).toBe('Fade Factory via AI Barber');
    expect(m.replyTo).toBe('owner@example.com');
    expect(m.subject).toBe("You're booked at Fade Factory: Friday, October 23 at 2:00 PM");
    expect(m.html).toContain('https://www.aibarber.org/book/manage/tok_abc');
    expect(m.attachments[0].filename).toBe('booking.ics');
    expect(m.attachments[0].content).toContain('DTSTART:20261023T180000Z');
    expect(m.attachments[0].contentType).toMatch(/^text\/calendar/);
  });

  it('booking_created: escapes customer-supplied text in HTML', async () => {
    const d = mkDeps(ctx({ service_name: '<script>x</script>' }));
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d);
    const html = d.sendEmail.mock.calls[0][0].html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('booking_created: skipped for an unpaid card hold (the webhook confirms later)', async () => {
    const d = mkDeps(ctx({ payment_method: 'card', payment_status: 'awaiting' }));
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('booking_created: walk-ins get no owner push; no email without an address; barber with an account is pushed too', async () => {
    const c = ctx({ source: 'walk_in', customer_email: null });
    const d = mkDeps(c);
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
    const d2 = mkDeps({ ...ctx(), memberUserId: 'barber-1' });
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d2);
    expect(d2.push.mock.calls[0][0]).toEqual(['owner-1', 'barber-1']);
  });

  it('booking_cancelled by customer: push + email with refund line', async () => {
    const d = mkDeps(ctx({ status: 'cancelled', cancelled_by: 'customer' }));
    await notify({ kind: 'booking_cancelled', appointmentId: 'appt-1', by: 'customer', refundedCents: 3000 }, d);
    expect(d.push).toHaveBeenCalledWith(['owner-1'], { body: 'Cancelled: Sam <b>, Fri 2:00 PM', data: DATA });
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.html).toContain('A refund of $30');
    expect(m.subject).toMatch(/^Cancelled: Fade at Fade Factory/);
    // cancelled .ics with the same UID removes it from the customer's calendar
    expect(m.attachments[0].content).toContain('UID:appt-1@aibarber.org');
    expect(m.attachments[0].content).toContain('STATUS:CANCELLED');
  });

  it('booking_cancelled by shop: email (with rebook link), no push to the shop', async () => {
    const d = mkDeps(ctx({ status: 'cancelled', cancelled_by: 'shop' }));
    await notify({ kind: 'booking_cancelled', appointmentId: 'appt-1', by: 'shop' }, d);
    expect(d.push).not.toHaveBeenCalled();
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.html).toContain('Fade Factory had to cancel');
    expect(m.html).toContain('https://www.aibarber.org/book/fade-factory');
    expect(m.html).not.toContain('refund');
  });

  it('booking_rescheduled: push with arrow copy and new start; email with .ics', async () => {
    const d = mkDeps(ctx({ start_at: '2026-10-24T15:00:00Z', end_at: '2026-10-24T15:30:00Z' }));
    await notify({ kind: 'booking_rescheduled', appointmentId: 'appt-1' }, d);
    expect(d.push).toHaveBeenCalledWith(['owner-1'], {
      body: 'Rescheduled: Sam <b> → Sat 11:00 AM',
      data: { kind: 'booking', appointmentId: 'appt-1', start: '2026-10-24T15:00:00.000Z' },
    });
    expect(d.sendEmail.mock.calls[0][0].attachments[0].content).toContain('DTSTART:20261024T150000Z');
    expect(d.sendEmail.mock.calls[0][0].attachments[0].content).toMatch(/\r\nSEQUENCE:\d+\r\n/);
    const d2 = mkDeps();
    await notify({ kind: 'booking_rescheduled', appointmentId: 'appt-1', by: 'shop' }, d2);
    expect(d2.push).not.toHaveBeenCalled();
    expect(d2.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('customer_says_paid: push only', async () => {
    const d = mkDeps();
    await notify({ kind: 'customer_says_paid', appointmentId: 'appt-1', method: 'cashapp' }, d);
    expect(d.push).toHaveBeenCalledWith(['owner-1'], { body: 'Sam <b> says they paid $30 by Cash App', data: DATA });
    await notify({ kind: 'customer_says_paid', appointmentId: 'appt-1', method: 'zelle', amountCents: 1050 }, d);
    expect(d.push.mock.calls[1][1].body).toBe('Sam <b> says they paid $10.50 by Zelle');
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('reminder: email only', async () => {
    const d = mkDeps();
    await notify({ kind: 'reminder', appointmentId: 'appt-1' }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.sendEmail.mock.calls[0][0].subject).toBe('Reminder: Fade at Fade Factory on Friday at 2:00 PM');
  });

  it('never throws: missing appointment, failing loaders, failing push/email', async () => {
    await expect(notify({ kind: 'booking_created', appointmentId: 'x' }, mkDeps(null))).resolves.toBeUndefined();
    const bad = { ...mkDeps(), loadContext: vi.fn().mockRejectedValue(new Error('db')) };
    await expect(notify({ kind: 'booking_created', appointmentId: 'x' }, bad)).resolves.toBeUndefined();
    const d = { ...mkDeps(), push: vi.fn().mockRejectedValue(new Error('p')), sendEmail: vi.fn().mockRejectedValue(new Error('e')) };
    await expect(notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d)).resolves.toBeUndefined();
    // and with no deps at all (no Supabase env): still no throw
    await expect(notify({ kind: 'reminder', appointmentId: 'x' })).resolves.toBeUndefined();
  });
});

describe('runReminders', () => {
  const NOW = Date.UTC(2026, 9, 22, 18, 0);
  function mkR(over: Partial<ReminderDeps> = {}): ReminderDeps & Record<string, any> {
    const stamped = new Set<string>();
    return {
      ...mkDeps(),
      now: () => NOW,
      dueReminders: vi.fn(async () => ['appt-1']),
      claimReminder: vi.fn(async (id: string) => (stamped.has(id) ? false : (stamped.add(id), true))),
      releaseReminder: vi.fn(async (id: string) => { stamped.delete(id); }),
      ...over,
    } as any;
  }

  it('queries the 23–25 h window, claims, sends once', async () => {
    const d = mkR();
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(d.dueReminders).toHaveBeenCalledWith('2026-10-23T17:00:00.000Z', '2026-10-23T19:00:00.000Z');
    expect(d.claimReminder).toHaveBeenCalledWith('appt-1', '2026-10-22T18:00:00.000Z');
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    // a second (overlapping) run finds it claimed
    expect(await runReminders(d)).toEqual({ due: 1, sent: 0, failed: 0 });
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('un-stamps when the email was not sent, so a later run retries', async () => {
    const d = mkR({ sendEmail: vi.fn(async () => 'failed' as const) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 0, failed: 1 });
    expect(d.releaseReminder).toHaveBeenCalledWith('appt-1');
  });

  it('keeps the stamp (no email) when the appointment is no longer booked', async () => {
    const d = mkR({ loadContext: vi.fn(async () => ctx({ status: 'cancelled' })) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.releaseReminder).not.toHaveBeenCalled();
  });
});

describe('runDailySummary', () => {
  const shops = [
    { id: 's-ny', name: 'NY Cuts', timezone: 'America/New_York', owner_id: 'o-ny' },
    { id: 's-la', name: 'LA Cuts', timezone: 'America/Los_Angeles', owner_id: 'o-la' },
    { id: 's-in', name: 'Delhi Cuts', timezone: 'Asia/Kolkata', owner_id: 'o-in' },
  ];
  function mkS(nowMs: number, counts: Record<string, number> = { 's-ny': 3, 's-la': 1, 's-in': 2 }) {
    const claimed = new Set<string>();
    const d: DailySummaryDeps & Record<string, any> = {
      summaryShops: vi.fn(async () => shops),
      countBookings: vi.fn(async (id: string) => counts[id] ?? 0),
      claimSummary: vi.fn(async (id: string, date: string) => (claimed.has(id + date) ? false : (claimed.add(id + date), true))),
      push: vi.fn(async () => ({})),
      now: () => nowMs,
    };
    return d;
  }

  it('pushes only shops where it is 8 AM local, with the local day bounds and date', async () => {
    // 12:00Z = 8:00 New York (EDT), 5:00 LA, 17:30 Delhi
    const d = mkS(Date.UTC(2026, 9, 21, 12, 0));
    expect(await runDailySummary(d)).toEqual({ shops: 3, pushed: 1 });
    expect(d.countBookings).toHaveBeenCalledWith('s-ny', '2026-10-21T04:00:00.000Z', '2026-10-22T04:00:00.000Z');
    expect(d.push).toHaveBeenCalledWith(['o-ny'], { title: 'NY Cuts', body: '3 bookings today', data: { kind: 'booking', date: '2026-10-21' } });
  });

  it('half-hour zones fire in their 8 o’clock hour; singular copy', async () => {
    const d = mkS(Date.UTC(2026, 9, 21, 2, 30)); // 08:00 IST
    await runDailySummary(d);
    expect(d.push).toHaveBeenCalledWith(['o-in'], expect.objectContaining({ body: '2 bookings today', data: { kind: 'booking', date: '2026-10-21' } }));
    const d2 = mkS(Date.UTC(2026, 9, 21, 15, 0)); // 08:00 LA
    await runDailySummary(d2);
    expect(d2.push).toHaveBeenCalledWith(['o-la'], expect.objectContaining({ body: '1 booking today' }));
  });

  it('dedupes a second run in the same hour; silent with zero bookings', async () => {
    const d = mkS(Date.UTC(2026, 9, 21, 12, 0));
    await runDailySummary(d);
    expect(await runDailySummary(d)).toEqual({ shops: 3, pushed: 0 });
    const z = mkS(Date.UTC(2026, 9, 21, 12, 0), { 's-ny': 0 });
    expect(await runDailySummary(z)).toEqual({ shops: 3, pushed: 0 });
    expect(z.claimSummary).not.toHaveBeenCalled();
  });

  it('DST: the local day on a fall-back day is 25 hours', async () => {
    // 2026-11-01 is fall-back in New York; 08:00 EST = 13:00Z
    const d = mkS(Date.UTC(2026, 10, 1, 13, 0));
    await runDailySummary(d);
    expect(d.countBookings).toHaveBeenCalledWith('s-ny', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z');
  });
});
