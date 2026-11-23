import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cancellationEmail, notify, type NotifyContext, type NotifyDeps } from '../../lib/bookings/notify.js';
import { keptCents, cutoffWords } from '../../lib/bookings/money.js';
import { ownerEmailFor } from '../../lib/webApp/ownerNotify.js';
import { cancelledMoneyNote } from '../../src/book/logic.js';
import { keptNoteFor } from '../../lib/bookings/core.js';
import { iosOverlapEmail } from '../../lib/webApp/emails.js';

const ctx = (over: Partial<NotifyContext['appt']> = {}, cutoff: number | null = 1440): NotifyContext => ({
  appt: {
    id: 'a1', shop_id: 's1', member_id: 'm1', start_at: '2026-10-23T18:00:00Z', end_at: '2026-10-23T18:30:00Z',
    service_name: 'Fade', price_cents: 4500, customer_name: 'Sam Lee', customer_email: 'sam@example.com',
    status: 'cancelled', cancelled_by: 'customer', cancelled_at: '2026-10-23T10:00:00Z', payment_status: 'none', payment_method: 'card',
    amount_paid_cents: 0, amount_refunded_cents: 0, manage_token: 'tok', source: 'online', ...over,
  },
  shop: { id: 's1', name: 'Fade Factory', slug: 'fade-factory', timezone: 'America/New_York', owner_id: 'o1', address: null, cancel_cutoff_min: cutoff },
  memberName: null, memberUserId: null, ownerEmail: 'o@example.com',
});
const KEPT = 'Your $22.50 deposit was kept, because the appointment was cancelled less than 1 day before it started.';
const dep = { payment_status: 'deposit', amount_paid_cents: 2250, payment_method: 'card' };

describe('cutoff wording', () => {
  it('plain words', () => {
    for (const [m, w] of [[1440, '1 day'], [2880, '2 days'], [60, '1 hour'], [120, '2 hours'], [90, '90 minutes'], [30, '30 minutes']] as const) {
      expect(cutoffWords(m)).toBe(w);
    }
  });
});

describe('customer cancel email', () => {
  it('card deposit kept after the cutoff', () => {
    const m = cancellationEmail(ctx(dep), 'customer', 0, 1);
    expect(m.text).toContain(KEPT);
    expect(m.html).toContain(KEPT);
    expect(m.text).not.toContain('refund');
    expect(m.text).not.toContain('—');
  });
  it('a full card payment kept says payment, with a 2 hour cutoff', () => {
    const m = cancellationEmail(ctx({ payment_status: 'paid', amount_paid_cents: 4500, payment_method: 'card', cancelled_at: '2026-10-23T17:00:00Z' }, 120), 'customer', 0, 1);
    expect(m.text).toContain('Your $45 payment was kept, because the appointment was cancelled less than 2 hours before it started.');
  });
  it('partial refund: refunded line, never kept', () => {
    const m = cancellationEmail(ctx({ ...dep, payment_status: 'partially_refunded', amount_refunded_cents: 1000 }), 'customer', 1000, 1);
    expect(m.text).toContain('A refund of $10');
    expect(m.text).not.toContain('was kept');
  });
  it('partially refunded earlier, then kept: the amount is paid minus refunded, and it is still a deposit', () => {
    const m = cancellationEmail(ctx({ ...dep, payment_status: 'partially_refunded', amount_refunded_cents: 1000 }), 'customer', 0, 1);
    expect(m.text).toContain('Your $12.50 deposit was kept');
  });
  it('full refund: refunded line, never kept', () => {
    const m = cancellationEmail(ctx({ ...dep, payment_status: 'refunded', amount_refunded_cents: 2250 }), 'customer', 2250, 1);
    expect(m.text).toContain('A refund of $22.50');
    expect(m.text).not.toContain('was kept');
  });
  it('nothing paid adds nothing; a shop cancel never says kept; unknown cutoff says nothing', () => {
    expect(cancellationEmail(ctx(), 'customer', 0, 1).text).not.toContain('was kept');
    expect(cancellationEmail(ctx({ ...dep, cancelled_by: 'shop' }), 'shop', 0, 1).text).not.toContain('was kept');
    expect(cancellationEmail(ctx(dep, null), 'customer', 0, 1).text).not.toContain('was kept');
  });
  it('manual and in-shop payments marked paid are never "kept", even with a cutoff in force', () => {
    for (const payment_method of ['cashapp', 'venmo', 'zelle', 'paypal', 'shop']) {
      for (const over of [{ payment_status: 'paid', amount_paid_cents: 4500 }, dep]) {
        const m = cancellationEmail(ctx({ ...over, payment_method }), 'customer', 0, 1);
        expect(m.text).not.toContain('kept');
        expect(m.html).not.toContain('kept');
      }
    }
  });
  it('a failed or pending card refund is not "kept"', () => {
    const m = cancellationEmail(ctx({ ...dep, refund_due_cents: 2250 }), 'customer', 0, 1);
    expect(m.text).not.toContain('kept');
  });
  it('customer cancel after a shop reschedule (refunds as a shop cancel) is not "kept"', () => {
    const m = cancellationEmail(ctx({ ...dep, shop_rescheduled_at: '2026-10-20T10:00:00Z' }), 'customer', 0, 1);
    expect(m.text).not.toContain('kept');
  });
  it('cancelled on time, or payment recorded after the cancel (status none): not kept', () => {
    expect(cancellationEmail(ctx({ ...dep, cancelled_at: '2026-10-20T10:00:00Z' }), 'customer', 0, 1).text).not.toContain('kept');
    expect(cancellationEmail(ctx({ ...dep, payment_status: 'none' }), 'customer', 0, 1).text).not.toContain('kept');
  });
  it('rule boundary: cancelled exactly at the cutoff is on time', () => {
    const i = { cancelledBy: 'customer', paymentMethod: 'card', paymentStatus: 'deposit', amountPaidCents: 2250, amountRefundedCents: 0, startAt: '2026-10-23T18:00:00Z', cutoffMin: 120 };
    expect(keptCents({ ...i, cancelledAt: '2026-10-23T16:00:00Z' })).toBe(0);
    expect(keptCents({ ...i, cancelledAt: '2026-10-23T16:00:01Z' })).toBe(2250);
    expect(keptCents({ ...i, cancelledAt: '2026-10-23T16:00:01Z', cutoffMin: 0 })).toBe(0);
  });
});

