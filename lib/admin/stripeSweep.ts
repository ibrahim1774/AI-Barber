// Stripe list sweeps used by the admin endpoints (moved out of api/admin-overview.ts).

export async function fetchAllSubscriptions(stripeKey: string): Promise<any[]> {
  const subs: any[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ limit: '100', status: 'all' });
    params.append('expand[]', 'data.plan.product');
    params.append('expand[]', 'data.customer');
    if (startingAfter) params.set('starting_after', startingAfter);
    const resp = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!resp.ok) throw new Error(`Stripe subscriptions list failed (${resp.status})`);
    const data = await resp.json();
    subs.push(...(data.data || []));
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return subs;
}

/** Every Stripe customer for one key, paged limit=100, capped at 50 pages (5000 customers). */
export async function fetchAllCustomers(stripeKey: string): Promise<any[]> {
  const customers: any[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const resp = await fetch(`https://api.stripe.com/v1/customers?${params}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!resp.ok) throw new Error(`Stripe customers list failed (${resp.status})`);
    const data = await resp.json();
    customers.push(...(data.data || []));
    if (!data.has_more || !data.data?.length) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return customers;
}
