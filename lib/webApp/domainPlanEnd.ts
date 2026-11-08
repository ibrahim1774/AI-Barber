// When a web-app hosting plan ends, the site's custom domain stops renewing (cancel_at_period_end=true
// on the ONE domain subscription, never immediately, never a refund): it keeps working until its paid
// period ends. The customer gets one plain letter per domain. If the same site gets a plan again before
// then, renewal is switched back on, but ONLY when WE turned it off (not when the customer did).
// Reasons live in the row's alerts_sent markers. Web-app rows only (source 'stripe'); iOS rows untouched.
// Never throws: every caller is a webhook or a cron that must not fail over this.
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
  repo: Pick<DomainsRepo, 'all' | 'get' | 'update'>;
  /** The Stripe mode of the web-app key that raised this ('live' | 'test'). */
  mode: 'live' | 'test' | null;
  getSubscription(subId: string): Promise<any | null>;
  setRenewal(subId: string, cancelAtPeriodEnd: boolean, idempotencyKey: string): Promise<{ ok: boolean; status: number; data: any }>;
  /** The owner's email, or null. */
  contactEmail(userId: string | null, customerId: string): Promise<string | null>;
  sendMail(to: string, mail: Mail): Promise<unknown>;
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

async function setMarkers(deps: PlanEndDeps, row: DomainRow, add: Record<string, string>, remove: string[] = []): Promise<void> {
  const fresh = (await deps.repo.get(row.original_transaction_id).catch(() => null)) ?? row;
  const next = { ...(fresh.alerts_sent ?? {}), ...add };
  for (const k of remove) delete next[k];
  await deps.repo.update(row.original_transaction_id, null, { alerts_sent: next });
}

/** The plan ended: stop the site's active domain subscription(s) renewing, and tell the customer once. */
export async function onPlanEnded(slug: string, userId: string | null, deps: PlanEndDeps): Promise<void> {
  try {
    for (const row of await rowsOf(slug, deps)) {
      try {
        const subId = row.original_transaction_id.replace(/^stripe:/, '');
        if (!subId) continue;
        const sub = await deps.getSubscription(subId);
        if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) continue; // ended, other mode, unknown
        const end = periodEndMs(sub);
        if (end && end <= deps.now()) continue;
        const already = row.alerts_sent ?? {};
        if (sub.cancel_at_period_end) {
          // Off already: by the customer (leave it, nothing to tell) or by us earlier (the mail below is once-only).
          if (!already[OFF_PLAN_ENDED]) continue;
        } else {
          const r = await deps.setRenewal(subId, true, `domain-plan-ended-${subId}`);
          if (!r.ok) { console.error(`[domain-plan-end] ${slug}: stripe ${r.status} ${r.data?.error?.code || r.data?.error?.type || 'unknown'}`); continue; }
          await setMarkers(deps, row, { [OFF_PLAN_ENDED]: iso(deps.now()) });
          await deps.repo.update(row.original_transaction_id, null, { auto_renew: false, auto_renew_synced: false }).catch(() => {});
        }
        if (already[PLAN_ENDED_MAIL]) continue;
        const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
        const to = customer ? await deps.contactEmail(userId, customer) : null;
        if (!to) { console.error(`[domain-plan-end] ${slug}: no email address for the owner; nothing sent`); continue; }
        await deps.sendMail(to, planEndedEmail({ domain: row.domain, renewsOn: end ? iso(end).slice(0, 10) : 'the end of its paid year' }));
        await setMarkers(deps, row, { [PLAN_ENDED_MAIL]: iso(deps.now()) });
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
          const r = await deps.setRenewal(subId, false, `domain-plan-resumed-${subId}-${Math.floor(deps.now() / 60_000)}`);
          if (!r.ok) { console.error(`[domain-plan-end] resume ${slug}: stripe ${r.status} ${r.data?.error?.code || r.data?.error?.type || 'unknown'}`); continue; }
          await deps.repo.update(row.original_transaction_id, null, { auto_renew: true, auto_renew_synced: false }).catch(() => {});
        }
        // Past its period or already renewing: nothing to switch, but the marker is spent either way.
        await setMarkers(deps, row, {}, [OFF_PLAN_ENDED, PLAN_ENDED_MAIL]);
      } catch (e: any) { console.error(`[domain-plan-end] resume ${slug} ${row.domain}:`, e?.message || e); }
    }
  } catch (e: any) { console.error(`[domain-plan-end] resume ${slug}:`, e?.message || e); }
}

/** Live wiring (lazy imports: the webhook and cron keep their cold start). */
export async function livePlanEndDeps(mode: 'live' | 'test' | null): Promise<PlanEndDeps> {
  const { supabaseDomains } = await import('../ios/domainsRepo.js');
  const { serviceClient } = await import('../bookings/repo.js');
  const { stripeSubscription } = await import('../ios/domainLive.js');
  const { stripeSetRenewal } = await import('./domainOneClickLive.js');
  const { contactFor } = await import('./dunning.js');
  const { sendMail } = await import('./emails.js');
  return {
    repo: supabaseDomains(serviceClient()),
    mode,
    getSubscription: stripeSubscription,
    setRenewal: stripeSetRenewal,
    contactEmail: async (userId, customerId) => (await contactFor(userId, customerId)).email,
    sendMail: (to, mail) => sendMail(to, mail),
    now: () => Date.now(),
  };
}
