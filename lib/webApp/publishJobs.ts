import { waitUntil } from '@vercel/functions';
import { liveWebPublishDeps, runWebPublish, type WebPublishResult } from './publishFlow.js';
import { enc, draftPath, leaseId, modeOf, readDraft, reliabilityOn, type Intent } from './reliability.js';
import { sbRest, stripeCall } from './webAppServer.js';
import { isEntitledStatus, rowFromSubscription } from './stripeCore.js';

/** A failing job is retried with backoff, then parked (cancelled, with an alert in the logs) so it cannot be polled forever. */
export const MAX_JOB_ATTEMPTS = 20;
/** A checkout that never got a payable session, or was never paid, is abandoned after this long. */
export const ABANDON_AFTER_MS = 3_600_000;
export interface JobDeps {
  claim(id: string, token: string): Promise<Intent | null>;
  current(job: Intent, token: string): Promise<boolean>;
  paid(job: Intent): Promise<boolean>;
  publish(job: Intent, guard: () => Promise<void>): Promise<WebPublishResult>;
  finish(job: Intent, token: string, status: string, result: unknown): Promise<void>;
  release(job: Intent, token: string): Promise<void>;
}
/** One immutable submission; duplicate events, retries, and browsers converge on its stored outcome. */
export async function runJob(id: string, deps: JobDeps = liveJobDeps()) {
  const token = leaseId();
  const job = await deps.claim(id, token);
  if (!job) return;
  try {
    const guard = async () => { if (!(await deps.current(job, token))) throw new Error('submission-superseded'); };
    await guard();
    if (!(await deps.paid(job))) {
      await deps.finish(job, token, 'awaiting_payment', null);
      return;
    }
    const result = await deps.publish(job, guard);
    await guard();
    const status = result.status === 200 ? 'live' : result.status === 409 || result.status === 400 || result.status === 403 ? 'superseded' : 'failed';
    await deps.finish(job, token, status, result);
  } catch (e: any) {
    const current = await deps.current(job, token).catch(() => false);
    await deps.finish(job, token, current ? 'failed' : 'superseded', { error: current ? 'publish_retry_required' : 'submission_superseded' });
  } finally { await deps.release(job, token); }
}

