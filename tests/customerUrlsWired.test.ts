// Every customer-facing URL follows the shop's own site once it has one (ab_shops.site_base_url).
import { describe, expect, it, vi } from 'vitest';
import { createCardCheckout } from '../lib/bookings/payments';
import { createOrderCheckout } from '../lib/store/payments';
import { confirmationEmail, cancellationEmail, reminderEmail, rescheduleEmail, type NotifyContext } from '../lib/bookings/notify';
import { orderConfirmationEmail, orderCancelledEmail, type OrderNotifyContext } from '../lib/store/notify';

const SITE = 'https://freshcuts.com';
const stripeOk = () => vi.fn(async (_u: string, _i: any) => ({ ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/x', amount_total: 3000 }) }));
const params = (f: ReturnType<typeof stripeOk>) => new URLSearchParams(f.mock.calls[0][1].body);

beforeAllEnv();
function beforeAllEnv() { process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_x'; }

describe('Stripe Checkout returns', () => {
  const shop = { id: 'shop-1', slug: 'fresh', name: 'Fresh', currency: 'usd', stripe_account_id: 'acct_1', platform_fee_bps: 200 };
  const appt = { id: 'a1', service_name: 'Fade', price_cents: 3000, manage_token: 'tok' };

  it('booking: the barber\'s site when it has one, aibarber.org otherwise', async () => {
    const f = stripeOk();
    await createCardCheckout({ ...shop, site_base_url: SITE }, appt, 3000, { fetch: f });
    expect(params(f).get('success_url')).toBe(`${SITE}/book/manage/tok?checkout=success`);
    expect(params(f).get('cancel_url')).toBe(`${SITE}/book/manage/tok?checkout=cancelled`);
    const g = stripeOk();
    await createCardCheckout({ ...shop, site_base_url: null }, appt, 3000, { fetch: g });
    expect(params(g).get('success_url')).toBe('https://www.aibarber.org/book/manage/tok?checkout=success');
  });

  it('order: the barber\'s site when it has one', async () => {
    const f = stripeOk();
    await createOrderCheckout(
      { ...shop, site_base_url: SITE, ships_within_days: null } as any,
      { id: 'o1', order_no: 1001, manage_token: 'otok', total_cents: 3000, shipping_cents: 0, fulfilment: 'pickup', customer_email: null } as any,
      [{ name: 'Oil', unit_price_cents: 3000, quantity: 1 }],
      { fetch: f },
    );
    expect(params(f).get('success_url')).toBe(`${SITE}/shop/manage/otok?checkout=success`);
    expect(params(f).get('cancel_url')).toBe(`${SITE}/shop/manage/otok?checkout=cancelled`);
  });
});

describe('booking emails and calendar files', () => {
  const ctx = (siteBase: string | null): NotifyContext => ({
    appt: {
      id: 'appt-1', shop_id: 'shop-1', member_id: 'm1', start_at: '2026-10-23T18:00:00Z', end_at: '2026-10-23T18:30:00Z',
      service_name: 'Fade', price_cents: 3000, customer_name: 'Sam', customer_email: 'sam@example.com', status: 'booked',
      cancelled_by: null, payment_status: 'unpaid', payment_method: null, amount_paid_cents: 0, amount_refunded_cents: 0,
      manage_token: 'tok', source: 'online',
    },
    shop: { id: 'shop-1', name: 'Fresh', slug: 'fresh', timezone: 'America/New_York', owner_id: 'o', site_base_url: siteBase },
    memberName: 'Mike', memberUserId: null, ownerEmail: 'owner@example.com',
  });

  it('manage links, the rebook link and the .ics URL use the site', () => {
    const now = Date.UTC(2026, 9, 20);
    for (const m of [confirmationEmail(ctx(SITE), now), rescheduleEmail(ctx(SITE), now), reminderEmail(ctx(SITE))]) {
      expect(m.html).toContain(`${SITE}/book/manage/tok`);
      expect(m.text).toContain(`${SITE}/book/manage/tok`);
      expect(m.html).not.toContain('aibarber.org/book');
    }
    const c = confirmationEmail(ctx(SITE), now);
    expect(c.attachments![0].content).toContain(`URL:${SITE}/book/manage/tok`);
    // The calendar UID stays stable (changing it would duplicate the event).
    expect(c.attachments![0].content).toContain('UID:appt-1@aibarber.org');
    const x = cancellationEmail(ctx(SITE), 'shop', 0, now);
    expect(x.html).toContain(`href="${SITE}/book"`);
    expect(x.text).toContain(`Book again: ${SITE}/book`);
  });

  it('without a site they stay on aibarber.org', () => {
    const now = Date.UTC(2026, 9, 20);
    expect(confirmationEmail(ctx(null), now).html).toContain('https://www.aibarber.org/book/manage/tok');
    expect(cancellationEmail(ctx(null), 'shop', 0, now).html).toContain('https://www.aibarber.org/book/fresh');
  });
});

describe('order emails', () => {
  const ctx = (siteBase: string | null): OrderNotifyContext => ({
    order: {
      id: 'ord-1', shop_id: 'shop-1', order_no: 1001, manage_token: 'otok', customer_name: 'Sam', customer_email: 'sam@example.com',
      fulfilment: 'pickup', shipping_address: null, subtotal_cents: 4500, shipping_cents: 0, total_cents: 4500,
      status: 'new', payment_status: 'awaiting', payment_method: 'cashapp', amount_paid_cents: 0, amount_refunded_cents: 0,
      tracking_number: null, tracking_url: null,
    },
    items: [{ name: 'Oil', unit_price_cents: 4500, quantity: 1 }],
    shop: {
      id: 'shop-1', name: 'Fresh', slug: 'fresh', owner_id: 'o', address: null, accent: null,
      manual_handles: { cashapp: '$fresh' }, store_pickup_note: null, ships_within_days: null, site_base_url: siteBase,
    },
    ownerEmail: 'owner@example.com', pushUserIds: [],
  } as OrderNotifyContext);

  it('View order and Visit the shop use the site', () => {
    expect(orderConfirmationEmail(ctx(SITE)).html).toContain(`${SITE}/shop/manage/otok`);
    const x = orderCancelledEmail(ctx(SITE), 0);
    expect(x.html).toContain(`href="${SITE}/shop"`);
    expect(x.html).not.toContain('aibarber.org/shop');
  });

  it('without a site they stay on aibarber.org', () => {
    expect(orderConfirmationEmail(ctx(null)).html).toContain('https://www.aibarber.org/shop/manage/otok');
    expect(orderCancelledEmail(ctx(null), 0).html).toContain('https://www.aibarber.org/shop/fresh');
  });
});

describe('Connect onboarding (owner-facing)', () => {
  it('business_profile[url] and the idempotency key do not depend on the shop\'s site', async () => {
    const { createStandardAccount } = await import('../lib/bookings/payments');
    const run = async (site: string | null) => {
      const f = vi.fn(async (_u: string, _i: any) => ({ ok: true, status: 200, json: async () => ({ id: 'acct_1' }) }));
      await createStandardAccount({ id: 'shop-1', slug: 'fresh', name: 'Fresh', stripe_account_id: null, platform_fee_bps: 200, site_base_url: site }, 'o@x.test', { fetch: f });
      return { url: new URLSearchParams(f.mock.calls[0][1].body).get('business_profile[url]'), key: f.mock.calls[0][1].headers['Idempotency-Key'] };
    };
    const a = await run(null);
    const b = await run(SITE);
    expect(a.url).toBe('https://www.aibarber.org/book/fresh');
    expect(b).toEqual(a);
  });
});
