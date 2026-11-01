import { describe, it, expect, vi, afterEach } from 'vitest';
import { stripeCall } from '../../lib/webApp/webAppServer.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('stripeCall', () => {
  it('sends the Idempotency-Key header only when asked, and exposes Stripe error code/type', async () => {
    vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'x' }) }));
    vi.stubGlobal('fetch', f);
    await stripeCall('customers', {}, 'POST', { idempotencyKey: 'k1' });
    await stripeCall('customers', {});
    expect((f.mock.calls[0] as any)[1].headers['Idempotency-Key']).toBe('k1');
    expect((f.mock.calls[1] as any)[1].headers['Idempotency-Key']).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'm', code: 'c', type: 'idempotency_error' } }) })));
    await expect(stripeCall('x', {})).rejects.toMatchObject({ status: 400, code: 'c', type: 'idempotency_error' });
  });
});
