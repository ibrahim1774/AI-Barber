import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cancellationEmail, notify, type NotifyContext, type NotifyDeps } from '../../lib/bookings/notify.js';
import { cancelMoneyNote, cutoffWords } from '../../lib/bookings/money.js';
import { ownerEmailFor } from '../../lib/webApp/ownerNotify.js';
import { cancelledMoneyNote, cutoffWords as clientCutoffWords } from '../../src/book/logic.js';
import { iosOverlapEmail } from '../../lib/webApp/emails.js';

const ctx = (over: Partial<NotifyContext['appt']> = {}, cutoff: number | null = 1440): NotifyContext => ({
  appt: {
    id: 'a1', shop_id: 's1', member_id: 'm1', start_at: '2026-10-23T18:00:00Z', end_at: '2026-10-23T18:30:00Z',
    service_name: 'Fade', price_cents: 4500, customer_name: 'Sam Lee', customer_email: 'sam@example.com',
    status: 'cancelled', cancelled_by: 'customer', payment_status: 'none', payment_method: 'shop',
    amount_paid_cents: 0, amount_refunded_cents: 0, manage_token: 'tok', source: 'online', ...over,
  },
  shop: { id: 's1', name: 'Fade Factory', slug: 'fade-factory', timezone: 'America/New_York', owner_id: 'o1', address: null, cancel_cutoff_min: cutoff },
  memberName: null, memberUserId: null, ownerEmail: 'o@example.com',
});
const KEPT = 'Your $22.50 deposit was kept, because the appointment was cancelled less than 1 day before it started.';
const dep = { payment_status: 'deposit', amount_paid_cents: 2250 };

describe('cutoff wording', () => {
  it('plain words, client and server agree', () => {
    for (const [m, w] of [[1440, '1 day'], [2880, '2 days'], [60, '1 hour'], [120, '2 hours'], [90, '90 minutes'], [30, '30 minutes']] as const) {
      expect(cutoffWords(m)).toBe(w);
      expect(clientCutoffWords(m)).toBe(w);
    }
  });
});

describe('customer cancel email', () => {
  it('deposit kept after the cutoff', () => {
    const m = cancellationEmail(ctx(dep), 'customer', 0, 1);
    expect(m.text).toContain(KEPT);
    expect(m.html).toContain(KEPT);
    expect(m.text).not.toContain('refund');
    expect(m.text).not.toContain('—');
  });
  it('a full payment kept says payment, with a 2 hour cutoff', () => {
    const m = cancellationEmail(ctx({ payment_status: 'paid', amount_paid_cents: 4500 }, 120), 'customer', 0, 1);
    expect(m.text).toContain('Your $45 payment was kept, because the appointment was cancelled less than 2 hours before it started.');
  });
  it('partial and full refunds say refunded, never kept', () => {
    for (const r of [1000, 2250]) {
      const m = cancellationEmail(ctx({ ...dep, payment_status: 'partially_refunded', amount_refunded_cents: r }), 'customer', r, 1);
      expect(m.text).toContain('A refund of');
      expect(m.text).not.toContain('was kept');
    }
  });
  it('nothing paid adds nothing; a shop cancel never says kept; unknown cutoff says nothing', () => {
    expect(cancellationEmail(ctx(), 'customer', 0, 1).text).toBe('Your appointment has been cancelled.\nFade, Friday, October 23 at 2:00 PM.\nBook again: ' + (cancellationEmail(ctx(), 'customer', 0, 1).text.split('Book again: ')[1]));
    expect(cancellationEmail(ctx(dep), 'customer', 0, 1).text.match(/was kept/g)).toHaveLength(1);
    expect(cancellationEmail(ctx(dep), 'shop', 0, 1).text).not.toContain('was kept');
    expect(cancellationEmail(ctx(dep, null), 'customer', 0, 1).text).not.toContain('was kept');
  });
  it('money helper: refund beats kept, nothing paid is null', () => {
    expect(cancelMoneyNote({ paymentStatus: 'deposit', amountPaidCents: 2250, amountRefundedCents: 1000, cutoffMin: 1440 })).toBe('You were refunded $10.');
    expect(cancelMoneyNote({ paymentStatus: 'none', amountPaidCents: 0, amountRefundedCents: 0, cutoffMin: 1440 })).toBeNull();
  });
});

describe('manage page cancelled state', () => {
  const base = { paymentStatus: 'deposit', amountPaidCents: 2250, amountRefundedCents: 0, cutoffMin: 1440 };
  it('kept, partial refund, full refund, nothing paid', () => {
    expect(cancelledMoneyNote(base)).toBe(KEPT);
    expect(cancelledMoneyNote({ ...base, paymentStatus: 'partially_refunded', amountRefundedCents: 1000 })).toBe('You were refunded $10.');
    expect(cancelledMoneyNote({ ...base, paymentStatus: 'refunded', amountRefundedCents: 2250 })).toBe('You were refunded $22.50.');
    expect(cancelledMoneyNote({ ...base, paymentStatus: 'none', amountPaidCents: 0 })).toBeNull();
    expect(cancelledMoneyNote({ ...base, cutoffMin: undefined })).toBeNull();
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
  it('partial refund: Refunded row', async () => {
    const e = await run(ctx({ ...dep, payment_status: 'partially_refunded', amount_refunded_cents: 1000 }), 1000);
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
