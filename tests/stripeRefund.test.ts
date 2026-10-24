import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCancelAndRefund, type StripeCall } from '../lib/ios/domainLive.js';
import { STRIPE_API_VERSION } from '../lib/stripeVersion.js';

function stripe(responses: Record<string, any>) {
  const calls: { method: string; path: string; opts: any }[] = [];
  const call: StripeCall = vi.fn(async (method, p, opts) => {
    calls.push({ method, path: p, opts });
    const key = `${method} ${p.split('?')[0]}`;
    const r = responses[key];
    return r ?? { ok: false, status: 404, data: null };
  });
  return { call, calls };
}

describe('cancel + refund a refused domain subscription (R2)', () => {
  it('older API shape: invoice.payment_intent; refund with an idempotency key, then cancel', async () => {
    const s = stripe({
      'GET /v1/subscriptions/sub_abc123': { ok: true, status: 200, data: { status: 'active', latest_invoice: 'in_1' } },
      'GET /v1/invoices/in_1': { ok: true, status: 200, data: { payment_intent: 'pi_1' } },
      'POST /v1/refunds': { ok: true, status: 200, data: { id: 're_1' } },
      'DELETE /v1/subscriptions/sub_abc123': { ok: true, status: 200, data: {} },
    });
    await makeCancelAndRefund(s.call)('sub_abc123');
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /v1/subscriptions/sub_abc123', 'GET /v1/invoices/in_1', 'POST /v1/refunds', 'DELETE /v1/subscriptions/sub_abc123',
    ]);
    expect(s.calls[2].opts).toEqual({ form: { payment_intent: 'pi_1' }, idem: 'domain-refund-sub_abc123' });
    expect(s.calls.some((c) => c.path.includes('expand'))).toBe(false);
  });

  it('basil shape (no invoice.payment_intent / charge): the payment comes from /v1/invoice_payments', async () => {
    const s = stripe({
      'GET /v1/subscriptions/sub_abc123': { ok: true, status: 200, data: { status: 'active', latest_invoice: { id: 'in_2' } } },
      'GET /v1/invoices/in_2': { ok: true, status: 200, data: { id: 'in_2', payments: { object: 'list' } } },
      'GET /v1/invoice_payments': { ok: true, status: 200, data: { data: [{ status: 'paid', payment: { type: 'payment_intent', payment_intent: 'pi_2' } }] } },
      'POST /v1/refunds': { ok: true, status: 200, data: {} },
      'DELETE /v1/subscriptions/sub_abc123': { ok: true, status: 200, data: {} },
    });
    await makeCancelAndRefund(s.call)('sub_abc123');
    expect(s.calls.find((c) => c.path.startsWith('/v1/invoice_payments'))!.path).toBe('/v1/invoice_payments?invoice=in_2&limit=10');
    expect(s.calls.find((c) => c.path === '/v1/refunds')!.opts.form).toEqual({ payment_intent: 'pi_2' });
  });

  it('already refunded counts as done; an already-cancelled subscription is not cancelled again', async () => {
    const s = stripe({
      'GET /v1/subscriptions/sub_abc123': { ok: true, status: 200, data: { status: 'canceled', latest_invoice: 'in_1' } },
      'GET /v1/invoices/in_1': { ok: true, status: 200, data: { charge: 'ch_1' } },
      'POST /v1/refunds': { ok: false, status: 400, data: { error: { code: 'charge_already_refunded' } } },
    });
    await makeCancelAndRefund(s.call)('sub_abc123');
    expect(s.calls.map((c) => c.method)).not.toContain('DELETE');
  });

  it('no payment found / refund failure throws (retried)', async () => {
    const none = stripe({
      'GET /v1/subscriptions/sub_abc123': { ok: true, status: 200, data: { latest_invoice: 'in_1' } },
      'GET /v1/invoices/in_1': { ok: true, status: 200, data: {} },
      'GET /v1/invoice_payments': { ok: true, status: 200, data: { data: [] } },
    });
    await expect(makeCancelAndRefund(none.call)('sub_abc123')).rejects.toThrow(/no payment/);
  });

  it('every Stripe call in the domain flow pins the API version', () => {
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const f of ['lib/ios/domainLive.ts', 'api/create-domain-checkout.ts', 'api/web-domain.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      const fetches = src.match(/fetch\([`'"]https:\/\/api\.stripe\.com/g)?.length ?? 0;
      const pinned = src.match(/'Stripe-Version': STRIPE_API_VERSION/g)?.length ?? 0;
      expect(pinned, f).toBeGreaterThanOrEqual(fetches);
    }
  });
});
