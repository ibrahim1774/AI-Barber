import { draftPath, planIntent, submitIntent, publicationFrom, reliabilityOn, enc, digest, type IntentPlan } from '../../lib/webApp/reliability.js';
// POST { tier, interval, siteSlug? } + Bearer <supabase jwt> -> { url } for a Stripe Checkout subscription,
// 409 already_subscribed (manage in the portal) | payment_processing | checkout_in_progress | ios_subscription_active | ios_linked_lapsed; 503 try_again.
// Off (404) unless WEB_APP_CHECKOUT=1. DEPLOY GATE: migration 024 (web_app_customers etc.) must be applied BEFORE turning on ANY web-app
// flag (WEB_APP_CHECKOUT, and WEB_APP_ENTITLEMENTS too: delete-account reads web_app_customers). Until then checkout fails closed
// with 502 before any Stripe session is created. Everything created is tagged metadata.app = 'aibarber-app'.
import { WEB_APP_TAG, isEntitledStatus, isInterval, isTier, keyMode, planDescription, priceIdFor } from '../../lib/webApp/stripeCore.js';
import { appStoreStateOf, type AppStoreState } from '../../lib/webApp/appStoreGuard.js';
import { expireSession, rememberSession, storedSessionId } from '../../lib/webApp/checkoutSessions.js';
import { APP_ORIGIN, callerFrom, sbRest, stripeCall, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';
import { excludedMethodParams } from '../../lib/checkoutPaymentMethods.js';

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const caller = await callerFrom(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  const { tier, interval, siteSlug, draftId, revision, publish } = req.body ?? {};
  if (!isTier(tier) || !isInterval(interval)) return res.status(400).json({ error: 'bad_plan' });
  const price = priceIdFor(tier, interval, process.env);
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!price || !mode) return res.status(500).json({ error: 'price_not_configured' });
  try {
    const uid = encodeURIComponent(caller.id);
    const rows: any[] = (await sbRest(`web_app_entitlements?user_id=eq.${uid}&environment=eq.${mode}&select=stripe_customer_id,status&order=created_at.desc`)) ?? [];
    if (rows.some((r) => isEntitledStatus(r.status))) return res.status(409).json({ error: 'already_subscribed' }); // manage it in the portal
    // App Store guard (read-only). Fail closed: while we cannot tell, take no payment.
    let appStore: AppStoreState;
    try { appStore = await appStoreStateOf(caller.id, mode); }
    catch (e: any) { console.error('[web-app checkout] app store lookup failed:', e?.message || e); return res.status(503).json({ error: 'try_again' }); }
    if (appStore === 'active') return res.status(409).json({ error: 'ios_subscription_active' });
    if (appStore === 'linked') return res.status(409).json({ error: 'ios_linked_lapsed' });

    // Only a site this user owns can be attached to the subscription.
    let slug = '';
    if (typeof siteSlug === 'string' && /^[a-z0-9-]{1,63}$/.test(siteSlug)) {
      const own = await sbRest(`site_owners?slug=eq.${encodeURIComponent(siteSlug)}&user_id=eq.${uid}&select=slug&limit=1`);
      if (own?.length) slug = siteSlug;
    }
    // Only a publish-with-checkout needs a saved server draft; plain upgrades and domain purchases never do.
    // Nothing is written here: the submission is stored only after its Stripe session exists (see submitIntent below).
    let plan: IntentPlan | null = null;
    if (reliabilityOn() && publish === true) {
      if (typeof draftId !== 'string' || !Number.isSafeInteger(revision)) return res.status(400).json({ error: 'client_outdated' }); // a cached pre-draft client
      plan = await planIntent(caller.id, draftId, revision, 'checkout:publish', null, publicationFrom(req.body?.publication)); // 409 draft_changed | 400 invalid_snapshot, mapped below
    }
    // A customer we already know (stored, or from an older entitlement row) is reused. A first-time user has NONE: Stripe creates
    // the customer itself only when the subscription checkout is paid, so someone who never pays leaves no customer behind.
    // (The row read still fails closed with 502 when migration 024 is missing.)
    const customer = await knownCustomer(mode, uid, rows);
    // Customers whose subscriptions decide "already paying". A first-time user has none stored, but may have just paid a session whose
    // webhook has not landed: that session names the customer Stripe created.
    const toCheck = new Set<string>(customer ? [customer] : []);
    if (!customer && caller.email) {
      try {
        const mine = await stripeCall(`checkout/sessions?customer_details[email]=${encodeURIComponent(caller.email)}&limit=20`, null, 'GET');
        for (const o of mine?.data ?? []) {
          if (o?.metadata?.app !== WEB_APP_TAG || o?.metadata?.user_id !== caller.id || o.status !== 'complete') continue;
          const c = typeof o.customer === 'string' ? o.customer : o.customer?.id;
          if (c) toCheck.add(c);
        }
      } catch (e: any) { console.error('[web-app checkout] recent-payment lookup failed:', e?.message || e); } // best effort; the duplicate handler is the backstop
    }
    for (const c of toCheck) {
      // Stripe is the authority on "already paying" (the webhook may not have landed yet).
      const subs = await stripeCall(`subscriptions?customer=${encodeURIComponent(c)}&status=all&limit=20`, null, 'GET');
      const ours: any[] = (subs?.data ?? []).filter((x: any) => x?.metadata?.app === WEB_APP_TAG);
      if (ours.some((x) => isEntitledStatus(String(x.status)) || x.status === 'unpaid' || x.status === 'paused')) return res.status(409).json({ error: 'already_subscribed' });
      // An incomplete subscription is a payment still being confirmed (3DS, slow card) for a while; after an hour it is abandoned
      // (Stripe expires it itself at 23 h) and must not lock the user out. Ignored, never cancelled: no Stripe write.
      const stale = Math.floor(Date.now() / 1000) - 3600;
      if (ours.some((x) => x.status === 'incomplete' && Number(x.created) > stale)) return res.status(409).json({ error: 'payment_processing' });
    }

    // Existing Stripe billing is checked before superseding any recoverable publish submission.
    const shopName = (await sbRest(`${draftPath(caller.id, mode)}&select=shop:site_data->>shopName&limit=1`).catch(() => null))?.[0]?.shop;
    const description = planDescription(tier, shopName);
    const meta = { app: WEB_APP_TAG, user_id: caller.id, site_slug: slug, tier, interval, ...(plan ? { intent_id: plan.id } : {}) };
    const nowMs = Date.now();
    const window = Math.floor(nowMs / 600_000);
    // Parameters must be identical for an idempotent replay, so expiry derives from the 10-minute window (32-42 min ahead; Stripe's minimum is 30).
    const sessionBody = {
      mode: 'subscription',
      ...(customer ? { customer } : caller.email ? { customer_email: caller.email } : {}),
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      ...excludedMethodParams(),
      client_reference_id: caller.id,
      success_url: `${APP_ORIGIN()}/app/edit?paid=1`,
      cancel_url: `${APP_ORIGIN()}/app/edit?paid=0`,
      'subscription_data[description]': description,
      'custom_text[submit][message]': description,
      expires_at: String((window + 1) * 600 + 1800 + 120),
      ...Object.fromEntries(Object.entries(meta).flatMap(([k, v]) => [[`metadata[${k}]`, v], [`subscription_data[metadata][${k}]`, v]])),
    };
    const key = `aibarber-app:cs:${caller.id}:${tier}:${interval}:${window}${plan ? ':' + digest([draftId, revision, true, plan.id]).slice(0,24) : ''}:${digest([description]).slice(0, 8)}`;
    // Stripe replays the FIRST response for a repeated key, so that response can be stale: always read the session's real status.
    const createOrReplay = async (k: string) => {
      const made = await stripeCall('checkout/sessions', sessionBody, 'POST', { idempotencyKey: k });
      return stripeCall(`checkout/sessions/${encodeURIComponent(made.id)}`, null, 'GET');
    };
    let session: any;
    try {
      session = await createOrReplay(key);
      // A replay of a session that a newer click already expired: make a fresh one (a rare, non-replayed call).
      if (session?.status === 'expired') session = await createOrReplay(`${key}:r${nowMs}`);
    } catch (e: any) {
      if (e?.type === 'idempotency_error' || e?.code === 'idempotency_key_in_use') return res.status(409).json({ error: 'checkout_in_progress' });
      throw e;
    }
    // Paid already, or no payable URL: never hand out a second payable page.
    if (session?.status !== 'open' || !session?.url) return res.status(409).json({ error: 'payment_processing' });
    if (plan) {
      // Only now are earlier unpaid submissions superseded: a failed session create above leaves them, and their open sessions, valid.
      let intent: Awaited<ReturnType<typeof submitIntent>>;
      try { intent = await submitIntent(plan); }
      catch (e) { await stripeCall(`checkout/sessions/${enc(session.id)}/expire`, {}, 'POST').catch(() => {}); throw e; }
      // Never expose the payable URL unless its immutable publish submission is recoverable without this tab.
      const linked = await sbRest(`web_app_publish_intents?id=eq.${enc(intent.id)}&status=in.(awaiting_payment,queued,failed)`, {
        method: 'PATCH', body: { stripe_session_id: session.id }, prefer: 'return=representation',
      });
      if (!linked?.length) {
        await stripeCall(`checkout/sessions/${enc(session.id)}/expire`, {}, 'POST');
        return res.status(409).json({ error: 'draft_changed' });
      }
    }
    // The previously stored open session is expired by id (works without an email), then this one is stored.
    const previous = await storedSessionId(caller.id, mode);
    if (previous && previous !== session.id) await expireSession(previous);
    await rememberSession(caller.id, mode, session.id);
    // At most one payable Checkout tab: expire every OTHER open session of ours (best effort).
    try {
      if (!customer && !caller.email) throw new Error('no customer or email to look sessions up by');
      const open = await stripeCall(customer ? `checkout/sessions?customer=${encodeURIComponent(customer)}&status=open&limit=10` : `checkout/sessions?customer_details[email]=${encodeURIComponent(caller.email ?? '')}&status=open&limit=10`, null, 'GET');
      for (const o of open?.data ?? []) {
        if (o?.id === session.id || o?.metadata?.app !== WEB_APP_TAG || (!customer && o?.metadata?.user_id !== caller.id)) continue;
        await stripeCall(`checkout/sessions/${encodeURIComponent(o.id)}/expire`, {}, 'POST').catch((e: any) => console.error('[web-app checkout] expire failed:', e?.message || e));
      }
    } catch (e: any) { console.error('[web-app checkout] open-session cleanup failed:', e?.message || e); }
    return res.status(200).json({ url: session.url });
  } catch (e: any) {
    console.error('[web-app checkout]', e.message);
    if (e?.status === 400) return res.status(400).json({ error: 'invalid_draft', reason: e?.reason ?? 'invalid_snapshot' });
    return res.status(e?.status === 409 ? 409 : 502).json({ error: e?.status === 409 ? 'draft_changed' : 'checkout_failed' });
  }
}

/** The user's stored Stripe customer in this mode, else one from an older entitlement row (stored for next time); undefined for a first-time user. Never creates one. */
async function knownCustomer(mode: 'live' | 'test', uid: string, entRows: any[]): Promise<string | undefined> {
  const read = async (): Promise<string | undefined> => (await sbRest(`web_app_customers?user_id=eq.${uid}&environment=eq.${mode}&select=stripe_customer_id&limit=1`))?.[0]?.stripe_customer_id;
  const stored = await read();
  if (stored) return stored;
  const legacy: string | undefined = (entRows.find((r) => isEntitledStatus(r.status)) ?? entRows[0])?.stripe_customer_id;
  if (!legacy) return undefined;
  await sbRest('web_app_customers?on_conflict=user_id,environment', { method: 'POST', body: { user_id: decodeURIComponent(uid), environment: mode, stripe_customer_id: legacy }, prefer: 'resolution=ignore-duplicates,return=minimal' });
  return (await read()) ?? legacy; // a lost race converges on whichever row won
}
