// The live portal call (livePanelDeps) sends the cancel-one-subscription flow, never the general portal.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { livePanelDeps } from '../../lib/webApp/domainOneClickLive.js';

afterEach(() => vi.unstubAllGlobals());
process.env.SUPABASE_URL ||= 'https://x.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'k';

describe('livePanelDeps.createPortalSession', () => {
  it('posts the exact form: subscription_cancel for the domain sub, redirect back to the domain screen', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://billing.stripe.com/p' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const deps = livePanelDeps((async () => ({ ok: false })) as any);
    const r = await deps.createPortalSession('cus_1', 'https://app.test/app/domain', 'sub_dom');
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    expect(init.headers['Stripe-Version']).toBe('2024-06-20');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      customer: 'cus_1',
      return_url: 'https://app.test/app/domain',
      'flow_data[type]': 'subscription_cancel',
      'flow_data[subscription_cancel][subscription]': 'sub_dom',
      'flow_data[after_completion][type]': 'redirect',
      'flow_data[after_completion][redirect][return_url]': 'https://app.test/app/domain',
    });
  });
});

describe('livePanelDeps.setRenewal', () => {
  it('POSTs cancel_at_period_end to the one subscription with an Idempotency-Key', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const deps = livePanelDeps((async () => ({ ok: false })) as any);
    await deps.setRenewal!('sub_dom', true, 'k1');
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_dom');
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe('k1');
    expect(init.headers['Stripe-Version']).toBe('2024-06-20');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ cancel_at_period_end: 'true' });
  });
});