export function liveJobDeps(): JobDeps {
  return {
    async claim(id, token) {
      const job: Intent | undefined = (await sbRest(`web_app_publish_intents?id=eq.${enc(id)}&environment=eq.${modeOf()}&status=in.(queued,failed,running)&select=*&limit=1`))?.[0];
      if (!job) return null;
      const now = new Date().toISOString();
      const rows = await sbRest(`${draftPath(job.user_id)}&latest_intent_id=eq.${job.id}&suspended=eq.false&or=(publish_lease.is.null,lease_until.lt.${enc(now)})`, {
        method: 'PATCH', body: { publish_lease: token, lease_until: new Date(Date.now() + 600_000).toISOString() }, prefer: 'return=representation',
      });
      if (!rows?.length) {
        await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=in.(queued,failed,running)`, { method: 'PATCH', body: { next_attempt_at: new Date(Date.now() + 60_000).toISOString() } });
        return null;
      }
      try {
        const changed = await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=in.(queued,failed,running)`, {
          method: 'PATCH', body: { status: 'running', worker_token: token, attempts: job.attempts + 1 }, prefer: 'return=representation',
        });
        if (changed?.length) return changed[0];
      } catch (e) {
        await sbRest(`${draftPath(job.user_id)}&publish_lease=eq.${token}`, { method: 'PATCH', body: { publish_lease: null, lease_until: null } });
        throw e;
      }
      await sbRest(`${draftPath(job.user_id)}&publish_lease=eq.${token}`, { method: 'PATCH', body: { publish_lease: null, lease_until: null } });
      return null;
    },
    async current(job, token) {
      const d = await readDraft(job.user_id);
      return !!d && !d.suspended && d.latest_intent_id === job.id && d.publish_lease === token && Date.parse(d.lease_until ?? '') > Date.now();
    },
    async paid(job) {
      // Stripe is rechecked even when the entitlement webhook or an earlier attempt said paid.
      // An unlinked checkout submission (its own session was never created or linked) is still covered by a paid
      // hosting plan: the customer may have paid an older open session. That is checked from Stripe below.
      let subId = job.stripe_subscription_id;
      if (job.stripe_session_id) {
        const session = await stripeCall(`checkout/sessions/${enc(job.stripe_session_id)}`, null, 'GET');
        if (session.client_reference_id !== job.user_id || session.metadata?.intent_id !== job.id) return false;
        if (session.status === 'complete' && ['paid','no_payment_required'].includes(session.payment_status)) {
          subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        }
      }
      if (!subId) {
        // The customer may have completed an earlier tab as a newer tab was opened. One paid hosting plan covers
        // the latest explicit publish submission; never require another charge for this race.
        const customer = (await sbRest(`web_app_customers?user_id=eq.${enc(job.user_id)}&environment=eq.${job.environment}&select=stripe_customer_id&limit=1`))?.[0]?.stripe_customer_id;
        if (!customer) return false;
        const subs = await stripeCall(`subscriptions?customer=${enc(customer)}&status=all&limit=20`, null, 'GET');
        subId = (subs?.data ?? []).find((s: any) => s.metadata?.app === 'aibarber-app' && s.metadata?.user_id === job.user_id && isEntitledStatus(s.status))?.id;
      }
      if (!subId) return false;
      const sub = await stripeCall(`subscriptions/${enc(subId)}`, null, 'GET');
      const row = rowFromSubscription(sub, job.environment === 'live', process.env);
      if (!row || row.user_id !== job.user_id || !isEntitledStatus(row.status)) return false;
      const upsert: Record<string, unknown> = { ...row, updated_at: new Date().toISOString() };
      if (upsert.site_slug == null) delete upsert.site_slug;
      await sbRest('web_app_entitlements?on_conflict=stripe_subscription_id', { method: 'POST', body: upsert, prefer: 'resolution=merge-duplicates,return=minimal' });
      // The webhook may never have arrived; reconciling Stripe restores entitlement too.
      if (job.stripe_subscription_id !== subId) await sbRest(`web_app_publish_intents?id=eq.${job.id}`, { method: 'PATCH', body: { stripe_subscription_id: subId } });
      job.stripe_subscription_id = subId;
      return true;
    },
    async publish(job, guard) {
      const deps = liveWebPublishDeps();
      // Never retain a customer's bearer token. Verify the account still exists at execution time.
      deps.userOf = async () => {
        const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${enc(job.user_id)}`, {
          headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('account_lookup_failed');
        const user: any = await r.json();
        return { id: user.id, email: user.email ?? null };
      };
      deps.assertCurrent = guard;
      return runWebPublish({ siteData: job.snapshot, baseVersion: job.base_version }, deps);
    },
    async finish(job, token, status, result) {
      // (status/result may be rewritten below when a job gives up)
      const d = await readDraft(job.user_id);
      if (!d || d.publish_lease !== token || d.latest_intent_id !== job.id || Date.parse(d.lease_until ?? '') <= Date.now()) return;
      if (status === 'live') {
        const answer = (result as any)?.body;
        const rows = await sbRest(`${draftPath(job.user_id)}&publish_lease=eq.${token}&latest_intent_id=eq.${job.id}&lease_until=gt.${enc(new Date().toISOString())}`, {
          method: 'PATCH', body: { deployed_url: answer?.deployedUrl ?? null,
            published_binding: { slug: answer?.siteId, transactionId: 'web:' + job.stripe_subscription_id, serverVersion: answer?.version,
              publishedRevision: job.revision }, updated_at: new Date().toISOString() }, prefer: 'return=representation',
        });
        if (!rows?.length) return;
      }
      if (status === 'failed' && job.attempts >= MAX_JOB_ATTEMPTS) {
        console.error('[web publish worker] giving up after', job.attempts, 'attempts:', job.id);
        status = 'cancelled'; result = { ...(typeof result === 'object' && result ? result : {}), error: 'publish_gave_up' };
      }
      await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=eq.running&worker_token=eq.${token}`, { method: 'PATCH', body: { status, result,
        next_attempt_at: new Date(Date.now() + Math.min(900_000, 10_000 * 2 ** Math.min(job.attempts, 6))).toISOString() } });
    },
    async release(job, token) {
      await sbRest(`${draftPath(job.user_id)}&publish_lease=eq.${token}`, { method: 'PATCH', body: { publish_lease: null, lease_until: null } });
    },
  };
}
export function dispatchJob(id: string) { waitUntil(runJob(id).catch(e => console.error('[web publish worker]', e?.message))); }

