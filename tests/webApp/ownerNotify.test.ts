import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notify, type NotifyContext, type NotifyDeps } from '../../lib/bookings/notify.js';
import { notifyOrder, type OrderNotifyContext, type OrderNotifyDeps } from '../../lib/store/notify.js';
import { ownerEmailFor, sendOwnerEmail, ownerHasWebPlan, hasCurrentWebPlan, isWebShop, type OwnerNotifyDeps } from '../../lib/webApp/ownerNotify.js';

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
    emailOwner: vi.fn(async (_id: string, _e: any): Promise<unknown> => 'sent'), ownerHasWebPlan: vi.fn(async (_id: string) => true), now: () => Date.UTC(2026, 9, 21, 12),
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
    emailOwner: vi.fn(async (_id: string, _e: any): Promise<unknown> => 'sent'), ownerHasWebPlan: vi.fn(async (_id: string) => true), now: () => 0,
  };
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const flagOn = () => { vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit'); };

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
  it('shipping orders pass the address to the owner email; pickup and a card order not yet paid do not', async () => {
    flagOn();
    const addr = { name: 'Sam Lee', line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701' };
    const d = odeps(octx({}, { fulfilment: 'shipping', shipping_address: addr }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, d as OrderNotifyDeps);
    expect(d.emailOwner.mock.calls[0][1]).toMatchObject({ fulfilment: 'shipping', shipTo: 'Sam Lee, 1 Main St, Austin, TX 78701' });
    expect(d.push.mock.calls[0][1].body).not.toContain('1 Main St');
    const p = odeps(octx());
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, p as OrderNotifyDeps);
    expect(p.emailOwner.mock.calls[0][1]).not.toHaveProperty('shipTo');
    // Card + shipping: nothing before payment; after the webhook stores the address the email carries it.
    const awaiting = odeps(octx({}, { fulfilment: 'shipping', shipping_address: null, payment_method: 'card', payment_status: 'awaiting' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, awaiting as OrderNotifyDeps);
    expect(awaiting.emailOwner).not.toHaveBeenCalled();
    const paid = odeps(octx({}, { fulfilment: 'shipping', shipping_address: addr, payment_method: 'card', payment_status: 'paid', status: 'paid' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, paid as OrderNotifyDeps);
    expect(paid.emailOwner.mock.calls[0][1]).toMatchObject({ shipTo: 'Sam Lee, 1 Main St, Austin, TX 78701' });
  });
  it('the owner email shows "Ship to" only when an address is present', () => {
    const base = { kind: 'order_created', customerName: 'Sam', itemCount: 1, totalCents: 2400, fulfilment: 'shipping', orderLabel: '#1' } as const;
    const withAddr = ownerEmailFor({ ...base, shipTo: 'Sam Lee, 1 Main St, Austin, TX 78701' }, null);
    expect(withAddr.html).toContain('Ship to');
    expect(withAddr.text).toContain('Ship to: Sam Lee, 1 Main St, Austin, TX 78701');
    expect(ownerEmailFor({ ...base, shipTo: null }, null).text).not.toContain('Ship to');
    expect(ownerEmailFor(base, null).text).not.toContain('Ship to');
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

// Go-live gate (D6.4): existing shops with no ios_otid and no web plan must never start getting owner emails.
describe('web shop gate: only an entitled web plan in the current Stripe mode', () => {
  const live = (rows: Array<{ environment: string | null; status: string | null }>) => vi.fn(async (_path: string) => rows);
  const viaLookup = (rows: Array<{ environment: string | null; status: string | null }>) => {
    const rest = live(rows);
    return { rest, lookup: (id: string) => ownerHasWebPlan(id, rest as any) };
  };
  it('no ios_otid and no entitlement row: no owner email (booking + store)', async () => {
    flagOn();
    const { rest, lookup } = viaLookup([]);
    const d = bdeps(bctx()); d.ownerHasWebPlan.mockImplementation(lookup);
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    const o = odeps(octx()); o.ownerHasWebPlan.mockImplementation(lookup);
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, o as OrderNotifyDeps);
    expect(rest).toHaveBeenCalled();
    expect(String(rest.mock.calls[0][0])).toContain('user_id=eq.owner-1');
    expect(d.emailOwner).not.toHaveBeenCalled();
    expect(o.emailOwner).not.toHaveBeenCalled();
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(o.push).toHaveBeenCalledTimes(1);
  });
  it('active live entitlement while the key is live: owner email', async () => {
    flagOn();
    const d = bdeps(bctx()); d.ownerHasWebPlan.mockImplementation(viaLookup([{ environment: 'live', status: 'active' }]).lookup);
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner).toHaveBeenCalledTimes(1);
    const o = odeps(octx()); o.ownerHasWebPlan.mockImplementation(viaLookup([{ environment: 'live', status: 'trialing' }]).lookup);
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, o as OrderNotifyDeps);
    expect(o.emailOwner).toHaveBeenCalledTimes(1);
  });
  it('past_due live entitlement still counts (grace while Stripe retries)', async () => {
    flagOn();
    const d = bdeps(bctx()); d.ownerHasWebPlan.mockImplementation(viaLookup([{ environment: 'live', status: 'past_due' }]).lookup);
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner).toHaveBeenCalledTimes(1);
  });
  it('test-mode row while the key is live: no owner email', async () => {
    flagOn();
    const d = bdeps(bctx()); d.ownerHasWebPlan.mockImplementation(viaLookup([{ environment: 'test', status: 'active' }]).lookup);
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner).not.toHaveBeenCalled();
  });
  it('canceled / unpaid / incomplete / invalid_price live rows: no owner email', async () => {
    flagOn();
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'invalid_price', null]) {
      const d = bdeps(bctx()); d.ownerHasWebPlan.mockImplementation(viaLookup([{ environment: 'live', status }]).lookup);
      await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
      expect(d.emailOwner, String(status)).not.toHaveBeenCalled();
    }
  });
  it('entitlement lookup error: no owner email, logged, flow unaffected', async () => {
    flagOn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = bdeps(bctx()); d.ownerHasWebPlan.mockRejectedValue(new Error('supabase 500'));
    await expect(notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps)).resolves.toBeUndefined();
    const o = odeps(octx()); o.ownerHasWebPlan.mockImplementation((id: string) => ownerHasWebPlan(id, (async () => { throw new Error('supabase 503'); }) as any));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, o as OrderNotifyDeps);
    expect(d.emailOwner).not.toHaveBeenCalled();
    expect(o.emailOwner).not.toHaveBeenCalled();
    expect(d.push).toHaveBeenCalledTimes(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes('web plan lookup failed'))).toBe(true);
  });
  it('ios_otid set: never emails and never looks up a web plan, even with an active live row', async () => {
    flagOn();
    const d = bdeps(bctx({}, { ios_otid: 'otid-1' }));
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    const o = odeps(octx({ ios_otid: 'otid-1' }));
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, o as OrderNotifyDeps);
    expect(d.ownerHasWebPlan).not.toHaveBeenCalled();
    expect(o.ownerHasWebPlan).not.toHaveBeenCalled();
    expect(d.emailOwner).not.toHaveBeenCalled();
    expect(o.emailOwner).not.toHaveBeenCalled();
  });
  it('no web-plan lookup wired (deps without ownerHasWebPlan): no owner email', async () => {
    flagOn();
    const d: any = bdeps(bctx()); delete d.ownerHasWebPlan;
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d as NotifyDeps);
    expect(d.emailOwner).not.toHaveBeenCalled();
  });
  it('Stripe key unset or unknown: not a web shop, no lookup', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1');
    for (const key of ['', 'pk_live_x']) {
      vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', key);
      const look = vi.fn(async () => true);
      expect(await isWebShop({ owner_id: 'o', ios_otid: null }, look)).toBe(false);
      expect(look).not.toHaveBeenCalled();
    }
  });
  it('test key: only test rows count', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_unit');
    expect(await isWebShop({ owner_id: 'o' }, (id) => ownerHasWebPlan(id, live([{ environment: 'test', status: 'active' }]) as any))).toBe(true);
    expect(await isWebShop({ owner_id: 'o' }, (id) => ownerHasWebPlan(id, live([{ environment: 'live', status: 'active' }]) as any))).toBe(false);
  });
  it('flag off: never a web shop even with an active live row', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit');
    const look = vi.fn(async () => true);
    expect(await isWebShop({ owner_id: 'o', ios_otid: null }, look)).toBe(false);
    expect(look).not.toHaveBeenCalled();
  });
  it('hasCurrentWebPlan: mode and status filtering is done in code', () => {
    expect(hasCurrentWebPlan([{ environment: 'live', status: 'active' }], 'live')).toBe(true);
    expect(hasCurrentWebPlan([{ environment: 'live', status: 'active' }], null)).toBe(false);
    expect(hasCurrentWebPlan([{ environment: 'test', status: 'active' }, { environment: 'live', status: 'canceled' }], 'live')).toBe(false);
    expect(hasCurrentWebPlan([{ environment: 'live', status: 'canceled' }, { environment: 'live', status: 'past_due' }], 'live')).toBe(true);
  });
});

