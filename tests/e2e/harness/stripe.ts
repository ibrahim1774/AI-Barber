// Minimal fake Stripe API (connected-account Checkout and refunds) behind the e2e fetch stub.
// Enough to exercise the real lib/store/payments.ts and lib/bookings/payments.ts request building:
// amount_total is computed from the line items plus the fixed shipping rate, Idempotency-Key replays
// the first response, refunds are clamped per payment intent and answer charge_already_refunded once
// the charge is exhausted. Every request is logged with its form params and Stripe-Account header.

export interface StripeSession {
  id: string;
  object: 'checkout.session';
  url: string;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'unpaid' | 'paid';
  amount_total: number;
  amount_subtotal: number;
  currency: string;
  client_reference_id: string | null;
  metadata: Record<string, string>;
  payment_intent: string | null;
  account: string | null;
  application_fee_amount: number | null;
  expires_at: number;
  shipping_amount: number | null;
  params: Record<string, string>;
}

export interface StripeRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  account: string | null;
  idempotencyKey: string | null;
}

export const stripe = {
  n: 0,
  sessions: new Map<string, StripeSession>(),
  /** payment intent → captured / refunded cents. */
  charges: new Map<string, { amount: number; refunded: number; account: string | null; refunds: string[] }>(),
  idem: new Map<string, { status: number; body: any }>(),
  requests: [] as StripeRequest[],
  /** Fail the next matching request: return { status, body } or throw (network). */
  failNext: [] as { match: (r: StripeRequest) => boolean; status?: number; body?: any; network?: boolean; afterProcess?: boolean }[],
  /** Make Checkout report this amount_total instead of the computed one (total-mismatch probe). */
  overrideTotal: null as number | null,
};

export function resetStripe() {
  stripe.n = 0;
  stripe.sessions.clear();
  stripe.charges.clear();
  stripe.idem.clear();
  stripe.requests.length = 0;
  stripe.failNext.length = 0;
  stripe.overrideTotal = null;
}

const json = (status: number, body: any) => ({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) });
const error = (status: number, code: string, message = code) => json(status, { error: { code, message, type: 'invalid_request_error' } });

function parseForm(body: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body || '')) out[k] = v;
  return out;
}

/** Pay a session (the customer completed Checkout): returns the checkout.session.completed object. */
export function paySession(id: string, opts: { amount?: number } = {}): StripeSession {
  const s = stripe.sessions.get(id);
  if (!s) throw new Error(`fake stripe: no session ${id}`);
  s.status = 'complete';
  s.payment_status = 'paid';
  s.payment_intent = s.payment_intent ?? `pi_${++stripe.n}`;
  if (opts.amount != null) s.amount_total = opts.amount;
  stripe.charges.set(s.payment_intent, { amount: s.amount_total, refunded: 0, account: s.account, refunds: [] });
  return JSON.parse(JSON.stringify(s));
}

/** A charge.refunded object for a payment intent (Stripe's cumulative totals). */
export function chargeRefundedObject(pi: string) {
  const c = stripe.charges.get(pi);
  if (!c) throw new Error(`fake stripe: no charge for ${pi}`);
  return { id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount: c.amount, amount_captured: c.amount, amount_refunded: c.refunded, refunded: c.refunded >= c.amount };
}

/** Refund straight in the dashboard (no idempotency key; not through our code). */
export function dashboardRefund(pi: string, amount: number) {
  const c = stripe.charges.get(pi)!;
  c.refunded = Math.min(c.amount, c.refunded + amount);
  return chargeRefundedObject(pi);
}

export async function handleStripe(url: URL, init: { method: string; headers: Record<string, string>; body?: string }) {
  const path = url.pathname.replace(/^\/v1/, '');
  const params = init.method === 'GET' ? Object.fromEntries(url.searchParams) : parseForm(init.body);
  const req: StripeRequest = {
    method: init.method,
    path,
    params,
    account: init.headers['Stripe-Account'] ?? null,
    idempotencyKey: init.headers['Idempotency-Key'] ?? null,
  };
  stripe.requests.push(req);
  if (!init.headers.Authorization?.startsWith('Bearer ')) return error(401, 'no-key');

  const fi = stripe.failNext.findIndex((f) => f.match(req));
  if (fi >= 0) {
    const f = stripe.failNext.splice(fi, 1)[0];
    if (f.afterProcess) {
      // Stripe did the work; the response never arrived (timeout after the request was accepted),
      // or (with a status) Stripe answered an error anyway (a 500 that actually refunded).
      await route(url, init, req, path, params);
      if (f.status) return json(f.status, f.body ?? { error: { message: 'fake failure', code: 'api_error' } });
      throw new Error('The operation was aborted due to timeout');
    }
    if (f.network) throw new Error('fake stripe: network error');
    return json(f.status ?? 500, f.body ?? { error: { message: 'fake failure', code: 'api_error' } });
  }
  return route(url, init, req, path, params);
}

