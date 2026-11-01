// Safety net for "paid twice": two or more distinct ENTITLED subscriptions for one (user, Stripe mode) can only be a
// duplicate (tier/interval switches reuse the same subscription id; re-checkout is blocked while one is entitled).
// Keep the oldest, alert the owner once, and ONLY when WEB_APP_DUP_REFUND=1 and the duplicate is clearly an accident
// cancel it and refund its single payment. Default (flag off): alert only, no Stripe write.
import { WEB_APP_TAG, isEntitledStatus, rowFromSubscription } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';
import { alertOwner, duplicateRefundEmail, sendMail } from './emails.js';
import { contactFor } from './dunning.js';

const enc = encodeURIComponent;
export const DUP_REFUND_WINDOW_MS = 7 * 24 * 3600_000;

export interface DupSub {
  id: string;
  customer: string;
  /** Stripe `created`, unix seconds. */
  created: number;
  status: string;
  tier: string;
  /** Minor units of the first item's price, when known. */
  amount: number | null;
  cancelAtPeriodEnd: boolean;
}
export interface InvoiceInfo { paidInvoices: number; paymentIntent: string | null }

/** Oldest Stripe `created` wins (it holds the site binding and the longest history); id breaks ties. Order-independent. */
export function pickKeeper<T extends { id: string; created: number }>(subs: T[]): T {
  return [...subs].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/**
 * 'refundable' only when ALL hold: the duplicate is <= 7 days old, it has exactly one paid invoice (with a payment
 * intent to refund), and the keeper is not set to cancel at period end (then the customer may really be replacing it).
 */
export function classify(keeper: DupSub, dup: DupSub, invoices: InvoiceInfo | null, nowMs: number): 'refundable' | 'alert_only' {
  if (nowMs - dup.created * 1000 > DUP_REFUND_WINDOW_MS) return 'alert_only';
  if (keeper.cancelAtPeriodEnd) return 'alert_only';
  if (!invoices || invoices.paidInvoices !== 1 || !invoices.paymentIntent) return 'alert_only';
  return 'refundable';
}

export interface DupDeps {
  refundEnabled(): boolean;
  /** Every entitled subscription of the user in this mode, from our rows AND Stripe (a webhook may not have landed). */
  entitledSubs(userId: string): Promise<DupSub[]>;
  invoiceInfo(subId: string): Promise<InvoiceInfo | null>;
  /** Atomic once-only claim of the duplicate (dup_alerted_at is null -> now). False = another runner owns it. */
  claim(dupId: string, keeperId: string): Promise<boolean>;
  releaseClaim(dupId: string): Promise<void>;
  cancel(dupId: string): Promise<void>;
  refund(dupId: string, paymentIntent: string): Promise<void>;
  stampRefunded(dupId: string): Promise<void>;
  alert(subject: string, lines: string[]): Promise<void>;
  mailCustomer(userId: string, customerId: string, keeperTier: string): Promise<void>;
  now(): number;
}

export interface DupResult { found: number; alerted: number; refunded: number; errors: number }

export async function handleDuplicates(userId: string, deps: DupDeps): Promise<DupResult> {
  const out: DupResult = { found: 0, alerted: 0, refunded: 0, errors: 0 };
  const subs = await deps.entitledSubs(userId);
  if (subs.length < 2) return out;
  const keeper = pickKeeper(subs);
  const dups = subs.filter((s) => s.id !== keeper.id).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
  out.found = dups.length;
  const describe = (s: DupSub) => `${s.id} (${s.tier}, ${s.amount != null ? `${(s.amount / 100).toFixed(2)}` : '?'}, created ${new Date(s.created * 1000).toISOString()}, ${s.status})`;
  for (const dup of dups) {
    if (!(await deps.claim(dup.id, keeper.id))) continue; // another runner (or an earlier run) already handled it
    const base = [`user: ${userId}`, `kept (oldest): ${describe(keeper)}`, `duplicate: ${describe(dup)}`, `https://dashboard.stripe.com/subscriptions/${dup.id}`];
    try {
      await deps.alert('AI Barber web: customer is paying twice', [...base, '', deps.refundEnabled() ? 'WEB_APP_DUP_REFUND is on: refund will be attempted if the duplicate qualifies.' : 'No automatic action taken (WEB_APP_DUP_REFUND is off). Decide whether to cancel and refund the duplicate.']);
      out.alerted++;
    } catch (e: any) {
      // Could not tell the owner: free the claim so the next run retries, and move no money this time.
      console.error('[web-app dup] alert failed; will retry:', e?.message || e);
      await deps.releaseClaim(dup.id).catch(() => {});
      out.errors++;
      continue;
    }
    if (!deps.refundEnabled()) continue;
    let invoices: InvoiceInfo | null = null;
    try { invoices = await deps.invoiceInfo(dup.id); } catch (e: any) { console.error('[web-app dup] invoice lookup failed:', e?.message || e); }
    if (classify(keeper, dup, invoices, deps.now()) !== 'refundable') continue;
    // Cancel FIRST so a failed cancel never refunds a subscription that is still live.
    try { await deps.cancel(dup.id); }
    catch (e: any) {
      out.errors++;
      await deps.alert('AI Barber web: duplicate NOT cancelled, nothing refunded', [...base, '', `cancel failed: ${e?.message || e}`, 'Cancel and refund it manually in Stripe.']).catch(() => {});
      continue;
    }
    try { await deps.refund(dup.id, invoices!.paymentIntent as string); }
    catch (e: any) {
      out.errors++;
      await deps.alert('AI Barber web: duplicate cancelled, refund manually', [...base, '', `the subscription is cancelled but the refund failed: ${e?.message || e}`, `Refund payment intent ${invoices!.paymentIntent} manually in Stripe.`]).catch(() => {});
      continue;
    }
    await deps.stampRefunded(dup.id).catch((e: any) => console.error('[web-app dup] could not stamp dup_refunded_at:', e?.message || e));
    out.refunded++;
    await deps.mailCustomer(userId, dup.customer, keeper.tier).catch((e: any) => console.error('[web-app dup] customer email failed:', e?.message || e));
  }
  return out;
}

// ---- live wiring ----
function toDupSub(sub: any, mode: 'live' | 'test'): DupSub | null {
  const row = rowFromSubscription(sub, mode === 'live', process.env);
  if (!row || !isEntitledStatus(String(sub.status))) return null;
  return {
    id: sub.id, customer: row.stripe_customer_id, created: Number(sub.created) || 0, status: String(sub.status), tier: row.tier,
    amount: typeof sub.items?.data?.[0]?.price?.unit_amount === 'number' ? sub.items.data[0].price.unit_amount : null,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
  };
}

export function liveDupDeps(mode: 'live' | 'test'): DupDeps {
  const patch = (subId: string, body: Record<string, unknown>, filter = '') => sbRest(`web_app_entitlements?stripe_subscription_id=eq.${enc(subId)}${filter}`, { method: 'PATCH', body, prefer: 'return=representation' });
  return {
    refundEnabled: () => process.env.WEB_APP_DUP_REFUND === '1',
    async entitledSubs(userId) {
      const rows: Array<{ stripe_subscription_id: string; stripe_customer_id: string }> =
        (await sbRest(`web_app_entitlements?user_id=eq.${enc(userId)}&environment=eq.${mode}&status=in.(active,trialing,past_due)&select=stripe_subscription_id,stripe_customer_id`)) ?? [];
      const stored: Array<{ stripe_customer_id: string }> = (await sbRest(`web_app_customers?user_id=eq.${enc(userId)}&environment=eq.${mode}&select=stripe_customer_id`)) ?? [];
      const customers = [...new Set([...rows.map((r) => r.stripe_customer_id), ...stored.map((r) => r.stripe_customer_id)].filter(Boolean))];
      const byId = new Map<string, DupSub>();
      for (const c of customers) {
        const list = await stripeCall(`subscriptions?customer=${enc(c)}&status=all&limit=20`, null, 'GET');
        for (const sub of list?.data ?? []) {
          if (sub?.metadata?.app !== WEB_APP_TAG) continue;
          const d = toDupSub(sub, mode); if (d) byId.set(d.id, d);
        }
      }
      for (const r of rows) { // our row but missing from the list: ask Stripe directly (it is the authority)
        if (byId.has(r.stripe_subscription_id)) continue;
        const d = toDupSub(await stripeCall(`subscriptions/${enc(r.stripe_subscription_id)}`, null, 'GET'), mode); if (d) byId.set(d.id, d);
      }
      return [...byId.values()];
    },
    async invoiceInfo(subId) {
      const list = await stripeCall(`invoices?subscription=${enc(subId)}&status=paid&limit=3`, null, 'GET');
      const paid = (list?.data ?? []) as any[];
      const pi = paid[0]?.payment_intent;
      return { paidInvoices: paid.length, paymentIntent: typeof pi === 'string' ? pi : pi?.id ?? null };
    },
    claim: async (dupId, keeperId) => ((await patch(dupId, { dup_alerted_at: new Date().toISOString(), dup_of: keeperId }, '&dup_alerted_at=is.null')) ?? []).length > 0,
    releaseClaim: async (dupId) => { await patch(dupId, { dup_alerted_at: null, dup_of: null }); },
    cancel: async (dupId) => { await stripeCall(`subscriptions/${enc(dupId)}`, { prorate: 'false' }, 'DELETE', { idempotencyKey: `aibarber-app:dup-cancel:${dupId}` }); },
    refund: async (dupId, pi) => { await stripeCall('refunds', { payment_intent: pi, reason: 'duplicate', 'metadata[app]': WEB_APP_TAG, 'metadata[subscription]': dupId }, 'POST', { idempotencyKey: `aibarber-app:dup-refund:${dupId}` }); },
    stampRefunded: async (dupId) => { await patch(dupId, { dup_refunded_at: new Date().toISOString() }); },
    alert: alertOwner,
    async mailCustomer(userId, customerId, keeperTier) {
      const { email, firstName } = await contactFor(userId, customerId);
      if (email) await sendMail(email, duplicateRefundEmail({ email, firstName, siteUrl: null, tier: keeperTier }));
    },
    now: () => Date.now(),
  };
}

/** Cron backstop: group the mode's entitled rows by user and run the handler for every user with 2 or more. */
export async function sweepDuplicates(mode: 'live' | 'test', deps: DupDeps = liveDupDeps(mode), listRows?: () => Promise<Array<{ user_id: string | null; stripe_subscription_id: string }>>): Promise<DupResult> {
  const rows = await (listRows ?? (async () => (await sbRest(`web_app_entitlements?environment=eq.${mode}&status=in.(active,trialing,past_due)&select=user_id,stripe_subscription_id&limit=1000`)) ?? []))();
  const per = new Map<string, Set<string>>();
  for (const r of rows) { if (!r.user_id) continue; (per.get(r.user_id) ?? per.set(r.user_id, new Set()).get(r.user_id)!).add(r.stripe_subscription_id); }
  const total: DupResult = { found: 0, alerted: 0, refunded: 0, errors: 0 };
  for (const [uid, ids] of per) {
    if (ids.size < 2) continue;
    try {
      const r = await handleDuplicates(uid, deps);
      total.found += r.found; total.alerted += r.alerted; total.refunded += r.refunded; total.errors += r.errors;
    } catch (e: any) { console.error('[web-app dup sweep]', e?.message || e); total.errors++; }
  }
  return total;
}
