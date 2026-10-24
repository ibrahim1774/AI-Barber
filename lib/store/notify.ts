import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail as liveSendEmail, type EmailMessage, type EmailResult } from '../bookings/email.js';
import { pushToUsers, type PushMessage } from '../bookings/push.js';
import { emailLayout, dollars, pushTokenStore, type ManualMethod } from '../bookings/notify.js';
import { serviceDb, SITE_ORIGIN } from '../bookings/payments.js';
import { orderManageUrl, orderNoLabel, shipsWithinLabel } from './payments.js';
import { shopPageUrl } from '../customerUrls.js';
import type { StoreNotifyEvent } from './types.js';

/**
 * Store notifications: owner pushes (Expo) and customer emails (SMTP), in the Phase 2 layout.
 *
 * notifyOrder(event) loads everything it needs from the order id and NEVER throws.
 *
 * - order_created: push to the shop + confirmation email. A card order still awaiting payment
 *   is skipped (the Stripe webhook sends it on payment), and so is a cancelled order.
 * - order_ready / order_shipped / order_cancelled: email to the customer.
 * - order_says_paid: push.
 *
 * Every push carries data { kind: 'order', orderId } and goes to the owner and every active
 * member with a user_id.
 */

// The contract's event union has one declaration, in lib/store/types.ts (S3a's flows emit it).
// order_created for card + awaiting is a no-op here: the webhook sends it on payment.
export type { StoreNotifyEvent };

export interface NotifyOrder {
  id: string;
  shop_id: string;
  order_no: number | null;
  manage_token: string;
  customer_name: string | null;
  customer_email: string | null;
  fulfilment: 'pickup' | 'shipping';
  shipping_address: Record<string, unknown> | null;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  status: 'new' | 'paid' | 'ready' | 'shipped' | 'done' | 'cancelled';
  payment_status: string;
  payment_method: string | null;
  amount_paid_cents: number;
  amount_refunded_cents: number;
  tracking_number: string | null;
  tracking_url: string | null;
}

export interface NotifyOrderItem {
  name: string;
  unit_price_cents: number;
  quantity: number;
}

export interface NotifyStoreShop {
  id: string;
  name: string;
  slug: string | null;
  owner_id: string;
  address?: string | null;
  accent?: string | null;
  manual_handles?: Record<string, unknown> | null;
  store_pickup_note?: string | null;
  ships_within_days?: number | null;
  /** The shop's own site origin (011): customer links use it when set. */
  site_base_url?: string | null;
}

export interface OrderNotifyContext {
  order: NotifyOrder;
  items: NotifyOrderItem[];
  shop: NotifyStoreShop;
  ownerEmail: string | null;
  /** The owner and every active member with a user_id. */
  pushUserIds: string[];
}

