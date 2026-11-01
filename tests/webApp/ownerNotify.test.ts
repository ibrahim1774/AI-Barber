import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notify, type NotifyContext, type NotifyDeps } from '../../lib/bookings/notify.js';
import { notifyOrder, type OrderNotifyContext, type OrderNotifyDeps } from '../../lib/store/notify.js';
import { ownerEmailFor, sendOwnerEmail, type OwnerNotifyDeps } from '../../lib/webApp/ownerNotify.js';

const bctx = (over: Partial<NotifyContext['appt']> = {}, shopOver: Partial<NotifyContext['shop']> = {}): NotifyContext => ({
  appt: {
    id: 'appt-1', shop_id: 'shop-1', member_id: 'm1', start_at: '2026-10-24T19:00:00Z', end_at: '2026-10-24T19:30:00Z',
    service_name: 'Fade', price_cents: 3000, customer_name: 'Jake Lee', customer_email: 'jake@example.com',
    status: 'booked', cancelled_by: null, payment_status: 'none', payment_method: 'shop',
    amount_paid_cents: 0, amount_refunded_cents: 0, manage_token: 'tok', source: 'online', ...over,
  },
  shop: { id: 'shop-1', name: 'Fade Factory', slug: 'ff', timezone: 'America/New_York', owner_id: 'owner-1', ios_otid: null, ...shopOver },
  memberName: null, memberUserId: null, ownerEmail: 'owner@example.com',
});
function bdeps(c: NotifyContext) {
  return {
    loadContext: vi.fn(async () => c), sendEmail: vi.fn(async () => 'sent' as const), push: vi.fn(async () => ({})),
    emailOwner: vi.fn(async (_id: string, _e: any): Promise<unknown> => 'sent'), now: () => Date.UTC(2026, 9, 21, 12),
  };
}
const octx = (shopOver: Partial<OrderNotifyContext['shop']> = {}, over: Partial<OrderNotifyContext['order']> = {}): OrderNotifyContext => ({
  order: {
    id: 'ord-1', shop_id: 'shop-1', order_no: 1001, manage_token: 't', customer_name: 'Sam Lee', customer_email: 's@example.com',
    fulfilment: 'pickup', shipping_address: null, subtotal_cents: 2400, shipping_cents: 0, total_cents: 2400, status: 'new',
    payment_status: 'awaiting', payment_method: 'cashapp', amount_paid_cents: 0, amount_refunded_cents: 0, tracking_number: null, tracking_url: null, ...over,
  },
  items: [{ name: 'Oil', unit_price_cents: 1200, quantity: 1 }, { name: 'Comb', unit_price_cents: 600, quantity: 2 }],
  shop: { id: 'shop-1', name: 'Fade Factory', slug: 'ff', owner_id: 'owner-1', ios_otid: null, ...shopOver },
  ownerEmail: 'owner@example.com', pushUserIds: ['owner-1'],
});
function odeps(c: OrderNotifyContext) {
  return {
    loadContext: vi.fn(async () => c), sendEmail: vi.fn(async () => 'sent' as const), push: vi.fn(async () => ({})),
    emailOwner: vi.fn(async (_id: string, _e: any): Promise<unknown> => 'sent'), now: () => 0,
  };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const flagOn = () => vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');

describe('owner email: bookings', () => {
  it('flag off: no owner email, push unchanged', async () => {
    const d = bdeps(bctx());
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner).not.toHaveBeenCalled();
    expect(d.push).toHaveBeenCalledTimes(1);
  });
  it('iOS shop (ios_otid set): no owner email even with the flag on', async () => {
    flagOn();
    const d = bdeps(bctx({}, { ios_otid: 'otid-1' }));
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    await notify({ kind: 'booking_cancelled', appointmentId: 'appt-1', by: 'customer' }, d as NotifyDeps);
    expect(d.emailOwner).not.toHaveBeenCalled();
    expect(d.push).toHaveBeenCalledTimes(2);
  });
  it('web shop: one owner email per customer event; shop-initiated, reminders and walk-ins none', async () => {
    flagOn();
    const d = bdeps(bctx());
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    await notify({ kind: 'booking_cancelled', appointmentId: 'appt-1', by: 'customer' }, d as NotifyDeps);
    await notify({ kind: 'booking_rescheduled', appointmentId: 'appt-1', by: 'customer' }, d as NotifyDeps);
    await notify({ kind: 'customer_says_paid', appointmentId: 'appt-1', method: 'venmo' }, d as NotifyDeps);
    expect(d.emailOwner.mock.calls.map((c) => c[1].kind)).toEqual(['booking_created', 'booking_cancelled', 'booking_rescheduled', 'customer_says_paid']);
    expect(d.emailOwner.mock.calls[0][0]).toBe('owner-1');
    const n = d.emailOwner.mock.calls.length;
    await notify({ kind: 'booking_cancelled', appointmentId: 'appt-1', by: 'shop' }, d as NotifyDeps);
    await notify({ kind: 'booking_rescheduled', appointmentId: 'appt-1', by: 'shop' }, d as NotifyDeps);
    await notify({ kind: 'reminder', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner.mock.calls.length).toBe(n);
    const w = bdeps(bctx({ source: 'walk_in' }));
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, w as NotifyDeps);
    expect(w.emailOwner).not.toHaveBeenCalled();
  });
  it('unpaid card hold sends nothing to the owner', async () => {
    flagOn();
    const d = bdeps(bctx({ payment_method: 'card', payment_status: 'awaiting' }));
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner).not.toHaveBeenCalled();
  });
  it('an owner-email failure never throws and does not block the push or customer email', async () => {
    flagOn();
    const d = bdeps(bctx());
    d.emailOwner.mockRejectedValue(new Error('resend down'));
    await expect(notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps)).resolves.toBeUndefined();
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });
  it('event carries shop-timezone times', async () => {
    flagOn();
    const d = bdeps(bctx());
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner.mock.calls[0][1]).toMatchObject({ whenShort: 'Sat 3:00 PM', service: 'Fade', customerName: 'Jake Lee' });
  });
});

