import { reliabilityOn, enc } from '../../lib/webApp/reliability.js';
import { dispatchJob } from '../../lib/webApp/publishJobs.js';
// Stripe webhook for the web app only (its own endpoint + secret). Upserts one row per subscription
// into web_app_entitlements. The row is built from the subscription's CURRENT state fetched from Stripe,
// never from the event body, so late or replayed events can't bring back a canceled subscription.
// Events without metadata.app = 'aibarber-app' are acknowledged and ignored.
import { WEB_APP_TAG, cleanShopName, isEntitledStatus, keyMode, planDescription, rowFromSubscription, shopFromDescription, verifyStripeSignature } from '../../lib/webApp/stripeCore.js';
import { readRawBody, sbRest, stripeCall, webAppCheckoutOn, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';
import { sendMail, welcomeEmail } from '../../lib/webApp/emails.js';
import { handleDuplicates, liveDupDeps } from '../../lib/webApp/duplicates.js';
import { contactFor, resetDunning, sendFailedPaymentIfDue } from '../../lib/webApp/dunning.js';
import { userExists } from '../../lib/webApp/userExists.js';
import { draftPath } from '../../lib/webApp/reliability.js';
import { stampedSiteUrl } from '../../lib/ios/siteUrlFor.js';

export const config = { api: { bodyParser: false } };

const SUB_EVENTS = new Set(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
const siteUrlOf = (slug: string | null) => (slug ? stampedSiteUrl(slug) : Promise.resolve(null));

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
  let evSub = event.data?.object;
  if (event.type === 'checkout.session.completed') {
    // Only subscription checkouts of ours; the subscription itself is then handled like any subscription event.
    if (evSub?.mode !== 'subscription' || typeof evSub.subscription !== 'string') return res.status(200).json({ ignored: true });
    evSub = { id: evSub.subscription, metadata: evSub.metadata };
  }
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
    // The customer now exists (Checkout created it on payment): remember it for this user and mode, and tag it.
    if (row.user_id && row.status !== 'invalid_price') {
      await recordCustomer(row.user_id, row.stripe_customer_id, mode, event.type !== 'customer.subscription.deleted');
      if (isEntitledStatus(row.status)) await syncDescription(sub, row.tier, row.user_id, mode);
    }
    if (reliabilityOn() && row.user_id && isEntitledStatus(row.status) && typeof sub.metadata?.intent_id === 'string') {
      const jobs = await sbRest(`web_app_publish_intents?id=eq.${enc(sub.metadata.intent_id)}&user_id=eq.${enc(row.user_id)}&environment=eq.${mode}&status=in.(awaiting_payment,queued,failed)`, {
        method: 'PATCH', body: { stripe_subscription_id: sub.id, status: 'queued' }, prefer: 'return=representation',
      });
      if (jobs?.length) dispatchJob(jobs[0].id);
      else {
        // The paid session's own submission was superseded by a newer one (e.g. a newer checkout failed): the newest
        // submission is the one that publishes. Its payment is rechecked against Stripe before anything deploys.
        const d = (await sbRest(`web_app_drafts?user_id=eq.${enc(row.user_id)}&environment=eq.${mode}&select=latest_intent_id&limit=1`))?.[0];
        if (d?.latest_intent_id && d.latest_intent_id !== sub.metadata.intent_id) {
          const latest = await sbRest(`web_app_publish_intents?id=eq.${enc(d.latest_intent_id)}&user_id=eq.${enc(row.user_id)}&environment=eq.${mode}&status=in.(awaiting_payment,failed)`, {
            method: 'PATCH', body: { stripe_subscription_id: sub.id, status: 'queued' }, prefer: 'return=representation',
          });
          if (latest?.length) {
            // The newest request's own Checkout page must not stay payable now that a hosting plan is paid.
            const open = latest[0].stripe_session_id;
            if (typeof open === 'string') await stripeCall(`checkout/sessions/${encodeURIComponent(open)}/expire`, {}, 'POST').catch((e: any) => console.error('[web-app webhook expire newest]', e?.message || e));
            dispatchJob(latest[0].id);
          }
        }
      }
    }
    if (row.status === 'active' || row.status === 'trialing') await resetDunning(row.stripe_subscription_id);
    // Welcome email: once per subscription. The claim (welcome_sent_at is null -> now) is atomic, so two
    // deliveries can't both send; a failed send releases the claim and 500s so Stripe retries.
    if (row.status === 'active' || row.status === 'trialing') {
      const claimed = await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${encodeURIComponent(row.stripe_subscription_id)}&welcome_sent_at=is.null`, { method: 'PATCH', body: { welcome_sent_at: new Date().toISOString() }, prefer: 'return=representation' });
      if (claimed?.length) {
        try {
          const { email: to, firstName } = await contactFor(row.user_id, row.stripe_customer_id);
          if (to) await sendMail(to, welcomeEmail({ email: to, firstName, siteUrl: await siteUrlOf(row.site_slug), tier: row.tier }));
        } catch (e: any) {
          // Best effort: release the claim so a later event retries, but never fail the webhook over an email
          // (Stripe would retry for days and could disable the endpoint, stopping entitlement updates).
          console.error('[web-app webhook welcome email]', e?.message || e);
          await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${encodeURIComponent(row.stripe_subscription_id)}`, { method: 'PATCH', body: { welcome_sent_at: null } }).catch(() => {});
        }
      }
    }
    // Safety net for "paid twice" (fast path; the lapse cron is the backstop). NEVER changes the response: an
    // alert/refund problem must not make Stripe retry for days and disable this endpoint.
    if (webAppCheckoutOn() && row.user_id && isEntitledStatus(row.status)) {
      try { await handleDuplicates(row.user_id, liveDupDeps(mode)); }
      catch (e: any) { console.error('[web-app webhook dup check]', e?.message || e); }
    }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[web-app webhook]', e.message);
    return res.status(500).json({ error: 'store_failed' }); // Stripe retries
  }
}