// e2e 2026-11-02: a web shop's "New booking" owner email never arrived while "New order" did, and nothing was logged.
describe('booking and order owner emails take the same gate, and a drop says why', () => {
  it('one web shop, one plan lookup: booking_created and order_created both email the owner', async () => {
    flagOn();
    const b = bdeps(bctx());
    const o = odeps(octx());
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, b as NotifyDeps);
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, o as OrderNotifyDeps);
    expect(b.emailOwner).toHaveBeenCalledTimes(1);
    expect(o.emailOwner).toHaveBeenCalledTimes(1);
    expect(b.ownerHasWebPlan).toHaveBeenCalledWith('owner-1');
    expect(o.ownerHasWebPlan).toHaveBeenCalledWith('owner-1');
  });
  it('the real recipient lookup (auth account email) is the same for both, with no ios_purchases or site_owners row involved', async () => {
    flagOn();
    const send = vi.fn(async (_to: string, _m: unknown) => {});
    const real: OwnerNotifyDeps = { contact: async (id) => ({ email: id === 'owner-1' ? 'web-owner@example.com' : null, firstName: 'Web' }), send };
    const wire = (d: any) => ({ ...d, emailOwner: (id: string, e: any) => sendOwnerEmail(id, e, real) });
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, wire(bdeps(bctx())) as NotifyDeps);
    await notifyOrder({ kind: 'order_created', orderId: 'ord-1' }, wire(odeps(octx())) as OrderNotifyDeps);
    expect(send.mock.calls.map((c) => [c[0], (c[1] as any).subject.split(':')[0]])).toEqual([
      ['web-owner@example.com', 'New booking'], ['web-owner@example.com', 'New order'],
    ]);
  });
  it('a web-shaped shop that is dropped logs the reason (no iOS link, so it would be a web shop)', async () => {
    const warn = vi.spyOn(console, 'warn');
    const shop = { owner_id: 'owner-1', ios_otid: null };
    expect(await isWebShop(shop, async () => true)).toBe(false); // flag off
    flagOn();
    expect(await isWebShop(shop, async () => false)).toBe(false); // no entitled plan in this mode
    expect(await isWebShop(shop, undefined)).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('WEB_APP_ENTITLEMENTS is off'),
      expect.stringContaining('no entitled web plan'),
      expect.stringContaining('no plan lookup'),
    ]);
    warn.mockClear();
    expect(await isWebShop({ owner_id: 'o', ios_otid: 'otid-1' }, async () => true)).toBe(false); // iOS shop: silent, as before
    expect(warn).not.toHaveBeenCalled();
  });
});
