// Triple Whale Data-In Orders push. The Stripe webhook is the single
// reliable "a real payment happened" signal (the browser only fires the
// TriplePixel Purchase if the customer returns to the tab). TW needs BOTH
// a pixel Purchase (attribution, fired client-side in App.tsx) AND a
// matching order record (source-of-truth revenue, this file) — they join
// on order_id == the Stripe session id, the same id the pixel uses.
//
// Auth is the `x-api-key` header (TW Data-In API). Endpoint + required
// fields per https://triplewhale.readme.io/reference/create-order-record :
// shop, order_id, created_at (ISO), currency, customer{id,email|phone},
// order_revenue. `shop` must match TW Settings → Store (the pixel's
// TripleName, "www.aibarber.org"); `platform` defaults to "custom-msp".

const TW_ORDERS_URL = 'https://api.triplewhale.com/api/v2/data-in/orders';

// Flat shape (all optional) so callers can read any field without
// discriminated-union narrowing gymnastics:
//   skipped  → not configured, no-op
//   retryable→ failure was transient (5xx/network); safe for Stripe retry
type TwResult = { ok: boolean; skipped?: boolean; retryable?: boolean; error?: string };

export async function pushOrderToTripleWhale(session: any): Promise<TwResult> {
  const apiKey = process.env.TW_API_KEY;
  if (!apiKey) return { ok: false, skipped: true };

  const shop = process.env.TW_SHOP || 'www.aibarber.org';
  const details = session.customer_details || {};
  const email = details.email || null;
  const phone = details.phone || null;
  // customer.id is required alongside email|phone. Prefer the Stripe
  // customer id; fall back to email, then the session id, so it is never
  // empty (guest checkouts have no session.customer).
  const customerId = session.customer || email || session.id;

  // Stripe `created` is Unix seconds; fall back to now if absent.
  const createdAt = new Date(
    (typeof session.created === 'number' ? session.created * 1000 : Date.now())
  ).toISOString();

  const orderRevenue =
    typeof session.amount_total === 'number' ? session.amount_total / 100 : 0;

  const body = {
    shop,
    order_id: session.id,
    created_at: createdAt,
    currency: (session.currency || 'usd').toUpperCase(),
    customer: { id: customerId, email, phone },
    order_revenue: orderRevenue,
    payment_gateway_names: ['stripe'],
  };

  try {
    const resp = await fetch(TW_ORDERS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (resp.ok) return { ok: true };

    const text = await resp.text().catch(() => '');
    // 4xx = our payload/key is wrong → retrying will never succeed, so do
    // NOT signal a retry (avoids a Stripe webhook retry loop). 5xx / network
    // = transient → retryable. Re-sending the same order_id is an idempotent
    // upsert on TW's side, so retries are safe.
    const retryable = resp.status >= 500;
    return { ok: false, skipped: false, retryable, error: `${resp.status} ${text.slice(0, 300)}` };
  } catch (err: any) {
    return { ok: false, skipped: false, retryable: true, error: err?.message || 'network error' };
  }
}
