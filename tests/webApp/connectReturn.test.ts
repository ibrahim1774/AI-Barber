import { describe, expect, it } from 'vitest';
import { createAccountLink, type StripeOpts } from '../../lib/bookings/payments';

function fakeFetch(captured: { body?: string }): StripeOpts {
  return { fetch: (async (_u: any, init: any) => { captured.body = String(init.body); return new Response(JSON.stringify({ url: 'https://connect.stripe.com/x' }), { status: 200 }); }) as any } as StripeOpts;
}
process.env.STRIPE_CONNECT_SECRET_KEY = 'sk_test_unit';
describe('createAccountLink return urls', () => {
  it('iOS owners keep the stripe-return page', async () => {
    const c: { body?: string } = {};
    await createAccountLink('shop1', 'acct_1', fakeFetch(c));
    expect(decodeURIComponent(c.body!)).toContain('/stripe-return?shop=shop1&state=return');
  });
  it('web-app owners return to the web app', async () => {
    const c: { body?: string } = {};
    await createAccountLink('shop1', 'acct_1', fakeFetch(c), 'https://www.aibarber.org');
    const b = decodeURIComponent(c.body!);
    expect(b).toContain('return_url=https://www.aibarber.org/app/?stripe=return');
    expect(b).not.toContain('stripe-return');
  });
});
