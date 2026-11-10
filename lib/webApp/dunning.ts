// Failed-payment emails: one at once when a renewal fails, then a reminder every 2 days while the subscription is
// still past_due (Stripe retries for about two weeks). The "last sent" stamp is claimed atomically so a webhook retry
// and the cron can never both send. Best effort: a mail problem never fails the caller.
import { keyMode, portalConfigFor, rowFromSubscription, tierForPriceId } from './stripeCore.js';
import { sbRest, stripeCall } from './webAppServer.js';
import { failedPaymentEmail, sendMail } from './emails.js';
import { stampedSiteUrl } from '../ios/siteUrlFor.js';

export const REMIND_EVERY_MS = 47 * 3600_000; // "every 2 days", with slack for the 10-minute cron
export const MAX_REMINDERS = 8;
const enc = encodeURIComponent;

const siteUrlOf = (slug: string | null) => (slug ? stampedSiteUrl(slug) : Promise.resolve(null));

/**
 * Account email + first name. The name is the Supabase user's own (first_name / given_name / full_name / name, then the
 * Google identity's), never the Stripe customer's: Checkout's billing name and shop-style names are not a first name,
 * so with no real name the mail simply has no name ("Hi there" / a nameless subject). Email falls back to Stripe.
 */
export async function contactFor(userId: string | null, customerId: string): Promise<{ email: string | null; firstName: string | null }> {
  let email: string | null = null; let name: string | null = null;
  if (userId) {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${enc(userId)}`, { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY as string, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (r.ok) {
      const u: any = await r.json().catch(() => null);
      email = u?.email ?? null;
      const pick = (m: any) => m?.first_name || m?.given_name || m?.full_name || m?.name || null;
      name = pick(u?.user_metadata);
      if (!name && Array.isArray(u?.identities)) for (const id of u.identities) { name = pick(id?.identity_data); if (name) break; }
    }
  }
  if (!email) {
    const c = await stripeCall(`customers/${enc(customerId)}`, null, 'GET').catch(() => null);
    email = c?.email ?? null;
  }
  const first = typeof name === 'string' ? name.trim().split(/\s+/)[0] : '';
  return { email, firstName: first || null };
}

/**
 * The live address for a just-paid customer's welcome mail: the stamped site URL (what the deploy really resolved).
 * Uses the subscription's slug, else the user's published web site. Null when nothing is published yet (the mail is
 * usually sent within seconds of payment, before the first publish): the mail then leaves the link out.
 * A custom domain cannot exist yet at this point (it is bought after the first publish), so none is consulted.
 */
export const LIVE_URL_TIMEOUT_MS = 3_000;
export async function liveSiteUrlFor(slug: string | null, userId: string | null, env: 'live' | 'test'): Promise<string | null> {
  const lookup = async (): Promise<string | null> => {
    if (slug) return await stampedSiteUrl(slug);
    if (!userId) return null;
    const r = await sbRest(`web_app_sites?user_id=eq.${enc(userId)}&environment=eq.${env}&published_at=not.is.null&taken_down_at=is.null&removed_at=is.null&select=slug&order=created_at.desc&limit=1`, { timeoutMs: LIVE_URL_TIMEOUT_MS });
    const found = r?.[0]?.slug;
    return typeof found === 'string' && found ? await stampedSiteUrl(found) : null;
  };
  // A slow or failing lookup must never hold the webhook or the mail: after ~3 s the mail goes out without the link.
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([lookup(), new Promise<null>((res) => { t = setTimeout(() => res(null), LIVE_URL_TIMEOUT_MS); })]);
  } catch { return null; } finally { clearTimeout(t); }
}

/** The Stripe-hosted page where this customer can pay / replace the card for the open invoice. */
export async function updateUrlFor(sub: any, eventInvoiceUrl?: string | null): Promise<string | null> {
  if (eventInvoiceUrl) return eventInvoiceUrl;
  const inv = typeof sub.latest_invoice === 'string' ? sub.latest_invoice : sub.latest_invoice?.id;
  if (!inv) return null;
  const i = await stripeCall(`invoices/${enc(inv)}`, null, 'GET').catch(() => null);
  if (i?.hosted_invoice_url) return i.hosted_invoice_url;
  // No hosted invoice: this customer's own billing portal session (card update) instead.
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customer) return null;
  // The portal configuration follows the subscription's price group. A price-test group (g10 / g20) without its configuration fails
  // closed (no link, never the base configuration); base keeps the old behaviour (default portal when none is set).
  const priceId = sub?.items?.data?.[0]?.price?.id;
  const group = (priceId ? tierForPriceId(priceId, process.env)?.group : null) ?? 'base';
  const cfg = portalConfigFor(group, process.env);
  if (group !== 'base' && !cfg) { console.error(`[web-app dunning] portal_not_configured for group ${group}`); return null; }
  const ps = await stripeCall('billing_portal/sessions', { customer, ...(cfg ? { configuration: cfg } : {}) }).catch(() => null);
  return ps?.url ?? null;
}

/**
 * Send the failed-payment email for a subscription if one is due. Returns whether a mail went out.
 * Due = subscription still past_due, reminder cap not reached, and nothing sent in the last ~2 days.
 */
export async function sendFailedPaymentIfDue(subId: string, mode: 'live' | 'test', eventInvoiceUrl?: string | null, now = Date.now()): Promise<boolean> {
  const sub = await stripeCall(`subscriptions/${enc(subId)}`, null, 'GET');
  if (sub?.status !== 'past_due') return false; // paid, canceled or otherwise: nothing to warn about
  const row = rowFromSubscription(sub, mode === 'live', process.env);
  if (!row) return false;
  const stamp = new Date(now).toISOString();
  const cutoff = new Date(now - REMIND_EVERY_MS).toISOString();
  const read = async () => (await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${enc(subId)}&select=dunning_last_sent_at,dunning_count&limit=1`))?.[0];
  let before = await read();
  if (!before) {
    // The failed-payment event can beat the subscription event: store the row from Stripe's current state (same
    // content the subscription webhook writes), then carry on.
    const body: Record<string, unknown> = { ...row, updated_at: stamp };
    if (body.site_slug == null) delete body.site_slug;
    await sbRest('web_app_entitlements?on_conflict=stripe_subscription_id', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
    before = await read();
    if (!before) return false;
  }
  const count = Number(before.dunning_count ?? 0);
  if (count >= MAX_REMINDERS) return false;
  const claimed = await sbRest(
    `web_app_entitlements?stripe_subscription_id=eq.${enc(subId)}&or=(dunning_last_sent_at.is.null,dunning_last_sent_at.lt.${enc(cutoff)})`,
    { method: 'PATCH', body: { dunning_last_sent_at: stamp, dunning_count: count + 1 }, prefer: 'return=representation' },
  );
  if (!claimed?.length) return false;
  try {
    const { email, firstName } = await contactFor(row.user_id, row.stripe_customer_id);
    if (!email) throw new Error('no email address');
    const updateUrl = await updateUrlFor(sub, eventInvoiceUrl);
    const messageId = await sendMail(email, failedPaymentEmail({ email, firstName, siteUrl: await siteUrlOf(row.site_slug), tier: row.tier, updateUrl, reminder: count }));
    console.log('[web-app dunning] sent', messageId);
    return true;
  } catch (e: any) {
    console.error('[web-app dunning]', e?.message || e);
    await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${enc(subId)}`, { method: 'PATCH', body: { dunning_last_sent_at: before.dunning_last_sent_at ?? null, dunning_count: count } }).catch(() => {});
    return false;
  }
}

/** A paid-up subscription starts a fresh cycle next time it fails. */
export async function resetDunning(subId: string): Promise<void> {
  await sbRest(`web_app_entitlements?stripe_subscription_id=eq.${enc(subId)}&dunning_count=gt.0`, { method: 'PATCH', body: { dunning_last_sent_at: null, dunning_count: 0 } }).catch(() => {});
}

/** Cron pass: reminders for every past_due subscription whose last mail is 2+ days old. */
export async function sweepDunning(now = Date.now()): Promise<{ due: number; sent: number }> {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) return { due: 0, sent: 0 };
  const cutoff = new Date(now - REMIND_EVERY_MS).toISOString();
  const rows: Array<{ stripe_subscription_id: string }> = (await sbRest(
    `web_app_entitlements?environment=eq.${mode}&status=eq.past_due&dunning_count=lt.${MAX_REMINDERS}&or=(dunning_last_sent_at.is.null,dunning_last_sent_at.lt.${enc(cutoff)})&select=stripe_subscription_id&limit=50`,
  )) ?? [];
  let sent = 0;
  for (const r of rows) {
    try { if (await sendFailedPaymentIfDue(r.stripe_subscription_id, mode, null, now)) sent++; }
    catch (e: any) { console.error('[web-app dunning sweep]', e?.message || e); }
  }
  return { due: rows.length, sent };
}
