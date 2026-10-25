import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notify, runReminders, shortWhen, dollars, liveReminderDeps, REMINDER_BUDGET_MS,
  type NotifyContext, type NotifyDeps, type ReminderDeps,
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
    expect(m.fromName).toBe('Fade Factory via Prime Barber');
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
    const claims = new Set<string>();
    const sentIds = new Set<string>();
    return {
      ...mkDeps(),
      now: () => NOW,
      dueReminders: vi.fn(async () => ['appt-1'].filter((id) => !sentIds.has(id))),
      claimReminder: vi.fn(async (id: string) => (claims.has(id) ? false : (claims.add(id), true))),
      markReminderSent: vi.fn(async (id: string) => { sentIds.add(id); claims.delete(id); }),
      releaseReminder: vi.fn(async (id: string) => { claims.delete(id); }),
      ...over,
    } as any;
  }

  it('queries the 23–25 h window, claims, sends, then stamps', async () => {
    const d = mkR();
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1, failed: 0, deferred: 0 });
    expect(d.dueReminders).toHaveBeenCalledWith('2026-10-23T17:00:00.000Z', '2026-10-23T19:00:00.000Z');
    expect(d.claimReminder).toHaveBeenCalledWith('appt-1', '2026-10-22T18:00:00.000Z');
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    expect(d.markReminderSent).toHaveBeenCalledWith('appt-1', '2026-10-22T18:00:00.000Z');
    expect(await runReminders(d)).toEqual({ due: 0, sent: 0, failed: 0, deferred: 0 });
  });

  it('an overlapping run that finds the claim taken sends nothing', async () => {
    const d = mkR({ claimReminder: vi.fn(async () => false) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 0, failed: 0, deferred: 0 });
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('releases the claim when the email was not sent, so a later run retries', async () => {
    const d = mkR({ sendEmail: vi.fn(async () => 'failed' as const) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 0, failed: 1, deferred: 0 });
    expect(d.releaseReminder).toHaveBeenCalledWith('appt-1');
    expect(d.markReminderSent).not.toHaveBeenCalled();
  });

  it('stamps (no email) when the appointment is no longer booked', async () => {
    const d = mkR({ loadContext: vi.fn(async () => ctx({ status: 'cancelled' })) });
    expect(await runReminders(d)).toEqual({ due: 1, sent: 1, failed: 0, deferred: 0 });
    expect(d.sendEmail).not.toHaveBeenCalled();
    expect(d.markReminderSent).toHaveBeenCalledWith('appt-1', expect.any(String));
  });

  it('stops claiming once the time budget is spent; the rest stay unclaimed for the next run', async () => {
    let t = 0;
    const ids = ['a', 'b', 'c', 'd'];
    const d = mkR({
      dueReminders: vi.fn(async () => ids),
      sendEmail: vi.fn(async () => { t += 100_000; return 'sent' as const; }), // each send "takes" 100 s
    });
    const r = await runReminders(d, { clock: () => t, budgetMs: REMINDER_BUDGET_MS });
    expect(r).toEqual({ due: 4, sent: 3, failed: 0, deferred: 1 });
    expect(d.claimReminder).toHaveBeenCalledTimes(3);
    expect(d.claimReminder).not.toHaveBeenCalledWith('d', expect.anything());
    expect(REMINDER_BUDGET_MS).toBeLessThanOrEqual(300_000 - 10_000 - 40_000);
  });

  it('a claim left by a killed run is not re-sent by this run (the dep decides staleness), and stamp failures never throw', async () => {
    const d = mkR({ markReminderSent: vi.fn().mockRejectedValue(new Error('db')) });
    await expect(runReminders(d)).resolves.toEqual({ due: 1, sent: 0, failed: 0, deferred: 0 });
  });
});

describe('liveReminderDeps claims (query shape)', () => {
  function fakeDb(results: any[]) {
    const calls: Array<[string, any[]]> = [];
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any) => res(results.shift() ?? { data: null, error: null });
        return (...args: any[]) => { calls.push([prop, args]); return chain; };
      },
    });
    return { db: { from: (t: string) => { calls.push(['from', [t]]); return chain; }, auth: {} } as any, calls };
  }

  it('fresh claim: one insert', async () => {
    const { db, calls } = fakeDb([{ error: null }]);
    expect(await liveReminderDeps(db).claimReminder('a1', '2026-10-22T18:00:00.000Z')).toBe(true);
    expect(calls).toContainEqual(['insert', [expect.objectContaining({ dedupe_key: 'reminder-claim:a1' })]]);
  });

  it('held claim: taken over only when older than 10 minutes', async () => {
    const stale = fakeDb([{ error: { code: '23505' } }, { data: [{ id: 'x' }], error: null }, { error: null }]);
    expect(await liveReminderDeps(stale.db).claimReminder('a1', '2026-10-22T18:00:00.000Z')).toBe(true);
    expect(stale.calls).toContainEqual(['lt', ['created_at', '2026-10-22T17:50:00.000Z']]);
    const fresh = fakeDb([{ error: { code: '23505' } }, { data: [], error: null }]);
    expect(await liveReminderDeps(fresh.db).claimReminder('a1', '2026-10-22T18:00:00.000Z')).toBe(false);
  });

  it('markReminderSent stamps only an unstamped row and drops the claim', async () => {
    const { db, calls } = fakeDb([{ error: null }, { error: null }]);
    await liveReminderDeps(db).markReminderSent('a1', 'now');
    expect(calls).toContainEqual(['update', [{ reminder_sent_at: 'now' }]]);
    expect(calls).toContainEqual(['is', ['reminder_sent_at', null]]);
    expect(calls).toContainEqual(['eq', ['dedupe_key', 'reminder-claim:a1']]);
  });
});