describe('manage page (server field + client display)', () => {
  const row = (o: any = {}) => ({
    start_at: '2026-10-23T18:00:00Z', cancelled_at: '2026-10-23T10:00:00Z', cancelled_by: 'customer', payment_method: 'card', payment_status: 'deposit',
    amount_paid_cents: 2250, amount_refunded_cents: 0, refund_due_cents: 0, shop_rescheduled_at: null, price_cents: 4500, ...o,
  }) as any;
  const shop = { cancel_cutoff_min: 1440 } as any;
  it('server field: kept sentence, same as the email', () => {
    expect(keptNoteFor(row(), shop)).toBe(KEPT);
  });
  it('server field: null for manual paid, failed refund, shop cancel, reschedule then cancel, nothing paid, refunded', () => {
    expect(keptNoteFor(row({ payment_method: 'cashapp', payment_status: 'paid' }), shop)).toBeNull();
    expect(keptNoteFor(row({ refund_due_cents: 2250 }), shop)).toBeNull();
    expect(keptNoteFor(row({ cancelled_by: 'shop' }), shop)).toBeNull();
    expect(keptNoteFor(row({ shop_rescheduled_at: '2026-10-20T00:00:00Z' }), shop)).toBeNull();
    expect(keptNoteFor(row({ payment_status: 'none', amount_paid_cents: 0 }), shop)).toBeNull();
    expect(keptNoteFor(row({ payment_status: 'refunded', amount_refunded_cents: 2250, refund_due_cents: 2250 }), shop)).toBeNull();
  });
  it('client shows refunded amount, else the server sentence, else nothing', () => {
    expect(cancelledMoneyNote({ amountRefundedCents: 1000, keptNote: KEPT })).toBe('You were refunded $10.');
    expect(cancelledMoneyNote({ amountRefundedCents: 2250, keptNote: null })).toBe('You were refunded $22.50.');
    expect(cancelledMoneyNote({ amountRefundedCents: 0, keptNote: KEPT })).toBe(KEPT);
    expect(cancelledMoneyNote({ amountRefundedCents: 0, keptNote: null })).toBeNull();
    expect(cancelledMoneyNote({ amountRefundedCents: 0, keptNote: undefined })).toBeNull();
  });
});

describe('owner cancel email', () => {
  beforeEach(() => { vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit'); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const run = async (c: NotifyContext, refundedCents?: number) => {
    const ev: any[] = [];
    const d: NotifyDeps = {
      loadContext: async () => c, sendEmail: async () => 'sent', push: async () => ({}), now: () => 1,
      emailOwner: async (_o: string, e: any) => { ev.push(e); }, ownerHasWebPlan: async () => true, ownerHasLivePlan: async () => true,
    } as any;
    await notify({ kind: 'booking_cancelled', appointmentId: 'a1', by: 'customer', refundedCents }, d);
    return ev[0];
  };
  it('deposit kept: Payment row and Deposit kept row', async () => {
    const e = await run(ctx(dep), 0);
    expect(e.paid).toBe('Deposit paid $22.50');
    expect(e.settled).toEqual(['Deposit kept', '$22.50']);
    const m = ownerEmailFor(e, null);
    expect(m.text).toContain('Payment: Deposit paid $22.50');
    expect(m.text).toContain('Deposit kept: $22.50');
  });
  it('manual paid, failed refund: no Deposit kept row', async () => {
    expect((await run(ctx({ ...dep, payment_method: 'venmo' }), 0)).settled).toBeUndefined();
    expect((await run(ctx({ ...dep, refund_due_cents: 2250 }), 0)).settled).toBeUndefined();
  });
  it('partial refund earlier, then kept: owner and customer agree on the amount', async () => {
    const c = ctx({ ...dep, payment_status: 'partially_refunded', amount_refunded_cents: 1000 });
    expect((await run(c, 0)).settled).toEqual(['Deposit kept', '$12.50']);
  });
  it('partial refund: Refunded row', async () => {
    const e = await run(ctx({ ...dep, payment_status: 'partially_refunded', amount_refunded_cents: 1000, cancelled_at: '2026-10-20T10:00:00Z' }), 1000);
    expect(ownerEmailFor(e, null).text).toContain('Refunded: $10');
  });
  it('nothing paid: exactly as before (no Payment row)', async () => {
    const e = await run(ctx());
    expect(e.paid).toBeUndefined();
    expect(e.settled).toBeUndefined();
    expect(ownerEmailFor(e, null).text).not.toContain('Payment');
  });
});

describe('iOS overlap email, by holder', () => {
  it('text has a blank line between the notes; html keeps <br><br>', () => {
    const m = iosOverlapEmail({ email: 'b@x.co', siteUrl: null, tier: 'website', firstName: 'Sam', overlapByHolder: true, accountEmail: 'barber@gmail.com' } as any);
    expect(m.text).toMatch(/reportaproblem\.apple\.com\.\n\nTo use the app/);
    expect(m.text).not.toContain('<br>');
    expect(m.html).toMatch(/reportaproblem\.apple\.com\.<br><br>To use the app/);
  });
});
