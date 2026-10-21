import { formatMoney } from '@/lib/bookings/calendar';
import { parseDollars } from '@/lib/store/money';
import type { Order, OrderStatus } from '@/lib/store/data';

export type OrderAction = 'paid' | 'ready' | 'shipped' | 'done' | 'cancel' | 'refund';

const inStatus = (o: Order, ...s: OrderStatus[]) => s.includes(o.status);

/** Card money the shop still holds on this order. */
export const refundableCents = (o: Order): number => Math.max(0, o.amountPaidCents - o.amountRefundedCents);

/**
 * The buttons the order sheet may show, in a fixed order. This mirrors the contract's
 * transition table; the server is still the authority and answers 409 when state moved.
 */
export function availableActions(o: Order): OrderAction[] {
  const out: OrderAction[] = [];
  const card = o.paymentMethod === 'card';
  const held = o.amountPaidCents - o.amountRefundedCents;
  if (!card && (o.paymentStatus === 'none' || o.paymentStatus === 'awaiting') && o.status !== 'cancelled') out.push('paid');
  if (o.fulfilment === 'pickup' && inStatus(o, 'new', 'paid')) out.push('ready');
  if (o.fulfilment === 'shipping' && inStatus(o, 'new', 'paid')) out.push('shipped');
  if (inStatus(o, 'new', 'paid', 'ready', 'shipped')) out.push('done');
  // Card money must be refunded first; manual and in-shop money never passed through us, so those can always be cancelled.
  if (inStatus(o, 'new', 'paid') && (!card || held === 0)) out.push('cancel');
  // A cancelled card order's refund belongs to the webhook; offering it here would race that refund.
  if (card && o.status !== 'cancelled' && refundableCents(o) > 0 && !o.refundPending && !o.refundStuck) out.push('refund');
  return out;
}

const STATUS: Record<OrderStatus, string> = {
  new: 'New', paid: 'Paid', ready: 'Ready for pickup', shipped: 'Shipped', done: 'Done', cancelled: 'Cancelled',
};
export const statusLabel = (s: OrderStatus): string => STATUS[s] ?? s;

const METHOD: Record<string, string> = { cashapp: 'Cash App', venmo: 'Venmo', zelle: 'Zelle', paypal: 'PayPal' };
export const methodName = (m: Order['paymentMethod']): string => (m ? METHOD[m] ?? '' : '');

/** One line about the money: "Paid by card", "Awaiting Cash App", "Pay at pickup", "Refunded $5". */
export function paymentLabel(o: Order): string {
  if (o.paymentStatus === 'refunded') return `Refunded ${formatMoney(o.amountRefundedCents)}`;
  if (o.paymentStatus === 'partially_refunded') return `Partly refunded ${formatMoney(o.amountRefundedCents)}`;
  const name = methodName(o.paymentMethod);
  if (o.paymentStatus === 'paid' || o.paymentStatus === 'deposit') {
    if (o.paymentMethod === 'card') return 'Paid by card';
    if (o.paymentMethod === 'shop') return 'Paid in shop';
    return name ? `Paid by ${name}` : 'Paid';
  }
  if (o.paymentStatus === 'awaiting') {
    if (o.paymentMethod === 'card') return 'Awaiting card payment';
    if (o.paymentMethod === 'shop') return o.fulfilment === 'pickup' ? 'Pay at pickup' : 'Awaiting payment';
    return name ? `Awaiting ${name}` : 'Awaiting payment';
  }
  if (o.paymentMethod === 'shop' && o.fulfilment === 'pickup') return 'Pay at pickup';
  return 'Not paid';
}

/** "2 × Beard oil, Pomade" */
export function itemsSummary(items: Order['items']): string {
  return items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name)).join(', ');
}

/** A typed refund amount ("$5") in cents; null when it is not a positive amount. */
export function parseRefundAmount(text: string): number | null {
  const c = parseDollars(text);
  return c != null && c > 0 ? c : null;
}

export const orderNumber = (o: Pick<Order, 'number'>): string => `#${o.number}`;

export type OrderTone = 'neutral' | 'good' | 'warn' | 'bad';

/** Chip colour: new orders need the barber (warn), cancelled are bad, done/paid-through are good. */
export function statusTone(s: OrderStatus): OrderTone {
  if (s === 'new') return 'warn';
  if (s === 'cancelled') return 'bad';
  if (s === 'done' || s === 'shipped' || s === 'ready') return 'good';
  return 'neutral';
}

/** The shipping address as lines to read and copy: name, street, "City, ST 12345", country. */
export function addressLines(a: Record<string, string> | null | undefined): string[] {
  if (!a) return [];
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [a.name, a.line1, a.line2, cityLine, a.country].map((l) => (l ?? '').trim()).filter(Boolean);
}

/** "Sam says they paid by Cash App" (null when the customer said nothing, or it is already paid). */
export function saidPaidNote(o: Order): string | null {
  if (!o.customerSaysPaidAt || o.paymentStatus === 'paid' || o.status === 'cancelled') return null;
  const who = o.customer.name.trim().split(/\s+/)[0] || 'The customer';
  const via = methodName(o.paymentMethod);
  return via ? `${who} says they paid by ${via}. Check your account, then mark it paid.` : `${who} says they paid.`;
}

/** A cancelled card order that was paid and not yet fully refunded: the refund is automatic. */
export const refundingAutomatically = (o: Order): boolean =>
  o.status === 'cancelled' && o.paymentMethod === 'card' && o.amountRefundedCents < o.amountPaidCents;