describe('owner email: store', () => {
  it('flag off / iOS shop: nothing', async () => {
    const a = odeps(octx());
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, a as OrderNotifyDeps);
    expect(a.emailOwner).not.toHaveBeenCalled();
    flagOn();
    const b = odeps(octx({ ios_otid: 'x' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, b as OrderNotifyDeps);
    expect(b.emailOwner).not.toHaveBeenCalled();
    expect(b.push).toHaveBeenCalledTimes(1);
  });
  it('web shop: order_created and order_says_paid email the owner; card awaiting, ready do not', async () => {
    flagOn();
    const d = odeps(octx());
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d as OrderNotifyDeps);
    await notifyOrder({ kind: 'order_says_paid', orderId: 'ord-1', method: 'cashapp' } as any, d as OrderNotifyDeps);
    await notifyOrder({ kind: 'order_ready', orderId: 'ord-1' }, d as OrderNotifyDeps);
    expect(d.emailOwner.mock.calls.map((c) => c[1].kind)).toEqual(['order_created', 'order_says_paid']);
    expect(d.emailOwner.mock.calls[0][1]).toMatchObject({ itemCount: 3, totalCents: 2400 });
    const c = odeps(octx({}, { payment_method: 'card', payment_status: 'awaiting' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, c as OrderNotifyDeps);
    expect(c.emailOwner).not.toHaveBeenCalled();
  });
  it('failure never throws', async () => {
    flagOn();
    const d = odeps(octx());
    d.emailOwner.mockRejectedValue(new Error('x'));
    await expect(notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d as OrderNotifyDeps)).resolves.toBeUndefined();
    expect(d.push).toHaveBeenCalledTimes(1);
  });
});

describe('ownerEmailFor / sendOwnerEmail', () => {
  const when = { whenShort: 'Sat 3:00 PM', whenLong: 'Saturday, October 24 at 3:00 PM', service: 'Fade' };
  it('subjects are short and personal', () => {
    expect(ownerEmailFor({ kind: 'booking_created', customerName: 'Jake Lee', ...when }, 'Ibrahim').subject).toBe('New booking: Jake, Sat 3:00 PM');
    expect(ownerEmailFor({ kind: 'booking_cancelled', customerName: 'Jake Lee', ...when }, null).subject).toBe('Cancelled: Jake, Sat 3:00 PM');
    expect(ownerEmailFor({ kind: 'booking_rescheduled', customerName: null, ...when }, null).subject).toBe('Rescheduled: A customer, Sat 3:00 PM');
    expect(ownerEmailFor({ kind: 'order_created', customerName: 'Sam', itemCount: 2, totalCents: 2400, fulfilment: 'pickup', orderLabel: '#1' }, null).subject).toBe('New order: $24.00 (2 items)');
    expect(ownerEmailFor({ kind: 'customer_says_paid', customerName: 'Jake', method: 'venmo', amountCents: 3000, ...when }, null).subject).toBe('Jake says they paid $30.00');
  });
  it('greets by first name, links to sign-in, never a password', () => {
    const m = ownerEmailFor({ kind: 'booking_created', customerName: 'Jake', ...when }, 'Ibrahim', 'https://www.aibarber.org');
    expect(m.html).toContain('Hi Ibrahim, ');
    expect(m.html).toContain('href="https://www.aibarber.org/app/sign-in"');
    expect(m.text).toContain('Saturday, October 24 at 3:00 PM');
    expect(m.html.toLowerCase()).not.toMatch(/password:/);
  });
  it('escapes HTML in customer, service and owner names; strips header newlines from the subject', () => {
    const m = ownerEmailFor({ kind: 'booking_created', customerName: '<img src=x onerror=1>\nBcc: evil@x.co', service: '<script>x</script>', whenShort: 'Sat 3:00 PM', whenLong: 'w' }, '<b>Bob</b>');
    expect(m.html).not.toContain('<img');
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>Bob</b>');
    expect(m.html).toContain('&lt;img');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject.length).toBeLessThanOrEqual(45);
  });
  it('sendOwnerEmail: sends to the resolved address; no address skips; failures never throw', async () => {
    const send = vi.fn(async (_to: string, _m: unknown) => {});
    const ev = { kind: 'booking_created', customerName: 'Jake', ...when } as const;
    const ok: OwnerNotifyDeps = { contact: async () => ({ email: 'o@example.com', firstName: 'Ibrahim' }), send };
    expect(await sendOwnerEmail('u', ev, ok)).toBe('sent');
    expect(send).toHaveBeenCalledWith('o@example.com', expect.objectContaining({ subject: 'New booking: Jake, Sat 3:00 PM' }));
    expect(await sendOwnerEmail('u', ev, { contact: async () => ({ email: null, firstName: null }), send })).toBe('skipped');
    expect(await sendOwnerEmail('u', ev, { contact: async () => { throw new Error('x'); }, send })).toBe('failed');
    expect(await sendOwnerEmail('u', ev, { ...ok, send: async () => { throw new Error('resend 500'); } })).toBe('failed');
  });
});
