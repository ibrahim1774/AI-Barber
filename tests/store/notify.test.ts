import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  notifyOrder, orderConfirmationEmail, orderReadyEmail, orderShippedEmail, orderCancelledEmail, liveOrderNotifyDeps,
  type OrderNotifyContext, type OrderNotifyDeps,
} from '../../lib/store/notify.js';
import type { EmailMessage, EmailResult } from '../../lib/bookings/email.js';

const ctx = (over: Partial<OrderNotifyContext['order']> = {}, shopOver: Partial<OrderNotifyContext['shop']> = {}, itemsOver?: OrderNotifyContext['items']): OrderNotifyContext => ({
  order: {
    id: 'ord-1', shop_id: 'shop-1', order_no: 1001, manage_token: 'tok_order',
    customer_name: 'Sam Lee', customer_email: 'sam@example.com',
    fulfilment: 'pickup', shipping_address: null,
    subtotal_cents: 4500, shipping_cents: 0, total_cents: 4500,
    status: 'new', payment_status: 'awaiting', payment_method: 'cashapp',
    amount_paid_cents: 0, amount_refunded_cents: 0, tracking_number: null, tracking_url: null,
    ...over,
  },
  items: itemsOver ?? [
    { name: 'Beard oil', unit_price_cents: 1500, quantity: 2 },
    { name: 'Comb', unit_price_cents: 1500, quantity: 1 },
  ],
  shop: {
    id: 'shop-1', name: 'Fade Factory', slug: 'fade-factory', owner_id: 'owner-1', address: '1 Main St, Austin TX',
    accent: '#aa3300', manual_handles: { cashapp: '$fadefactory', venmo: '@fade' },
    store_pickup_note: 'Ring the bell at the side door', ships_within_days: 3,
    ...shopOver,
  },
  ownerEmail: 'owner@example.com',
  pushUserIds: ['owner-1', 'barber-user-1'],
});

function mkDeps(c: OrderNotifyContext | null = ctx()) {
  const d = {
    loadContext: vi.fn(async (_id: string) => c),
    sendEmail: vi.fn(async (_m: EmailMessage): Promise<EmailResult> => 'sent'),
    push: vi.fn(async (_u: string[], _m: any) => ({})),
    now: () => Date.UTC(2026, 9, 21, 12),
  };
  return d as OrderNotifyDeps & typeof d;
}