export interface OrderNotifyDeps {
  loadContext(orderId: string): Promise<OrderNotifyContext | null>;
  sendEmail(msg: EmailMessage): Promise<EmailResult>;
  push(userIds: string[], msg: Omit<PushMessage, 'to'>): Promise<unknown>;
  now(): number;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const METHOD_LABEL: Record<ManualMethod, string> = { cashapp: 'Cash App', venmo: 'Venmo', zelle: 'Zelle', paypal: 'PayPal' };
const MANUAL: ManualMethod[] = ['cashapp', 'venmo', 'zelle', 'paypal'];
const label = (m: string) => METHOD_LABEL[m as ManualMethod] ?? m;

const orderNo = orderNoLabel;
const customerLabel = (o: NotifyOrder) => o.customer_name?.trim() || 'A customer';
const fromName = (shop: NotifyStoreShop) => `${shop.name} via Prime Barber`;
const orderData = (o: NotifyOrder) => ({ kind: 'order', orderId: o.id });
const isHttps = (u: unknown): u is string => typeof u === 'string' && /^https:\/\/\S+$/i.test(u);

const handleOf = (shop: NotifyStoreShop, m: string): string | null => {
  const h = shop.manual_handles?.[m];
  return typeof h === 'string' && h.trim() ? h.trim() : null;
};

const UNPAID = new Set(['none', 'awaiting']);
const PAID_CARD = new Set(['paid', 'partially_refunded', 'refunded']);

function addressLine(a: Record<string, unknown> | null): string | null {
  if (!a || typeof a !== 'object') return null;
  const s = (k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  const cityLine = [s('city'), [s('state'), s('postal_code')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const parts = [s('name'), s('line1'), s('line2'), cityLine || null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function itemRows(ctx: OrderNotifyContext): [string, string][] {
  return ctx.items.map((it) => [`${it.quantity} × ${it.name}`, dollars(it.unit_price_cents * it.quantity)]);
}

function totalRows(o: NotifyOrder): [string, string][] {
  const rows: [string, string][] = [['Subtotal', dollars(o.subtotal_cents)]];
  if (o.fulfilment === 'shipping') rows.push(['Shipping', dollars(o.shipping_cents)]);
  rows.push(['Total', dollars(o.total_cents)]);
  return rows;
}

/** "Paid by card", "Pay at pickup" or "Send $45 by Cash App to $handle". */
function paymentLine(ctx: OrderNotifyContext): string {
  const { order: o, shop } = ctx;
  if (o.payment_method === 'card') return PAID_CARD.has(o.payment_status) ? 'Paid by card' : 'Card payment pending';
  if (!UNPAID.has(o.payment_status)) return 'Paid';
  if (o.payment_method === 'shop') return 'Pay at pickup';
  const amount = dollars(Math.max(0, o.total_cents - o.amount_paid_cents));
  if (o.payment_method) {
    const h = handleOf(shop, o.payment_method);
    return h ? `Send ${amount} by ${label(o.payment_method)} to ${h}` : `Send ${amount} by ${label(o.payment_method)}`;
  }
  // Manual order with several handles and none chosen: list them all.
  const options = MANUAL.map((m) => [m, handleOf(shop, m)] as const).filter(([, h]) => h).map(([m, h]) => `${label(m)} to ${h}`);
  return options.length ? `Send ${amount} by ${options.join(' or ')}` : 'Pay at pickup';
}

function message(ctx: OrderNotifyContext, subject: string, heading: string, rows: [string, string][], paragraphs: string[], button: { label: string; href: string } | undefined): EmailMessage {
  const { order: o, shop } = ctx;
  const textRows = rows.map(([k, v]) => `${k}: ${v}`);
  return {
    to: o.customer_email!,
    fromName: fromName(shop),
    replyTo: ctx.ownerEmail,
    subject,
    html: emailLayout(shop, heading, rows, paragraphs, button),
    text: [heading, ...textRows, ...paragraphs, ...(button ? [`${button.label}: ${button.href}`] : [])].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

export function orderConfirmationEmail(ctx: OrderNotifyContext): EmailMessage {
  const { order: o, shop } = ctx;
  const rows = [...itemRows(ctx), ...totalRows(o)];
  const paras = [paymentLine(ctx)];
  if (o.fulfilment === 'pickup') {
    if (shop.address) rows.push(['Pickup at', shop.address]);
    if (shop.store_pickup_note?.trim()) paras.push(shop.store_pickup_note.trim());
  } else {
    const addr = addressLine(o.shipping_address);
    if (addr) rows.push(['Ship to', addr]);
    if (shop.ships_within_days != null) paras.push(shipsWithinLabel(shop.ships_within_days));
  }
  return message(ctx, `Order ${orderNo(o)} at ${shop.name}`, `Order ${orderNo(o)}`, rows, paras,
    { label: 'View order', href: orderManageUrl(o.manage_token, shop) });
}

export function orderReadyEmail(ctx: OrderNotifyContext): EmailMessage {
  const { order: o, shop } = ctx;
  const rows: [string, string][] = [['Order', orderNo(o)]];
  if (shop.address) rows.push(['Pickup at', shop.address]);
  const paras = [`Your order ${orderNo(o)} at ${shop.name} is ready for pickup.`];
  if (shop.store_pickup_note?.trim()) paras.push(shop.store_pickup_note.trim());
  const due = Math.max(0, o.total_cents - o.amount_paid_cents);
  if (UNPAID.has(o.payment_status) && due > 0) rows.push(['Amount due at pickup', dollars(due)]);
  return message(ctx, `Your order ${orderNo(o)} is ready for pickup`, 'Ready for pickup', rows, paras,
    { label: 'View order', href: orderManageUrl(o.manage_token, shop) });
}

export function orderShippedEmail(ctx: OrderNotifyContext): EmailMessage {
  const { order: o, shop } = ctx;
  const rows: [string, string][] = [['Order', orderNo(o)]];
  if (o.tracking_number?.trim()) rows.push(['Tracking number', o.tracking_number.trim()]);
  const addr = addressLine(o.shipping_address);
  if (addr) rows.push(['Ship to', addr]);
  const button = isHttps(o.tracking_url)
    ? { label: 'Track package', href: o.tracking_url }
    : { label: 'View order', href: orderManageUrl(o.manage_token, shop) };
  return message(ctx, `Your order ${orderNo(o)} has shipped`, 'Your order has shipped',
    rows, [`Your order ${orderNo(o)} from ${shop.name} is on its way.`], button);
}

export function orderCancelledEmail(ctx: OrderNotifyContext, refundedCents: number): EmailMessage {
  const { order: o, shop } = ctx;
  const paras = [`Your order ${orderNo(o)} at ${shop.name} was cancelled.`];
  if (refundedCents > 0) paras.push(`A refund of ${dollars(refundedCents)} is on its way to your card. It can take 5–10 business days to show.`);
  const shopHref = shopPageUrl(shop, SITE_ORIGIN);
  const shopLink = shopHref ? { label: 'Visit the shop', href: shopHref } : undefined;
  return message(ctx, `Order ${orderNo(o)} was cancelled`, 'Order cancelled',
    [...itemRows(ctx), ['Total', dollars(o.total_cents)]], paras, shopLink);
}

// ---------------------------------------------------------------------------
// notifyOrder
// ---------------------------------------------------------------------------

async function emailCustomer(ctx: OrderNotifyContext, deps: OrderNotifyDeps, build: () => EmailMessage): Promise<EmailResult> {
  if (!ctx.order.customer_email) return 'skipped';
  return deps.sendEmail(build());
}

export async function notifyOrder(event: StoreNotifyEvent, deps?: OrderNotifyDeps): Promise<void> {
  try {
    const d = deps ?? liveOrderNotifyDeps();
    const ctx = await d.loadContext(event.orderId);
    if (!ctx) {
      console.warn('[store/notify] order not found:', event.kind, event.orderId);
      return;
    }
    const { order: o } = ctx;
    const data = orderData(o);
    const jobs: Promise<unknown>[] = [];

    switch (event.kind) {
      case 'order_created': {
        if (o.payment_method === 'card' && o.payment_status === 'awaiting') return; // the webhook sends it on payment
        if (o.status === 'cancelled') return;
        jobs.push(d.push(ctx.pushUserIds, {
          body: `New order ${orderNo(o)}: ${customerLabel(o)}, ${dollars(o.total_cents)} · ${o.fulfilment}`,
          data,
        }));
        jobs.push(emailCustomer(ctx, d, () => orderConfirmationEmail(ctx)));
        break;
      }
      case 'order_ready':
        jobs.push(emailCustomer(ctx, d, () => orderReadyEmail(ctx)));
        break;
      case 'order_shipped':
        jobs.push(emailCustomer(ctx, d, () => orderShippedEmail(ctx)));
        break;
      case 'order_cancelled': {
        const refunded = event.refundedCents ?? o.amount_refunded_cents ?? 0;
        jobs.push(emailCustomer(ctx, d, () => orderCancelledEmail(ctx, refunded)));
        break;
      }
      case 'order_says_paid':
        jobs.push(d.push(ctx.pushUserIds, {
          body: `${customerLabel(o)} says they paid ${dollars(o.total_cents)} by ${label(event.method)} (order ${orderNo(o)})`,
          data,
        }));
        break;
      default:
        return;
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') console.error('[store/notify] job failed:', (r.reason as any)?.message || r.reason);
  } catch (e: any) {
    console.error('[store/notify] failed:', event?.kind, e?.message || e);
  }
}

// ---------------------------------------------------------------------------
// Live (Supabase service role) dependencies
// ---------------------------------------------------------------------------

function dbFail(op: string, error: { message?: string } | null): never {
  throw new Error(`store/notify ${op} failed: ${error?.message ?? 'unknown'}`);
}

export function liveOrderNotifyDeps(db: SupabaseClient = serviceDb()): OrderNotifyDeps {
  const store = pushTokenStore(db);
  return {
    async loadContext(orderId) {
      const { data: order, error } = await db.from('ab_orders').select('*').eq('id', orderId).maybeSingle();
      if (error) dbFail('loadContext(order)', error);
      if (!order) return null;
      const { data: items, error: e1 } = await db.from('ab_order_items').select('name, unit_price_cents, quantity')
        .eq('order_id', orderId).order('created_at');
      if (e1) dbFail('loadContext(items)', e1);
      const { data: shop, error: e2 } = await db.from('ab_shops').select('*').eq('id', (order as any).shop_id).maybeSingle();
      if (e2) dbFail('loadContext(shop)', e2);
      if (!shop) return null;
      // Members are only push recipients: a failed read never blocks the customer's email.
      const { data: members } = await db.from('ab_members').select('user_id')
        .eq('shop_id', (shop as any).id).eq('active', true).not('user_id', 'is', null);
      let ownerEmail: string | null = null;
      try {
        const { data: u } = await db.auth.admin.getUserById((shop as any).owner_id);
        ownerEmail = u?.user?.email ?? null;
      } catch { ownerEmail = null; }
      const pushUserIds = [...new Set([(shop as any).owner_id, ...((members ?? []) as any[]).map((m) => m.user_id)].filter(Boolean))] as string[];
      return {
        order: order as NotifyOrder,
        items: (items ?? []) as NotifyOrderItem[],
        shop: shop as NotifyStoreShop,
        ownerEmail,
        pushUserIds,
      };
    },
    sendEmail: (msg) => liveSendEmail(msg),
    push: (userIds, msg) => pushToUsers(userIds, msg, store),
    now: () => Date.now(),
  };
}
