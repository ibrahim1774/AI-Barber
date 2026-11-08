// Stripe list sweeps used by the admin endpoints (moved out of api/admin-overview.ts).

export interface Swept { items: any[]; /** has_more was still true when the page cap was hit */ truncated: boolean }

export async function fetchAllSubscriptions(stripeKey: string): Promise<any[]> {
  return (await sweepSubscriptions(stripeKey)).items;
}

/** Every Stripe customer for one key, capped at 50 pages (5000). */
export async function fetchAllCustomers(stripeKey: string): Promise<any[]> {
  return (await sweepCustomers(stripeKey)).items;
}

/** The Stripe account id (acct_...) behind a key; used to sweep each account once. */
export async function fetchAccountId(stripeKey: string): Promise<string> {
  const resp = await fetch('https://api.stripe.com/v1/account', { headers: { Authorization: `Bearer ${stripeKey}` } });
  if (!resp.ok) throw new Error(`Stripe account lookup failed (${resp.status})`);
  const data = await resp.json();
  if (typeof data?.id !== 'string') throw new Error('Stripe account lookup returned no id');
  return data.id;
}

export async function sweepSubscriptions(stripeKey: string): Promise<Swept> {
  const subs: any[] = [];
  let truncated = false;
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
    if (page === 19) truncated = true;
  }
  return { items: subs, truncated };
}

/** Every Stripe customer for one key, paged limit=100, capped at 50 pages (5000 customers). */
export async function sweepCustomers(stripeKey: string): Promise<Swept> {
  const customers: any[] = [];
  let truncated = false;
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
    if (page === 49) truncated = true;
  }
  return { items: customers, truncated };
}
