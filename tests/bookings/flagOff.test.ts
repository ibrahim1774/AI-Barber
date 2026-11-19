// Flag-off pins: with require_card false (or the column missing) nothing a shop, customer or owner sees may change.
// The golden emails were recorded from origin/main (c842ca87) before any behaviour change.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { confirmationEmail, cancellationEmail, rescheduleEmail, reminderEmail, notify, type NotifyDeps } from '../../lib/bookings/notify.js';
import { ownerEmailFor } from '../../lib/webApp/ownerNotify.js';
import { createAppointment, getShop } from '../../lib/bookings/publicFlow.js';
import { baseCtx, CASES } from './flagOffCases.js';
import { world } from './fakeRepo.js';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/flagOffEmails.json', import.meta.url), 'utf8'));
const T10 = '2026-11-03T15:00:00.000Z';
const customer = { name: 'Sam Lee', phone: '(555) 123-4567', email: 'sam@example.com' };
const cardShop = { stripe_account_id: 'acct_1', stripe_charges_enabled: true, manual_handles: { cashapp: '$fresh' } };
// cardOnly and uniformPrice are the additive per-service fields.
const strip = (services: any[]) => services.map(({ cardOnly: _c, uniformPrice: _u, ...s }) => s);

describe('customer emails for unpaid and paid-in-full bookings are unchanged', () => {
  for (const [name, over] of Object.entries(CASES)) {
    it(name, () => {
      const c = baseCtx(over);
      expect({
        confirmation: confirmationEmail(c, 1), cancellation: cancellationEmail(c, 'customer', 0, 1),
        reschedule: rescheduleEmail(c, 1), reminder: reminderEmail(c),
      }).toEqual(golden[name]);
    });
  }
});

describe('owner "New booking" email without a payment line is unchanged', () => {
  it('no paid field', () => {
    const when = { whenShort: 'Sat 3:00 PM', whenLong: 'Saturday, October 24 at 3:00 PM' };
    expect(ownerEmailFor({ kind: 'booking_created', customerName: 'Jake Lee', service: 'Fade', ...when }, 'Ibrahim', 'https://www.aibarber.org')).toEqual(golden.owner);
  });
  it('notify sends the owner event with no paid key for unpaid bookings', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit');
    const emailOwner = vi.fn(async () => 'sent' as const);
    const d: NotifyDeps = {
      loadContext: vi.fn(async () => ({ ...baseCtx({ payment_status: 'none' }), shop: { ...baseCtx().shop, ios_otid: null } })), sendEmail: vi.fn(async () => 'sent' as const), push: vi.fn(async () => ({})),
      emailOwner, ownerHasWebPlan: vi.fn(async () => true), now: () => 0,
    } as any;
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d);
    vi.unstubAllEnvs();
    expect(emailOwner).toHaveBeenCalled();
    expect(Object.keys((emailOwner.mock.calls[0] as any)[1]).sort()).toEqual(['customerName', 'kind', 'service', 'whenLong', 'whenShort']);
  });
});

describe('booking flow with require_card false or missing', () => {
  for (const flag of ['missing', 'false'] as const) {
    const shopOver = () => ({ ...cardShop, pay_in_shop: true, ...(flag === 'false' ? { require_card: false } : {}) });
    const mk = () => {
      const w = world({ shop: shopOver() as any });
      Object.assign(w.state.services[0], { deposit_type: 'percent', deposit_value: 50 });
      return w;
    };
    const body = (w: ReturnType<typeof mk>, over: Record<string, unknown>) => ({ slug: 'fresh-cuts', serviceId: w.ids.cut, memberId: 'any', start: T10, customer, ...over });

    it(`${flag}: shop payload is today's apart from cardOnly:false`, async () => {
      const w = mk();
      const b = (await getShop({ slug: 'fresh-cuts' }, w.deps)).body as any;
      expect(b.shop.pay).toEqual({ inShop: true, card: true, manual: { cashapp: '$fresh' } });
      expect(strip(b.services)).toEqual([{ id: w.ids.cut, name: 'Haircut', priceCents: 3000, durationMin: 30, description: null, photoUrl: null, depositCents: 1500 }]);
      expect(b.services.every((s: any) => s.cardOnly === false && s.uniformPrice === true && !('cardOnlyMemberIds' in s))).toBe(true);
      expect(Object.keys(b.shop).sort()).toEqual(['accent', 'address', 'cancelCutoffMin', 'name', 'pay', 'phone', 'slug', 'timezone']);
    });
    it(`${flag}: pay shop and manual still book, card still books`, async () => {
      for (const over of [{ pay: 'shop' }, { pay: 'manual', method: 'cashapp' }, { pay: 'card' }]) {
        const w = mk();
        const r = await createAppointment(body(w, over), w.deps);
        expect(r.status, JSON.stringify(over)).toBe(201);
        expect((r.body as any).appointment.depositCents).toBe(1500);
      }
    });
  }
});

describe('deposit bookings: the new wording and the owner line', () => {
  const dep = { payment_status: 'deposit', payment_method: 'card', amount_paid_cents: 2250, price_cents: 4500 } as const;
  it('customer emails get "Paid $22.50 deposit" and "Due at the shop $22.50"', () => {
    const c = baseCtx(dep);
    for (const m of [confirmationEmail(c, 1), rescheduleEmail(c, 1), reminderEmail(c)]) {
      expect(m.html).toContain('$22.50 deposit');
      expect(m.html).toContain('Due at the shop');
      expect(m.html.match(/\$22\.50/g)).toHaveLength(2);
    }
  });
  it('the cancellation email never shows a due row', () => {
    const m = cancellationEmail(baseCtx(dep), 'customer', 2250, 1);
    expect(m.html).toContain('$22.50 deposit');
    expect(m.html).not.toContain('Due at the shop');
    expect(cancellationEmail(baseCtx({ ...dep, status: 'cancelled' }), 'shop', 0, 1).html).not.toContain('Due at the shop');
  });
  it('a deposit booking whose visit is done shows no due row', () => {
    expect(confirmationEmail(baseCtx({ ...dep, status: 'done' }), 1).html).not.toContain('Due at the shop');
  });
  it('the owner event and email carry the Payment line only for a deposit booking', async () => {
    vi.stubEnv('WEB_APP_ENTITLEMENTS', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_live_unit');
    const emailOwner = vi.fn(async () => 'sent' as const);
    const d: NotifyDeps = {
      loadContext: vi.fn(async () => ({ ...baseCtx(dep), shop: { ...baseCtx().shop, ios_otid: null } })), sendEmail: vi.fn(async () => 'sent' as const),
      push: vi.fn(async () => ({})), emailOwner, ownerHasWebPlan: vi.fn(async () => true), now: () => 0,
    } as any;
    await notify({ kind: 'booking_created', appointmentId: 'appt-1' }, d);
    vi.unstubAllEnvs();
    const ev = (emailOwner.mock.calls[0] as any)[1];
    expect(ev.paid).toBe('Deposit paid $22.50 · $22.50 due');
    const m = ownerEmailFor(ev, 'Ibrahim', 'https://www.aibarber.org');
    expect(m.html).toContain('Payment');
    expect(m.html).toContain('Deposit paid $22.50 · $22.50 due');
    expect(m.text).toContain('Deposit paid $22.50 · $22.50 due');
  });
});
