// When a web-app hosting plan ends, the site's custom domain stops renewing (cancel_at_period_end=true
// on the ONE domain subscription, never immediately, never a refund): it keeps working until its paid
// period ends. The customer gets one plain letter per domain. If the same site gets a plan again before
// then, renewal is switched back on, but ONLY when WE turned it off (not when the customer did).
// Reasons live in the row's alerts_sent markers. Web-app rows only (source 'stripe'); iOS rows untouched.
// Never throws: every caller is a webhook or a cron that must not fail over this.
import { randomUUID } from 'node:crypto';
import type { DomainRow } from '../ios/domainsRepo.js';
import type { DomainsRepo } from '../ios/domainsRepo.js';
import { envMatchesKey } from './domainManual.js';
import { textMail } from './domainEmails.js';
import { replyToAddress, type Mail } from './emails.js';

export const OFF_BY_CUSTOMER = 'renewal-off-customer';
export const OFF_PLAN_ENDED = 'renewal-off-plan-ended';
export const PLAN_ENDED_MAIL = 'plan-ended-mail';

const DONE_STATES = ['failed', 'detached', 'transferred'];

export interface PlanEndDeps {
  repo: Pick<DomainsRepo, 'all' | 'get' | 'update'> & Partial<Pick<DomainsRepo, 'mergeAlert'>>;
  /** The Stripe mode of the web-app key that raised this ('live' | 'test'). */
  mode: 'live' | 'test' | null;
  getSubscription(subId: string): Promise<any | null>;
  setRenewal(subId: string, cancelAtPeriodEnd: boolean, idempotencyKey: string): Promise<{ ok: boolean; status: number; data: any }>;
  /** The owner's email, or null. */
  contactEmail(userId: string | null, customerId: string): Promise<string | null>;
  /** idempotencyKey: derived from domain + sub + period, so a re-send of the same letter is dropped by Resend. */
  sendMail(to: string, mail: Mail, idempotencyKey: string): Promise<unknown>;
  /** An iOS purchase owns this slug: not ours (same rule as the lapse sweep). */
  iosOwnsSlug?(slug: string): Promise<boolean>;
  /** Does the owner have another entitled web plan (DB, then Stripe for a tier switch whose webhook is late)? Throws on an error. */
  hasOtherPlan?(userId: string | null, excludeSubId: string | undefined, customerId: string | undefined): Promise<boolean>;
  now(): number;
}

export function planEndedEmail(f: { domain: string; renewsOn: string }): Mail {
  return textMail(`${f.domain} won't renew`, [
    `Your Prime Barber plan has ended, so ${f.domain} won't renew on ${f.renewsOn}. If you come back before then, it renews again and you keep the same address.`,
    '',
    'Prime Barber',
  ], replyToAddress());
}

const iso = (ms: number) => new Date(ms).toISOString();
const periodEndMs = (sub: any) => Number(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end ?? 0) * 1000;

async function rowsOf(slug: string, deps: PlanEndDeps): Promise<DomainRow[]> {
  return (await deps.repo.all()).filter((r) => r.site_slug === slug && r.source === 'stripe' && !DONE_STATES.includes(r.state) && !r.refunded_at && envMatchesKey(r, deps.mode));
}

/** Add markers without overwriting another writer's keys (merge-only when the repo can), and remove some (read-modify-write). */
async function setMarkers(deps: PlanEndDeps, row: DomainRow, add: Record<string, string>, remove: string[] = []): Promise<void> {
  if (deps.repo.mergeAlert && remove.length === 0) {
    for (const [k, v] of Object.entries(add)) if (!(await deps.repo.mergeAlert(row.original_transaction_id, k, v))) throw new Error(`marker ${k} not stored`);
    return;
  }
  const fresh = (await deps.repo.get(row.original_transaction_id).catch(() => null)) ?? row;
  const next = { ...(fresh.alerts_sent ?? {}), ...add };
  for (const k of remove) delete next[k];
  await deps.repo.update(row.original_transaction_id, null, { alerts_sent: next });
}

