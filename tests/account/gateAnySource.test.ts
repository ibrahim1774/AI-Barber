// Lane B2 under GATE_ANY_SOURCE: gateRow fallback, owner emails by account plan. Switch off: today's paths, no new read.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gateRow } from '../../lib/webApp/entitlementGate.js';
import { isWebShop, isWebShopToday, maybeEmailOwner } from '../../lib/webApp/ownerNotify.js';
import { notify, type NotifyContext } from '../../lib/bookings/notify.js';
import { notifyOrder, type OrderNotifyContext } from '../../lib/store/notify.js';

const P = 'com.ibrahim1774.aibarber.';
const row = (o: any = {}) => ({ original_transaction_id: 'x', product_id: `${P}bookings.monthly`, environment: 'Production', expires_at: '2099-01-01T00:00:00Z', revoked_at: null, taken_down_at: null, site_slug: null, published_at: null, ...o });
const lapsed = row({ taken_down_at: '2026-11-01T00:00:00Z' });
const webLive = row({ original_transaction_id: 'web:sub_1', product_id: `${P}store.monthly` });
const webFree = row({ original_transaction_id: 'web:free:u1', product_id: `${P}bookings.yearly` });
const webDead = row({ original_transaction_id: 'web:sub_1', taken_down_at: '2026-11-01T00:00:00Z' });

beforeEach(() => vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'));
afterEach(() => vi.unstubAllEnvs());

describe('gateRow', () => {
  const shop = { ios_otid: 'o1', owner_id: 'u1' };
  const mk = (ios: any, web: any) => ({ purchase: vi.fn(async () => ios), webEntitlementOf: vi.fn(async () => web) });
  const table: Array<[string, any, any, any]> = [
    ['apple live, card live: apple', row(), webLive, 'ios'],
    ['apple lapsed, card live: the card', lapsed, webLive, 'web'],
    ['apple lapsed, Free: Free', lapsed, webFree, 'web'],
    ['apple lapsed, card ended: apple row as today', lapsed, webDead, 'ios'],
    ['apple lapsed, nothing: apple row as today', lapsed, null, 'ios'],
    ['linked purchase row missing, card live: the card', null, webLive, 'web'],
  ];
  for (const [name, ios, web, want] of table) {
    it(`on: ${name}`, async () => {
      vi.stubEnv('GATE_ANY_SOURCE', '1');
      expect(await gateRow(mk(ios, web), shop)).toBe(want === 'ios' ? ios : web);
    });
    it(`off: ${name} gives the linked purchase only and never reads the web plan`, async () => {
      const repo = mk(ios, web);
      expect(await gateRow(repo, shop)).toBe(ios);
      expect(repo.webEntitlementOf).not.toHaveBeenCalled();
    });
  }
  it('on, live apple: no web read', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const repo = mk(row(), webLive);
    await gateRow(repo, shop);
    expect(repo.webEntitlementOf).not.toHaveBeenCalled();
  });
  it('no link at all is unchanged either way', async () => {
    const repo = mk(null, webLive);
    expect(await gateRow(repo, { ios_otid: null, owner_id: 'u1' })).toBe(webLive);
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    expect(await gateRow(repo, { ios_otid: null, owner_id: 'u1' })).toBe(webLive);
  });
});