const DATA = { kind: 'order', orderId: 'ord-1' };
const STATUS_URL = 'https://www.aibarber.org/shop/manage/tok_order';

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('notifyOrder: order_created', () => {
  it('manual: push to the owner and members, confirmation email with item rows, total, and the Cash App line with the handle', async () => {
    const d = mkDeps();
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    expect(d.loadContext).toHaveBeenCalledWith('ord-1');
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(d.push).toHaveBeenCalledWith(['owner-1', 'barber-user-1'], { body: 'New order #1001: Sam Lee, $45 · pickup', data: DATA });

    expect(d.sendEmail).toHaveBeenCalledTimes(1);
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.to).toBe('sam@example.com');
    expect(m.fromName).toBe('Fade Factory via AI Barber');
    expect(m.replyTo).toBe('owner@example.com');
    expect(m.subject).toBe('Order #1001 at Fade Factory');
    expect(m.html).toContain('2 × Beard oil');
    expect(m.html).toContain('$30');
    expect(m.html).toContain('1 × Comb');
    expect(m.html).toContain('Subtotal');
    expect(m.html).toContain('Total');
    expect(m.html).toContain('$45');
    expect(m.html).toContain('Send $45 by Cash App to $fadefactory');
    expect(m.html).toContain('1 Main St, Austin TX'); // pickup: address
    expect(m.html).toContain('Ring the bell at the side door'); // pickup note
    expect(m.html).toContain('View order');
    expect(m.html).toContain(STATUS_URL);
    expect(m.html).toContain('#aa3300'); // the shared Phase 2 layout, in the shop accent
    expect(m.text).toContain('Send $45 by Cash App to $fadefactory');
    expect(m.text).toContain(STATUS_URL);
  });

  it('shipping order: push says shipping; email has shipping, "Ships within N days" and the address', async () => {
    const d = mkDeps(ctx({
      fulfilment: 'shipping', shipping_cents: 800, total_cents: 5300, payment_method: 'card', payment_status: 'paid', status: 'paid', amount_paid_cents: 5300,
      shipping_address: { name: 'Sam Lee', line1: '9 Elm St', line2: null, city: 'Austin', state: 'TX', postal_code: '78701', country: 'US' },
    }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    expect(d.push.mock.calls[0][1].body).toBe('New order #1001: Sam Lee, $53 · shipping');
    const html = d.sendEmail.mock.calls[0][0].html;
    expect(html).toContain('Shipping');
    expect(html).toContain('$8');
    expect(html).toContain('Ships within 3 days');
    expect(html).toContain('9 Elm St');
    expect(html).toContain('Paid by card');
    expect(html).not.toContain('Ring the bell'); // no pickup note on shipping
  });

  it('card + awaiting: nothing at all (the webhook sends it on payment)', async () => {
    const d = mkDeps(ctx({ payment_method: 'card', payment_status: 'awaiting' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('card paid: "Paid by card"', async () => {
    const d = mkDeps(ctx({ payment_method: 'card', payment_status: 'paid', status: 'paid', amount_paid_cents: 4500 }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(d.sendEmail.mock.calls[0][0].html).toContain('Paid by card');
  });

  it('pay in shop: "Pay at pickup"', async () => {
    const d = mkDeps(ctx({ payment_method: 'shop', payment_status: 'none' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    expect(d.sendEmail.mock.calls[0][0].html).toContain('Pay at pickup');
  });

  it('manual with no method chosen lists every handle', async () => {
    const d = mkDeps(ctx({ payment_method: null }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    const html = d.sendEmail.mock.calls[0][0].html;
    expect(html).toContain('Cash App');
    expect(html).toContain('$fadefactory');
    expect(html).toContain('Venmo');
    expect(html).toContain('@fade');
  });

  it('a cancelled order sends nothing', async () => {
    const d = mkDeps(ctx({ status: 'cancelled' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d);
    expect(d.push).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });
});

describe('notifyOrder: customer emails', () => {
  it('order_ready: address, pickup note and "Amount due at pickup" when unpaid; no push', async () => {
    const d = mkDeps(ctx({ status: 'ready' }));
    await notifyOrder({ kind: 'order_ready', orderId: 'ord-1' }, d);
    expect(d.push).not.toHaveBeenCalled();
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.subject).toBe('Your order #1001 is ready for pickup');
    expect(m.html).toContain('1 Main St, Austin TX');
    expect(m.html).toContain('Ring the bell at the side door');
    expect(m.html).toContain('Amount due at pickup');
    expect(m.html).toContain('$45');
  });

  it('order_ready: no amount due once paid', () => {
    const m = orderReadyEmail(ctx({ status: 'ready', payment_status: 'paid', amount_paid_cents: 4500 }));
    expect(m.html).not.toContain('Amount due at pickup');
  });

  it('order_shipped: tracking number, Track package only with a URL', async () => {
    const d = mkDeps(ctx({ fulfilment: 'shipping', status: 'shipped', tracking_number: '1Z999', tracking_url: 'https://track.example.com/1Z999' }));
    await notifyOrder({ kind: 'order_shipped', orderId: 'ord-1' }, d);
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.subject).toBe('Your order #1001 has shipped');
    expect(m.html).toContain('1Z999');
    expect(m.html).toContain('Track package');
    expect(m.html).toContain('https://track.example.com/1Z999');
    expect(m.html).not.toContain('View order');

    const noUrl = orderShippedEmail(ctx({ fulfilment: 'shipping', status: 'shipped', tracking_number: '1Z999', tracking_url: null }));
    expect(noUrl.html).toContain('1Z999');
    expect(noUrl.html).not.toContain('Track package');
    expect(noUrl.html).toContain('View order');
    expect(noUrl.html).toContain(STATUS_URL);
  });

  it('order_cancelled: the refund line only when > 0', async () => {
    const d = mkDeps(ctx({ status: 'cancelled', payment_method: 'card', payment_status: 'refunded', amount_paid_cents: 4500, amount_refunded_cents: 4500 }));
    await notifyOrder({ kind: 'order_cancelled', orderId: 'ord-1', refundedCents: 4500 }, d);
    expect(d.push).not.toHaveBeenCalled();
    const m = d.sendEmail.mock.calls[0][0];
    expect(m.subject).toBe('Order #1001 was cancelled');
    expect(m.html).toContain('A refund of $45 is on its way to your card');

    const none = orderCancelledEmail(ctx({ status: 'cancelled' }), 0);
    expect(none.subject).toBe('Order #1001 was cancelled');
    expect(none.html).not.toContain('refund');
  });

  it('order_cancelled without refundedCents falls back to the row (unpaid manual: no refund line)', async () => {
    const d = mkDeps(ctx({ status: 'cancelled', payment_status: 'none' }));
    await notifyOrder({ kind: 'order_cancelled', orderId: 'ord-1' }, d);
    expect(d.sendEmail.mock.calls[0][0].html).not.toContain('refund');
  });

  it('no customer email → no email', async () => {
    const d = mkDeps(ctx({ customer_email: null as any, status: 'ready' }));
    await notifyOrder({ kind: 'order_ready', orderId: 'ord-1' }, d);
    expect(d.sendEmail).not.toHaveBeenCalled();
  });
});

describe('notifyOrder: order_says_paid', () => {
  it('push copy with the amount, method label and order number', async () => {
    const d = mkDeps();
    await notifyOrder({ kind: 'order_says_paid', orderId: 'ord-1', method: 'cashapp' }, d);
    expect(d.push).toHaveBeenCalledWith(['owner-1', 'barber-user-1'], { body: 'Sam Lee says they paid $45 by Cash App (order #1001)', data: DATA });
    expect(d.sendEmail).not.toHaveBeenCalled();
  });
});

describe('notifyOrder: errors and escaping', () => {
  it('a missing order logs and returns', async () => {
    const d = mkDeps(null);
    await expect(notifyOrder({ kind: 'order_created', orderId: 'gone' }, d)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
    expect(d.push).not.toHaveBeenCalled();
    expect(d.sendEmail).not.toHaveBeenCalled();
  });

  it('SMTP skipped does not throw', async () => {
    const d = mkDeps();
    d.sendEmail.mockResolvedValue('skipped');
    await expect(notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d)).resolves.toBeUndefined();
  });

  it('a push failure does not stop the email', async () => {
    const d = mkDeps();
    d.push.mockRejectedValue(new Error('expo down'));
    await expect(notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d)).resolves.toBeUndefined();
    expect(d.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('a loadContext throw is swallowed', async () => {
    const d = mkDeps();
    d.loadContext.mockRejectedValue(new Error('db down'));
    await expect(notifyOrder({ kind: 'order_ready', orderId: 'ord-1' }, d)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('HTML in a product name, customer name or shop name is escaped', () => {
    const m = orderConfirmationEmail(
      ctx({ customer_name: '<b>Sam</b>' }, { name: 'Fade <i>Factory</i>' }, [{ name: '<script>alert(1)</script>', unit_price_cents: 4500, quantity: 1 }]),
    );
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(m.html).not.toContain('<i>Factory</i>');
  });
});

describe('liveOrderNotifyDeps (query shape)', () => {
  function recorder(results: any[]) {
    const calls: Array<[string, any[]]> = [];
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (res: any) => res(results.shift() ?? { data: null, error: null });
        return (...args: any[]) => { calls.push([prop, args]); return chain; };
      },
    });
    const db: any = {
      from: (t: string) => { calls.push(['from', [t]]); return chain; },
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'owner@example.com' } } })) } },
    };
    return { db, calls };
  }

  it('loads the order, its items, the shop, active members with a user and the owner email', async () => {
    const order = { id: 'ord-1', shop_id: 'shop-1' };
    const { db, calls } = recorder([
      { data: order, error: null },
      { data: [{ name: 'Oil', unit_price_cents: 100, quantity: 1 }], error: null },
      { data: { id: 'shop-1', owner_id: 'owner-1', name: 'S' }, error: null },
      { data: [{ user_id: 'u-2' }, { user_id: 'owner-1' }], error: null },
    ]);
    const c = await liveOrderNotifyDeps(db).loadContext('ord-1');
    expect(c?.order).toEqual(order);
    expect(c?.items).toHaveLength(1);
    expect(c?.ownerEmail).toBe('owner@example.com');
    expect(c?.pushUserIds).toEqual(['owner-1', 'u-2']);
    expect(calls).toContainEqual(['from', ['ab_orders']]);
    expect(calls).toContainEqual(['from', ['ab_order_items']]);
    expect(calls).toContainEqual(['eq', ['order_id', 'ord-1']]);
    expect(calls).toContainEqual(['from', ['ab_members']]);
    expect(calls).toContainEqual(['eq', ['active', true]]);
  });

  it('missing order → null', async () => {
    const { db } = recorder([{ data: null, error: null }]);
    expect(await liveOrderNotifyDeps(db).loadContext('nope')).toBeNull();
  });
});