/** Atomically claim a once-only marker: only the writer whose unique token is stored owns it. */
async function claim(deps: PlanEndDeps, row: DomainRow, key: string): Promise<string | null> {
  const token = `${iso(deps.now())} ${randomUUID()}`;
  if (deps.repo.mergeAlert) {
    if (!(await deps.repo.mergeAlert(row.original_transaction_id, key, token))) return null;
    const fresh = await deps.repo.get(row.original_transaction_id);
    return fresh?.alerts_sent?.[key] === token ? token : null;
  }
  const fresh = (await deps.repo.get(row.original_transaction_id)) ?? row;
  if (fresh.alerts_sent?.[key]) return null;
  await deps.repo.update(row.original_transaction_id, null, { alerts_sent: { ...(fresh.alerts_sent ?? {}), [key]: token } });
  return token;
}

async function release(deps: PlanEndDeps, row: DomainRow, key: string, token: string): Promise<void> {
  const fresh = await deps.repo.get(row.original_transaction_id).catch(() => null);
  if (!fresh || fresh.alerts_sent?.[key] !== token) return;
  const next = { ...(fresh.alerts_sent ?? {}) }; delete next[key];
  await deps.repo.update(row.original_transaction_id, null, { alerts_sent: next }).catch(() => {});
}

/** Set cancel_at_period_end and CONFIRM it by re-reading the subscription. False (logged) = not confirmed: no markers, no mail, a later pass retries. */
export async function applyRenewal(deps: Pick<PlanEndDeps, 'getSubscription' | 'setRenewal'>, subId: string, cancel: boolean, label: string): Promise<boolean> {
  const r = await deps.setRenewal(subId, cancel, randomUUID());
  if (!r.ok) { console.error(`[domain-plan-end] ${label}: stripe ${r.status} ${r.data?.error?.code || r.data?.error?.type || 'unknown'}`); return false; }
  const after = await deps.getSubscription(subId);
  if (!after || !!after.cancel_at_period_end !== cancel) { console.error(`[domain-plan-end] ${label}: Stripe did not confirm cancel_at_period_end=${cancel}; will retry`); return false; }
  return true;
}

export interface PlanEndOpts { /** The ending plan subscription (excluded from the "other plan" check). */ excludeSub?: string; customerId?: string }

/** The plan ended: stop the site's active domain subscription(s) renewing, and tell the customer once. */
export async function onPlanEnded(slug: string, userId: string | null, deps: PlanEndDeps, opts: PlanEndOpts = {}): Promise<void> {
  try {
    const rows = await rowsOf(slug, deps);
    if (!rows.length) return;
    if (await deps.iosOwnsSlug?.(slug)) return; // the site moved to iOS: not ours to touch
    if (await deps.hasOtherPlan?.(userId, opts.excludeSub, opts.customerId)) return; // a tier switch / replacement plan
    for (const row of rows) {
      try {
        const subId = row.original_transaction_id.replace(/^stripe:/, '');
        if (!subId) continue;
        const sub = await deps.getSubscription(subId);
        if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) continue; // ended, other mode, unknown
        const end = periodEndMs(sub);
        if (end && end <= deps.now()) continue;
        const already = row.alerts_sent ?? {};
        if (already[OFF_BY_CUSTOMER]) continue; // the customer's own choice: leave it, nothing to tell
        let stamp = already[OFF_PLAN_ENDED];
        if (!sub.cancel_at_period_end) {
          // The intent marker first: if the Stripe write or its confirmation fails, the marker stays and a later pass retries
          // (the resume path treats a still-renewing sub with the marker as "spent" and clears it).
          if (!stamp) { stamp = iso(deps.now()); await setMarkers(deps, row, { [OFF_PLAN_ENDED]: stamp }); }
          if (!(await applyRenewal(deps, subId, true, slug))) continue;
          await deps.repo.update(row.original_transaction_id, null, { auto_renew: false, auto_renew_synced: false }).catch(() => {});
        } else if (!stamp) {
          continue; // off for another reason (not ours)
        }
        const token = await claim(deps, row, PLAN_ENDED_MAIL);
        if (!token) continue; // already sent (or another pass is sending it)
        const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        let sent = false;
        try {
          const to = customer ? await deps.contactEmail(userId, customer) : null;
          if (!to) console.error(`[domain-plan-end] ${slug}: no email address for the owner; nothing sent`);
          else {
            await deps.sendMail(to, planEndedEmail({ domain: row.domain, renewsOn: end ? iso(end).slice(0, 10) : 'the end of its paid year' }), `plan-ended-${subId}-${stamp}`); // the marker stamp is new for each end, so a second letter is never dropped as a duplicate
            sent = true;
          }
        } catch (e: any) { console.error(`[domain-plan-end] ${slug} ${row.domain} mail:`, e?.message || e); }
        if (!sent) await release(deps, row, PLAN_ENDED_MAIL, token); // a later pass retries
      } catch (e: any) { console.error(`[domain-plan-end] ${slug} ${row.domain}:`, e?.message || e); }
    }
  } catch (e: any) { console.error(`[domain-plan-end] ${slug}:`, e?.message || e); }
}

