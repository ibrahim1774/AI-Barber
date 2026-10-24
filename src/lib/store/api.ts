import { ApiError } from '@/lib/api';
import { accessToken } from '@/lib/accessToken';
import type { Order } from '@/lib/store/data';

/** Owner side of orders: POST /api/shop/orders/:id/{mark,refund}. Orders are read straight from Supabase. */

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';
const TIMEOUT_MS = 30_000;
const OFFLINE = "Couldn't reach Prime Barber. Check your connection and try again.";

export class OrderApiError extends ApiError {
  constructor(status: number, code: string, message: string, public data: any = null) {
    super(status, code, message);
    this.name = 'OrderApiError';
  }
}

const FRIENDLY: Record<string, string> = {
  'card-payment': 'Card payments are recorded by Stripe automatically.',
  'wrong-fulfilment': "That doesn't fit this order. Pickup orders are marked ready, shipping orders shipped.",
  'has-payment': 'This order has been paid. Refund it first, then cancel.',
  'refund-pending': 'A refund is already on its way. Wait for it to finish.',
  'nothing-to-refund': 'There is nothing left to refund on this order.',
  'not-markable': "This order just changed. We've updated it; please check and try again.",
  'not-card': 'Only card payments can be refunded here. Send other refunds yourself.',
  'store-paused': 'Your Prime Barber plan needs to be active to sell online.',
  'not-found': 'That order is no longer available.',
  invalid: "Some details weren't right. Please check and try again.",
  unauthorized: 'Please sign in again.',
};

export function friendlyOrderError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return e.message;
    return FRIENDLY[e.code] ?? 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

async function ownerPost<T>(path: string, body: unknown): Promise<T> {
  const token = await accessToken();
  if (!token) throw new OrderApiError(401, 'unauthorized', FRIENDLY.unauthorized);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let status = 0;
  let raw = '';
  let ok = false;
  try {
    const resp = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = resp.status;
    raw = await resp.text();
    ok = resp.ok;
  } catch {
    throw new OrderApiError(0, 'network', OFFLINE);
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!ok) {
    const code = typeof data?.error === 'string' && data.error ? data.error : `http-${status}`;
    throw new OrderApiError(status, code, FRIENDLY[code] ?? code, data);
  }
  return (data ?? {}) as T;
}

export type MarkAction = 'paid' | 'ready' | 'shipped' | 'done' | 'cancel';

/** Moves an order along. Tracking is only sent (and only allowed by the server) with `shipped`. */
export async function markOrder(
  id: string, action: MarkAction, tracking?: { trackingNumber?: string; trackingUrl?: string },
): Promise<Order> {
  const number = tracking?.trackingNumber?.trim();
  const url = tracking?.trackingUrl?.trim();
  const out = await ownerPost<{ order: Order }>(`/api/shop/orders/${encodeURIComponent(id)}/mark`, {
    action,
    ...(number ? { trackingNumber: number } : {}),
    ...(url ? { trackingUrl: url } : {}),
  });
  return out.order;
}

/** Refunds a card order: the whole refundable amount, or `amountCents`. `pending` = Stripe is retrying. */
export async function refundOrder(
  id: string, amountCents?: number,
): Promise<{ order: Order; refundedCents: number; pending: boolean }> {
  const out = await ownerPost<{ order: Order; refundedCents?: number; pending?: boolean }>(
    `/api/shop/orders/${encodeURIComponent(id)}/refund`,
    amountCents != null ? { amountCents } : {},
  );
  return { order: out.order, refundedCents: out.refundedCents ?? 0, pending: !!out.pending };
}
