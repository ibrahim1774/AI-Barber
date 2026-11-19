import type { NotifyContext } from '../../lib/bookings/notify.js';

/** Appointment shapes whose emails must stay byte-identical (the require-card / deposit-wording work must not touch them). */
export const CASES: Record<string, Partial<NotifyContext['appt']>> = {
  unpaidShop: { payment_status: 'none', payment_method: 'shop', amount_paid_cents: 0 },
  awaitingManual: { payment_status: 'awaiting', payment_method: 'venmo', amount_paid_cents: 0 },
  paidInFull: { payment_status: 'paid', payment_method: 'card', amount_paid_cents: 3000 },
  paidManual: { payment_status: 'paid', payment_method: 'cashapp', amount_paid_cents: 3000 },
  noPrice: { payment_status: 'none', price_cents: null },
};

export const baseCtx = (over: Partial<NotifyContext['appt']> = {}): NotifyContext => ({
  appt: {
    id: 'appt-1', shop_id: 'shop-1', member_id: 'm1', start_at: '2026-10-23T18:00:00Z', end_at: '2026-10-23T18:30:00Z',
    service_name: 'Fade', price_cents: 3000, customer_name: 'Sam <b>', customer_email: 'sam@example.com',
    status: 'booked', cancelled_by: null, payment_status: 'none', payment_method: 'shop',
    amount_paid_cents: 0, amount_refunded_cents: 0, manage_token: 'tok_abc', source: 'online', ...over,
  },
  shop: { id: 'shop-1', name: 'Fade Factory', slug: 'fade-factory', timezone: 'America/New_York', owner_id: 'owner-1', address: '1 Main St' },
  memberName: 'Mike',
  memberUserId: null,
  ownerEmail: 'owner@example.com',
});