/** A plan is active again for this site: switch renewal back on, only where the plan ending turned it off and the period has not ended. */
export async function onPlanResumed(slug: string, deps: PlanEndDeps): Promise<void> {
  try {
    for (const row of await rowsOf(slug, deps)) {
      try {
        const marks = row.alerts_sent ?? {};
        if (!marks[OFF_PLAN_ENDED] || marks[OFF_BY_CUSTOMER]) continue;
        const subId = row.original_transaction_id.replace(/^stripe:/, '');
        if (!subId) continue;
        const sub = await deps.getSubscription(subId);
        if (!sub) continue;
        const end = periodEndMs(sub);
        const active = sub.status === 'active' || sub.status === 'trialing';
        if (active && sub.cancel_at_period_end && (!end || end > deps.now())) {
          if (!(await applyRenewal(deps, subId, false, `resume ${slug}`))) continue;
          await deps.repo.update(row.original_transaction_id, null, { auto_renew: true, auto_renew_synced: false }).catch(() => {});
        }
        // Past its period or already renewing: nothing to switch, but the marker is spent either way.
        await setMarkers(deps, row, {}, [OFF_PLAN_ENDED, PLAN_ENDED_MAIL]);
      } catch (e: any) { console.error(`[domain-plan-end] resume ${slug} ${row.domain}:`, e?.message || e); }
    }
  } catch (e: any) { console.error(`[domain-plan-end] resume ${slug}:`, e?.message || e); }
}

export interface DomainRenewalSweepDeps extends PlanEndDeps {
  /** The web site row for this slug in this mode, or null (not a web-app site). */
  siteOf(slug: string): Promise<{ user_id: string; published_at: string | null; taken_down_at: string | null; removed_at: string | null } | null>;
  hasEntitledRow(userId: string): Promise<boolean>;
  /** The owner's web-app Stripe customer (web_app_customers, else the newest entitlement row), or null. */
  customerOf(userId: string): Promise<string | null>;
}

/**
 * Backstop for a plan-end that failed (Stripe outage at the webhook): any active domain subscription of a web site that is
 * taken down, removed or unpublished, whose owner has no plan, and that nobody turned off, gets the plan-end again.
 * Idempotent (onPlanEnded checks Stripe first). Never throws.
 */
export async function sweepDomainRenewal(deps: DomainRenewalSweepDeps, limit = 50, scanMax = 1000): Promise<{ checked: number; ended: string[] }> {
  const out = { checked: 0, ended: [] as string[] };
  try {
    const rows = (await deps.repo.all())
      .filter((r) => r.source === 'stripe' && !DONE_STATES.includes(r.state) && !r.refunded_at && envMatchesKey(r, deps.mode)
        && !r.alerts_sent?.[OFF_BY_CUSTOMER] && !(r.alerts_sent?.[OFF_PLAN_ENDED] && r.alerts_sent?.[PLAN_ENDED_MAIL]))
      .slice(0, scanMax);
    // The budget counts rows ACTED ON, not rows looked at: healthy and legacy rows are skipped for free and never starve newer ones.
    for (const row of rows) {
      if (out.checked >= limit) break;
      try {
        const site = await deps.siteOf(row.site_slug);
        if (!site) continue;
        const gone = !site.published_at || !!site.taken_down_at || !!site.removed_at;
        if (!gone || (await deps.hasEntitledRow(site.user_id))) continue;
        // A plan that exists at Stripe but is not stored yet (a late webhook) must not be mistaken for "no plan":
        // without a known customer we cannot ask Stripe, so we do nothing.
        const customerId = await deps.customerOf(site.user_id);
        if (!customerId) continue;
        out.checked++;
        await onPlanEnded(row.site_slug, site.user_id, deps, { customerId });
        const fresh = await deps.repo.get(row.original_transaction_id);
        if (fresh?.alerts_sent?.[OFF_PLAN_ENDED]) out.ended.push(row.site_slug);
      } catch (e: any) { console.error(`[domain-plan-end] backstop ${row.site_slug}:`, e?.message || e); }
    }
  } catch (e: any) { console.error('[domain-plan-end] backstop:', e?.message || e); }
  return out;
}

