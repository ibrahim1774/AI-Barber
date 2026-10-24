// api/stripe-webhook.ts: a paid domain checkout reports the same server-side Purchase as a site
// checkout (Meta CAPI + Triple Whale), with the domain's own content; nothing is published.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import { EventEmitter } from 'events';

const { handleDomainStripeEvent, pushOrderToTripleWhale, publishSite } = vi.hoisted(() => ({
  handleDomainStripeEvent: vi.fn(),
  pushOrderToTripleWhale: vi.fn(async () => ({ ok: true })),
  publishSite: vi.fn(),
}));
vi.mock('../lib/webDomains.js', () => ({ handleDomainStripeEvent, DOMAIN_PURCHASE_PLAN: 'domain-yearly' }));
vi.mock('../lib/ios/domainLive.js', () => ({ liveWebDomainDeps: () => ({}) }));
vi.mock('../api/_twOrder.js', () => ({ pushOrderToTripleWhale }));
vi.mock('../lib/publishSite.js', () => ({ publishSite }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

import handler from '../api/stripe-webhook.js';

const SECRET = 'whsec_test';
function req(event: unknown) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  const r: any = new EventEmitter();
  r.method = 'POST';
  r.headers = { 'stripe-signature': `t=${t},v1=${sig}` };
  setTimeout(() => { r.emit('data', Buffer.from(raw)); r.emit('end'); }, 0);
  return r;
}
const mkRes = () => { const res: any = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
const session = { id: 'cs_live_dom1', amount_total: 3900, currency: 'usd', payment_status: 'paid', customer_details: { email: 'b@x.com', name: 'Joe Barber' }, metadata: { type: 'domain_purchase', app: 'aibarber-domain' } };

describe('stripe webhook: domain checkout Purchase', () => {
  afterAll(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('FB_ACCESS_TOKEN', 'tok');
    vi.stubEnv('FB_PIXEL_ID', 'px');
    vi.restoreAllMocks();
    pushOrderToTripleWhale.mockClear();
  });

  it('a paid domain checkout → Meta Purchase (event_id = session id, $39, domain content) + Triple Whale; no site publish', async () => {
    handleDomainStripeEvent.mockResolvedValueOnce({ handled: true, status: 200, body: { received: true, domain: true }, purchase: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ events_received: 1 }) } as any);
    const res = mkRes();
    await handler(req({ type: 'checkout.session.completed', data: { object: session } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [url, init] = fetchSpy.mock.calls[0] as any[];
    expect(url).toBe('https://graph.facebook.com/v21.0/px/events');
    const body = JSON.parse(init.body);
    expect(body.data[0]).toMatchObject({ event_name: 'Purchase', event_id: 'cs_live_dom1', custom_data: { value: 39, currency: 'USD', content_ids: ['aibarber-custom-domain-yearly'] } });
    expect(body.data[0].user_data.em).toBeTruthy(); // hashed email, the same fields site checkouts send
    expect(pushOrderToTripleWhale).toHaveBeenCalledWith(session);
    expect(publishSite).not.toHaveBeenCalled();
  });

  it('a Meta failure → 500 so Stripe retries (the domain part is idempotent)', async () => {
    handleDomainStripeEvent.mockResolvedValueOnce({ handled: true, status: 200, purchase: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'bad' } }) } as any);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = mkRes();
    await handler(req({ type: 'checkout.session.completed', data: { object: session } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('domain lifecycle events (no purchase) report nothing', async () => {
    handleDomainStripeEvent.mockResolvedValueOnce({ handled: true, status: 200, body: { received: true } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = mkRes();
    await handler(req({ type: 'customer.subscription.updated', data: { object: {} } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