async function route(url: URL, init: { method: string }, req: StripeRequest, path: string, params: Record<string, string>) {

  if (req.idempotencyKey && init.method === 'POST') {
    const prior = stripe.idem.get(`${req.account}|${req.idempotencyKey}`);
    if (prior) return json(prior.status, prior.body);
  }
  const remember = (status: number, body: any) => {
    if (req.idempotencyKey && init.method === 'POST') stripe.idem.set(`${req.account}|${req.idempotencyKey}`, { status, body });
    return json(status, body);
  };

  if (init.method === 'POST' && path === '/checkout/sessions') {
    let subtotal = 0;
    for (let i = 0; params[`line_items[${i}][quantity]`] != null; i++) {
      subtotal += Number(params[`line_items[${i}][price_data][unit_amount]`]) * Number(params[`line_items[${i}][quantity]`]);
    }
    const shipKey = 'shipping_options[0][shipping_rate_data][fixed_amount][amount]';
    const shipping = params[shipKey] != null ? Number(params[shipKey]) : null;
    const id = `cs_test_${++stripe.n}`;
    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      const m = /^metadata\[(.+)\]$/.exec(k);
      if (m) metadata[m[1]] = v;
    }
    const s: StripeSession = {
      id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}`, status: 'open', payment_status: 'unpaid',
      amount_total: stripe.overrideTotal ?? subtotal + (shipping ?? 0), amount_subtotal: subtotal,
      currency: params['line_items[0][price_data][currency]'] ?? 'usd',
      client_reference_id: params.client_reference_id ?? null, metadata, payment_intent: null, account: req.account,
      application_fee_amount: params['payment_intent_data[application_fee_amount]'] != null ? Number(params['payment_intent_data[application_fee_amount]']) : null,
      expires_at: Number(params.expires_at), shipping_amount: shipping, params,
    };
    stripe.sessions.set(id, s);
    return remember(200, s);
  }

  const expire = /^\/checkout\/sessions\/([^/]+)\/expire$/.exec(path);
  if (init.method === 'POST' && expire) {
    const s = stripe.sessions.get(decodeURIComponent(expire[1]));
    if (!s) return error(404, 'resource_missing');
    if (s.status !== 'open') return error(400, 'checkout_session_not_open', `session is ${s.status}`);
    s.status = 'expired';
    return json(200, s);
  }

  const get = /^\/checkout\/sessions\/([^/]+)$/.exec(path);
  if (init.method === 'GET' && get) {
    const s = stripe.sessions.get(decodeURIComponent(get[1]));
    return s ? json(200, s) : error(404, 'resource_missing');
  }

  if (init.method === 'GET' && path === '/refunds') {
    // Refunds on a payment intent (one item per amount refunded so far, dashboard ones included).
    const c = params.payment_intent ? stripe.charges.get(params.payment_intent) : undefined;
    const data = c && c.account === req.account && c.refunded > 0
      ? [{ id: `re_list_${params.payment_intent}`, object: 'refund', amount: c.refunded, payment_intent: params.payment_intent, status: 'succeeded' }]
      : [];
    return json(200, { object: 'list', data, has_more: false });
  }

  if (init.method === 'GET' && path === '/charges') {
    const pi = params.payment_intent;
    const c = pi ? stripe.charges.get(pi) : undefined;
    const data = c && c.account === req.account
      ? [{ id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount: c.amount, amount_captured: c.amount, amount_refunded: c.refunded, refunded: c.refunded >= c.amount }]
      : [];
    return json(200, { object: 'list', data, has_more: false });
  }

  if (init.method === 'POST' && path === '/refunds') {
    const pi = params.payment_intent;
    const c = stripe.charges.get(pi);
    if (!c) return remember(404, { error: { code: 'resource_missing', message: `no such payment_intent ${pi}` } });
    if (c.account !== req.account) return remember(404, { error: { code: 'resource_missing', message: 'wrong account' } });
    const remaining = c.amount - c.refunded;
    if (remaining <= 0) return remember(400, { error: { code: 'charge_already_refunded', message: 'already refunded' } });
    const amount = params.amount != null ? Number(params.amount) : remaining;
    if (amount > remaining) return remember(400, { error: { code: 'amount_too_large', message: 'amount too large' } });
    c.refunded += amount;
    const id = `re_${++stripe.n}`;
    c.refunds.push(id);
    return remember(200, { id, object: 'refund', amount, payment_intent: pi, status: 'succeeded', metadata: {} });
  }

  return error(404, 'fake-stripe-unknown-route', `${init.method} ${path}`);
}