/** Live wiring (lazy imports: the webhook and cron keep their cold start). */
export async function livePlanEndDeps(mode: 'live' | 'test' | null): Promise<DomainRenewalSweepDeps> {
  const { supabaseDomains } = await import('../ios/domainsRepo.js');
  const { serviceClient } = await import('../bookings/repo.js');
  const { stripeSubscription } = await import('../ios/domainLive.js');
  const { stripeSetRenewal } = await import('./domainOneClickLive.js');
  const { contactFor } = await import('./dunning.js');
  const { sendMail } = await import('./emails.js');
  const { sbRest, stripeCall } = await import('./webAppServer.js');
  const { isEntitledStatus } = await import('./stripeCore.js');
  const enc = encodeURIComponent;
  return {
    repo: supabaseDomains(serviceClient()),
    mode,
    getSubscription: stripeSubscription,
    setRenewal: stripeSetRenewal,
    contactEmail: async (userId, customerId) => (await contactFor(userId, customerId)).email,
    sendMail: (to, mail, key) => sendMail(to, mail, fetch, key),
    iosOwnsSlug: async (slug) => ((await sbRest(`ios_purchases?site_slug=eq.${enc(slug)}&select=original_transaction_id&limit=1`)) ?? []).length > 0,
    hasOtherPlan: async (userId, excludeSubId, customerId) => {
      if (userId) {
        const q = `web_app_entitlements?user_id=eq.${enc(userId)}&environment=eq.${mode}&status=in.(active,trialing,past_due)${excludeSubId ? `&stripe_subscription_id=neq.${enc(excludeSubId)}` : ''}&select=stripe_subscription_id&limit=1`;
        if (((await sbRest(q)) ?? []).length > 0) return true;
      }
      let customer = customerId;
      if (!customer && excludeSubId) {
        const sub = await stripeCall(`subscriptions/${enc(excludeSubId)}`, null, 'GET');
        customer = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id;
      }
      if (!customer) return false;
      const list = await stripeCall(`subscriptions?customer=${enc(customer)}&status=all&limit=20`, null, 'GET');
      return (list?.data ?? []).some((x: any) => x?.id !== excludeSubId && x?.metadata?.app === 'aibarber-app' && isEntitledStatus(String(x.status)));
    },
    siteOf: async (slug) => (await sbRest(`web_app_sites?slug=eq.${enc(slug)}&environment=eq.${mode}&select=user_id,published_at,taken_down_at,removed_at&limit=1`))?.[0] ?? null,
    hasEntitledRow: async (uid) => ((await sbRest(`web_app_entitlements?user_id=eq.${enc(uid)}&environment=eq.${mode}&status=in.(active,trialing,past_due)&select=stripe_subscription_id&limit=1`)) ?? []).length > 0,
    customerOf: async (uid) => {
      const c = (await sbRest(`web_app_customers?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=stripe_customer_id&limit=1`))?.[0]?.stripe_customer_id
        ?? (await sbRest(`web_app_entitlements?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=stripe_customer_id&order=created_at.desc&limit=1`))?.[0]?.stripe_customer_id;
      return typeof c === 'string' && c ? c : null;
    },
    now: () => Date.now(),
  };
}