/** Reconcile payment from Stripe even when its webhook was missed; no browser redirect is needed.
 *  Bounded: abandoned checkouts and permanently failing jobs are closed, and real publish work is served before payment polling. */
export async function sweepJobs() {
  if (!reliabilityOn()) return { checked: 0 };
  const env = modeOf();
  const nowIso = new Date().toISOString();
  const abandoned = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  // Housekeeping (database only): never-linked checkouts older than an hour, and jobs that exhausted their attempts.
  await sbRest(`web_app_publish_intents?environment=eq.${env}&status=eq.awaiting_payment&stripe_session_id=is.null&created_at=lt.${enc(abandoned)}`, { method: 'PATCH', body: { status: 'cancelled' } }).catch(() => {});
  await sbRest(`web_app_publish_intents?environment=eq.${env}&status=eq.failed&attempts=gte.${MAX_JOB_ATTEMPTS}`, { method: 'PATCH', body: { status: 'cancelled' } }).catch(() => {});
  const due = `environment=eq.${env}&next_attempt_at=lte.${enc(nowIso)}`;
  const LIMIT = 10;
  // Work that is already paid (or free of payment) comes first, oldest due first; payment polling only uses the remaining slots.
  const work: Intent[] = (await sbRest(`web_app_publish_intents?${due}&status=in.(queued,failed,running)&order=next_attempt_at.asc&limit=${LIMIT}`)) ?? [];
  const polling: Intent[] = work.length >= LIMIT ? [] :
    (await sbRest(`web_app_publish_intents?${due}&status=eq.awaiting_payment&order=created_at.asc&limit=${LIMIT - work.length}`)) ?? [];
  const rows = [...work, ...polling];
  const started = Date.now();
  for (const job of rows) {
    if (Date.now() - started > 210_000) break;
    try {
      if (job.status === 'awaiting_payment') {
        const age = Date.now() - Date.parse(job.created_at);
        if (job.stripe_session_id) {
          const session = await stripeCall(`checkout/sessions/${enc(job.stripe_session_id)}`, null, 'GET').catch(() => null);
          if (session?.status === 'expired') {
            // An expired session can never be paid. Still check for an entitlement paid through another tab before closing it.
            if (!(await liveJobDeps().paid(job).catch(() => false))) {
              await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=eq.awaiting_payment`, { method: 'PATCH', body: { status: 'cancelled' } });
              continue;
            }
          }
        }
        const paid = await liveJobDeps().paid(job).catch(() => false);
        if (!paid) {
          if (age > ABANDON_AFTER_MS && !job.stripe_session_id) {
            await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=eq.awaiting_payment`, { method: 'PATCH', body: { status: 'cancelled' } });
          } else {
            await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=eq.awaiting_payment`, { method: 'PATCH', body: { next_attempt_at: new Date(Date.now() + (age > 600_000 ? 300_000 : 60_000)).toISOString() } });
          }
          continue;
        }
        await sbRest(`web_app_publish_intents?id=eq.${job.id}&status=eq.awaiting_payment`, { method: 'PATCH', body: { status: 'queued' } });
      }
      await runJob(job.id);
    } catch (e: any) { console.error('[web publish sweep]', e?.message); }
  }
  return { checked: rows.length };
}
