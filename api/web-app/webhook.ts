// Stripe webhook for the web app only (its own endpoint + secret). Upserts one row per subscription
// into web_app_entitlements. The row is built from the subscription's CURRENT state fetched from Stripe,
// never from the event body, so late or replayed events can't bring back a canceled subscription.
// Events without metadata.app = 'aibarber-app' are acknowledged and ignored.
import { keyMode, rowFromSubscription, verifyStripeSignature } from '../../lib/webApp/stripeCore.js';
import { readRawBody, sbRest, stripeCall, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';
import { failedPaymentEmail, sendMail, welcomeEmail } from '../../lib/webApp/emails.js';

export const config = { api: { bodyParser: false } };

const SUB_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
const siteUrlOf = (slug: string | null) => (slug ? `https://${slug}.vercel.app` : null);

/** The account email: the Supabase user's, else the Stripe customer's. */
async function emailFor(userId: string | null, customerId: string): Promise<string | null> {
  if (userId) {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (r.ok) { const u: any = await r.json().catch(() => null); if (u?.email) return u.email; }
  }
  const c = await stripeCall(`customers/${encodeURIComponent(customerId)}`, null, 'GET').catch(() => null);
  return c?.email ?? null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.STRIPE_WEBAPP_WEBHOOK_SECRET;
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!secret || !mode) return res.status(500).json({ error: 'misconfigured' });
  let event: any;
  try {
    const raw = await readRawBody(req);
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string, secret)) return res.status(400).json({ error: 'bad_signature' });
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'bad_request' });
  }
  if (event.type === 'invoice.payment_failed') return handleFailedPayment(event, mode, res);
  if (!SUB_EVENTS.has(event.type)) return res.status(200).json({ ignored: true });
  // Only the mode this deployment's key belongs to (a test event can never grant access in live, or the reverse).
  if ((mode === 'live') !== !!event.livemode) return res.status(200).json({ ignored: true });
  const evSub = event.data?.object;
  if (evSub?.metadata?.app !== 'aibarber-app' || typeof evSub.id !== 'string') return res.status(200).json({ ignored: true });
  try {
    let sub: any;
    try { sub = await stripeCall(`subscriptions/${encodeURIComponent(evSub.id)}`, null, 'GET'); }
    catch (e: any) {
      // Unknown to Stripe: nothing to store. Any other failure (outage, timeout) must NOT be read as "ended":
      // answer 500 so Stripe retries the event later.
      if (e?.status === 404) return res.status(200).json({ ignored: true });
      throw e;
    }
    const row = rowFromSubscription(sub, mode === 'live', process.env, sub.status === 'canceled');
    if (!row) return res.status(200).json({ ignored: true });
    // Flag on: a null slug is left out of the upsert so a binding already stored on the row is never erased.
    const upsertBody: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };
    if (webAppEntitlementsOn() && upsertBody.site_slug == null) delete upsertBody.site_slug;
    await sbRest('web_app_entitlements?on_conflict=stripe_subscription_id', { method: 'POST', body: upsertBody, prefer: 'resolution=merge-duplicates,return=minimal' });
    // Welcome email: once per subscription. The claim (welcome_sent_at is null -> now) is atomic, so two
    // deliveries can't both send; a failed send releases the claim and 500s so Stripe retries.
    if (row.status === 'active' || row.status === 'trialing') {
      const claimed = await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${encodeURIComponent(row.stripe_subscription_id)}&welcome_sent_at=is.null`, { method: 'PATCH', body: { welcome_sent_at: new Date().toISOString() }, prefer: 'return=representation' });
      if (claimed?.length) {
        try {
          const to = await emailFor(row.user_id, row.stripe_customer_id);
          if (to) await sendMail(to, welcomeEmail({ email: to, siteUrl: siteUrlOf(row.site_slug), tier: row.tier }));
        } catch (e: any) {
          // Best effort: release the claim so a later event retries, but never fail the webhook over an email
          // (Stripe would retry for days and could disable the endpoint, stopping entitlement updates).
          console.error('[web-app webhook welcome email]', e?.message || e);
          await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${encodeURIComponent(row.stripe_subscription_id)}`, { method: 'PATCH', body: { welcome_sent_at: null } }).catch(() => {});
        }
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[web-app webhook]', e.message);
    return res.status(500).json({ error: 'store_failed' }); // Stripe retries
  }
}

/** A failed renewal: email the owner every time (each Stripe retry attempt is its own event). Our subscriptions only. */
async function handleFailedPayment(event: any, mode: 'live' | 'test', res: any) {
  if ((mode === 'live') !== !!event.livemode) return res.status(200).json({ ignored: true });
  const subId = event.data?.object?.subscription;
  if (typeof subId !== 'string') return res.status(200).json({ ignored: true });
  try {
    const sub = await stripeCall(`subscriptions/${encodeURIComponent(subId)}`, null, 'GET');
    const row = rowFromSubscription(sub, mode === 'live', process.env);
    if (!row) return res.status(200).json({ ignored: true });
    const to = await emailFor(row.user_id, row.stripe_customer_id);
    if (to) await sendMail(to, failedPaymentEmail({ email: to, siteUrl: siteUrlOf(row.site_slug), tier: row.tier }));
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    // Best effort, like the welcome email: an email problem must not make Stripe retry and disable this endpoint.
    console.error('[web-app webhook payment_failed]', e.message);
    return res.status(200).json({ ok: false, emailed: false });
  }
}