/** A failed renewal: email the owner at once, then (via the cron) every 2 days while it stays past_due. Our subscriptions only. */
async function handleFailedPayment(event: any, mode: 'live' | 'test', res: any) {
  if ((mode === 'live') !== !!event.livemode) return res.status(200).json({ ignored: true });
  const inv = event.data?.object;
  const subId = inv?.subscription;
  if (typeof subId !== 'string') return res.status(200).json({ ignored: true });
  try {
    const sub = await stripeCall(`subscriptions/${encodeURIComponent(subId)}`, null, 'GET');
    if (sub?.metadata?.app !== 'aibarber-app') return res.status(200).json({ ignored: true });
    await sendFailedPaymentIfDue(subId, mode, typeof inv?.hosted_invoice_url === 'string' ? inv.hosted_invoice_url : null);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    // Best effort, like the welcome email: an email problem must not make Stripe retry and disable this endpoint.
    console.error('[web-app webhook payment_failed]', e.message);
    return res.status(200).json({ ok: false, emailed: false });
  }
}

/** Idempotent: first customer per (user, mode) wins; later ones (a duplicate payment) keep their entitlement rows only. Throws on a DB error so Stripe retries. */
async function recordCustomer(userId: string, customerId: string, mode: 'live' | 'test', tag: boolean) {
  // A deleted account must not get a new web_app_customers row (a payment completing after the delete would otherwise recreate one).
  if (!(await userExists(userId))) return;
  await sbRest('web_app_customers?on_conflict=user_id,environment', { method: 'POST', body: { user_id: userId, environment: mode, stripe_customer_id: customerId }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  if (!tag) return;
  // Checkout never copies metadata onto the customer it creates. Best effort, never fails the webhook.
  await stripeCall(`customers/${encodeURIComponent(customerId)}`, { 'metadata[app]': WEB_APP_TAG, 'metadata[user_id]': userId }, 'POST', { idempotencyKey: `aibarber-app:cust-meta:${userId}:${customerId}` })
    .catch((e: any) => console.error('[web-app webhook customer metadata]', e?.message || e));
}

/** Keep the subscription description (invoices, receipts, portal) equal to the CURRENT plan's text; a plan switch rewrites it. Best effort. */
async function syncDescription(sub: any, tier: any, userId: string, mode: 'live' | 'test') {
  try {
    let shop: unknown = (await sbRest(`${draftPath(userId, mode)}&select=shop:site_data->>shopName&limit=1`))?.[0]?.shop;
    if (cleanShopName(shop) === 'your shop') shop = shopFromDescription(sub.description); // never overwrite a real name with the fallback
    const want = planDescription(tier, shop);
    if (sub.description === want) return;
    await stripeCall(`subscriptions/${encodeURIComponent(sub.id)}`, { description: want }, 'POST');
  } catch (e: any) { console.error('[web-app webhook description]', e?.message || e); }
}