describe('isWebShop', () => {
  const lookups = () => ({ web: vi.fn(async () => true), any: vi.fn(async () => true) });
  it('off: an iOS-linked shop is false and nothing is looked up, exactly as before', async () => {
    const l = lookups();
    expect(await isWebShop({ owner_id: 'o', ios_otid: 'x' }, l.web, l.any)).toBe(false);
    expect(l.web).not.toHaveBeenCalled();
    expect(l.any).not.toHaveBeenCalled();
    expect(await isWebShop({ owner_id: 'o', ios_otid: 'x' }, l.web, l.any)).toBe(await isWebShopToday({ owner_id: 'o', ios_otid: 'x' }, l.web));
  });
  it('off: an unlinked shop uses the web plan lookup only', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    const l = lookups();
    expect(await isWebShop({ owner_id: 'o', ios_otid: null }, l.web, l.any)).toBe(true);
    expect(l.web).toHaveBeenCalledTimes(1);
    expect(l.any).not.toHaveBeenCalled();
  });
  it('on: an Apple-paid shop is true; a lapsed ios_otid with a live card is true; no live plan is false; an error is false', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const l = lookups();
    expect(await isWebShop({ owner_id: 'o', ios_otid: 'live-apple' }, undefined, l.any)).toBe(true);
    expect(await isWebShop({ owner_id: 'o', ios_otid: 'lapsed' }, undefined, async () => true)).toBe(true);
    expect(await isWebShop({ owner_id: 'o', ios_otid: 'lapsed' }, undefined, async () => false)).toBe(false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await isWebShop({ owner_id: 'o' }, undefined, async () => { throw new Error('db'); })).toBe(false);
    err.mockRestore();
    expect(l.web).not.toHaveBeenCalled();
  });
  it('on: maybeEmailOwner sends exactly once', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const send = vi.fn(async () => 'sent');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await maybeEmailOwner({ owner_id: 'o', ios_otid: 'x' }, { kind: 'booking_created' } as any, send, undefined, async () => true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('owner email per booking and order event', () => {
  const bctx = (ios_otid: string | null): NotifyContext => ({
    appt: { id: 'a1', shop_id: 's', member_id: 'm', start_at: '2026-10-24T19:00:00Z', end_at: '2026-10-24T19:30:00Z', service_name: 'Fade', price_cents: 3000, customer_name: 'Jake', customer_email: 'j@example.com', status: 'booked', cancelled_by: null, payment_status: 'none', payment_method: 'shop', amount_paid_cents: 0, amount_refunded_cents: 0, manage_token: 't', source: 'online' } as any,
    shop: { id: 's', name: 'Fade', slug: 'ff', timezone: 'America/New_York', owner_id: 'owner-1', ios_otid } as any,
    memberName: null, memberUserId: null, ownerEmail: 'owner@example.com',
  });
  const mkd = (c: NotifyContext, live: boolean | 'absent') => ({
    loadContext: vi.fn(async () => c), sendEmail: vi.fn(async () => 'sent' as const), push: vi.fn(async () => ({})),
    emailOwner: vi.fn(async () => 'sent'), ownerHasWebPlan: vi.fn(async () => false),
    ...(live === 'absent' ? {} : { ownerHasLivePlan: vi.fn(async () => live) }), now: () => 0,
  });
  beforeEach(() => vi.spyOn(console, 'info').mockImplementation(() => {}));
  it('on: an Apple-paid shop gets one owner email per booking', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const d = mkd(bctx('apple-otid'), true);
    await notify({ kind: 'booking_created', appointmentId: 'a1' } as any, d as any);
    expect(d.emailOwner).toHaveBeenCalledTimes(1);
  });
  it('on: a card-paid shop with a lapsed ios_otid gets one', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const d = mkd(bctx('lapsed-otid'), true);
    await notify({ kind: 'booking_created', appointmentId: 'a1' } as any, d as any);
    expect(d.emailOwner).toHaveBeenCalledTimes(1);
  });
  it('on: no live plan, no owner email', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const d = mkd(bctx('x'), false);
    await notify({ kind: 'booking_created', appointmentId: 'a1' } as any, d as any);
    expect(d.emailOwner).not.toHaveBeenCalled();
  });
  it('off: an iOS-linked shop gets no owner email and the new lookup is never called', async () => {
    const d = mkd(bctx('apple-otid'), true);
    await notify({ kind: 'booking_created', appointmentId: 'a1' } as any, d as any);
    expect(d.emailOwner).not.toHaveBeenCalled();
    expect((d as any).ownerHasLivePlan).not.toHaveBeenCalled();
    expect(d.ownerHasWebPlan).not.toHaveBeenCalled();
  });
  it('off: an unlinked shop with a web plan still gets one', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    const d = mkd(bctx(null), true);
    d.ownerHasWebPlan = vi.fn(async () => true);
    await notify({ kind: 'booking_created', appointmentId: 'a1' } as any, d as any);
    expect(d.emailOwner).toHaveBeenCalledTimes(1);
  });
  it('on: store orders too, once', async () => {
    vi.stubEnv('GATE_ANY_SOURCE', '1');
    const c: OrderNotifyContext = {
      order: { id: 'o1', shop_id: 's', order_no: 1, manage_token: 't', customer_name: 'Sam', customer_email: 's@example.com', fulfilment: 'pickup', shipping_address: null, subtotal_cents: 100, shipping_cents: 0, total_cents: 100, status: 'new', payment_status: 'awaiting', payment_method: 'cashapp', amount_paid_cents: 0, amount_refunded_cents: 0, tracking_number: null, tracking_url: null } as any,
      items: [{ name: 'Oil', unit_price_cents: 100, quantity: 1 }], shop: { id: 's', name: 'F', slug: 'f', owner_id: 'owner-1', ios_otid: 'apple' } as any, ownerEmail: 'o@example.com', pushUserIds: ['owner-1'],
    };
    const d: any = { loadContext: vi.fn(async () => c), sendEmail: vi.fn(async () => 'sent'), push: vi.fn(async () => ({})), emailOwner: vi.fn(async () => 'sent'), ownerHasWebPlan: vi.fn(async () => false), ownerHasLivePlan: vi.fn(async () => true), now: () => 0 };
    await notifyOrder({ kind: 'order_created', orderId: 'o1' } as any, d);
    expect(d.emailOwner).toHaveBeenCalledTimes(1);
  });
});
