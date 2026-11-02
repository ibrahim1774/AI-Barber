import { createHash, randomUUID } from 'node:crypto';
import { sbRest } from './webAppServer.js';
import { validateWebSnapshot } from './publishFlow.js';
import { keyMode } from './stripeCore.js';

export const reliabilityOn = () => process.env.WEB_APP_RELIABILITY === '1';
export const modeOf = () => {
  const mode = keyMode(process.env.STRIPE_WEBAPP_SECRET_KEY);
  if (!mode) throw new Error('web billing mode missing');
  return mode;
};
export const enc = encodeURIComponent;
export const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
export const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
export interface Draft {
  user_id: string; environment: string; draft_id: string; revision: number; site_data: any;
  updated_at: string; deployed_url: string | null; latest_intent_id: string | null;
  publish_lease: string | null; lease_until: string | null; suspended: boolean; suspension_reason?: string | null; published_binding?: any;
}
export interface Intent {
  id: string; user_id: string; environment: string; draft_id: string; revision: number;
  requires_payment?: boolean; snapshot: any; base_version: number | null; status: string; attempts: number;
  stripe_session_id: string | null; stripe_subscription_id: string | null;
  result: any; next_attempt_at: string; created_at: string;
}
export const draftPath = (uid: string, mode = modeOf()) => `web_app_drafts?user_id=eq.${enc(uid)}&environment=eq.${mode}`;
export async function readDraft(uid: string): Promise<Draft | null> {
  return (await sbRest(`${draftPath(uid)}&select=*&limit=1`))?.[0] ?? null;
}
export function accountRow(d: Draft) {
  return { id: d.draft_id, site_data: d.site_data, updated_at: d.updated_at, deployed_url: d.deployed_url, revision: d.revision, webBinding: d.published_binding ?? null };
}

/** Only the two link fields a browser decides; anything else is ignored. Absent = the browser decided "no link". */
export function publicationFrom(v: unknown): { bookingUrl?: string; shopUrl?: string } | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const s = (x: unknown) => (typeof x === 'string' && x.trim() && x.length <= 2048 ? x.trim() : undefined);
  return { bookingUrl: s(o.bookingUrl), shopUrl: s(o.shopUrl) };
}

const publishLike = (purpose: string) => purpose === 'publish' || purpose === 'checkout:publish';
export interface IntentPlan { uid: string; draft: Draft; snapshot: any; id: string; purpose: string; baseVersion: number | null; republish?: boolean }

/** Validates the saved revision and computes the deterministic intent id. Writes nothing, so a caller can create its Stripe session first. */
export async function planIntent(uid: string, draftId: unknown, revision: unknown, purpose: string, baseVersion: number | null = null, publication?: any, republish = false): Promise<IntentPlan> {
  const d = await readDraft(uid);
  if (!d || d.draft_id !== draftId || d.revision !== revision || (d.suspended && !(d.suspension_reason === 'offline' && publishLike(purpose)))) throw Object.assign(new Error('draft_changed'), { status: 409 });
  // Only derived links/team may differ from the acknowledged editor draft. Text and images come from that revision
  // (publish.ts also passes the browser's staff list, bookingUrl and shopUrl; all of it is validated below).
  const snapshot: any = publication ? { ...d.site_data, bookingUrl: publication.bookingUrl, shopUrl: publication.shopUrl, staff: publication.staff ?? d.site_data.staff } : d.site_data;
  if (publication) for (const k of ['bookingUrl', 'shopUrl'] as const) if (snapshot[k] == null) delete snapshot[k];
  try { validateWebSnapshot(snapshot); }
  catch (e: any) { throw Object.assign(new Error('invalid_snapshot'), { status: 400, reason: e?.message === 'logo-folder' ? 'logo-folder' : 'invalid_snapshot' }); }
  const id = digest([uid, d.environment, d.draft_id, d.revision, purpose, baseVersion, digest(snapshot)]);
  return { uid, draft: d, snapshot, id, purpose, baseVersion, republish };
}
/** Stores the submission. Content whose earlier submission is `live` runs again only when the site was taken offline
 *  (no deployed_url), the user explicitly republished, or it is a checkout; an automatic client retry gets the stored result. */
export async function submitIntent(plan: IntentPlan): Promise<Intent> {
  const { uid, draft: d, snapshot, id, purpose, baseVersion } = plan;
  let demoted: any = null;
  let lifted = false;
  if (publishLike(purpose)) {
    // A revived row starts a fresh attempt budget and does not carry an old refusal.
    await sbRest(`web_app_publish_intents?id=eq.${enc(id)}&user_id=eq.${enc(uid)}&environment=eq.${d.environment}&status=in.(cancelled,superseded)`, {
      method: 'PATCH', body: { attempts: 0, result: null, worker_token: null, created_at: new Date().toISOString() },
    });
    if (purpose === 'checkout:publish' || plan.republish || d.deployed_url == null) {
      // The RPC only revives cancelled/superseded rows. A `live` row for the same content is history: re-queue it as a fresh submission.
      const old = await sbRest(`web_app_publish_intents?id=eq.${enc(id)}&user_id=eq.${enc(uid)}&environment=eq.${d.environment}&status=eq.live`, {
        method: 'PATCH', body: { status: 'superseded', stripe_session_id: null, stripe_subscription_id: null, result: null, attempts: 0, worker_token: null, created_at: new Date().toISOString() }, prefer: 'return=representation',
      });
      demoted = old?.[0] ?? null;
    }
    // A site taken offline stays suspended until the user explicitly publishes again; the RPC only lifts that for unpaid publish submissions.
    if (purpose === 'checkout:publish' && d.suspended && d.suspension_reason === 'offline') {
      await sbRest(`${draftPath(uid, d.environment as "live" | "test")}&suspension_reason=eq.offline`, { method: 'PATCH', body: { suspended: false, suspension_reason: null } });
      lifted = true;
    }
  }
  const rows = await sbRest('rpc/submit_web_app_intent', { method: 'POST', body: {
    p_user: uid, p_environment: d.environment, p_draft: d.draft_id, p_revision: d.revision,
    p_id: id, p_snapshot: snapshot, p_status: purpose.startsWith('checkout') ? 'awaiting_payment' : 'queued', p_base_version: baseVersion,
  } });
  if (!rows?.length) {
    if (demoted) await sbRest(`web_app_publish_intents?id=eq.${enc(id)}&status=eq.superseded`, { method: 'PATCH', body: {
      status: 'live', result: demoted.result, stripe_session_id: demoted.stripe_session_id, stripe_subscription_id: demoted.stripe_subscription_id, attempts: demoted.attempts, worker_token: demoted.worker_token } }).catch(() => {});
    if (lifted) await sbRest(`${draftPath(uid, d.environment as "live" | "test")}&suspended=eq.false&latest_intent_id=is.null`, { method: 'PATCH', body: { suspended: true, suspension_reason: 'offline' } }).catch(() => {});
    throw Object.assign(new Error('draft_changed_or_publish_running'), { status: 503 });
  }
  return rows[0];
}
/** This is an immutable snapshot. Browser redirects never supply its contents to the worker. */
export async function prepareIntent(uid: string, draftId: unknown, revision: unknown, purpose: string, baseVersion: number | null = null, publication?: any, republish = false): Promise<Intent> {
  return submitIntent(await planIntent(uid, draftId, revision, purpose, baseVersion, publication, republish));
}
/** After the site has really been taken offline: the draft no longer reports a deployment, and finished submissions can run again. */
export async function markSiteOffline(uid: string) {
  if (!reliabilityOn()) return;
  await sbRest(draftPath(uid), { method: 'PATCH', body: { deployed_url: null, published_binding: null } });
  await sbRest(`web_app_publish_intents?user_id=eq.${enc(uid)}&environment=eq.${modeOf()}&status=eq.live`, { method: 'PATCH', body: { status: 'superseded', attempts: 0, result: null } });
}
export async function suspendWork(uid: string, reason: 'offline' | 'deleting' = 'offline') {
  if (!reliabilityOn()) return;
  const d = await readDraft(uid);
  if (!d) return;
  // Do not race an external deploy already in flight. No destructive action has happened when this refuses.
  if (d.publish_lease && Date.parse(d.lease_until ?? '') > Date.now()) throw new Error('publish-in-progress');
  const rows = await sbRest(`${draftPath(uid)}&or=(publish_lease.is.null,lease_until.lt.${enc(new Date().toISOString())})`, {
    method: 'PATCH', body: { suspended: true, suspension_reason: reason, latest_intent_id: null }, prefer: 'return=representation',
  });
  if (!rows?.length) throw new Error('publish-in-progress');
  await sbRest(`web_app_publish_intents?user_id=eq.${enc(uid)}&environment=eq.${modeOf()}&status=in.(awaiting_payment,queued,failed,running)`, {
    method: 'PATCH', body: { status: 'cancelled' },
  });

}
export const leaseId = () => randomUUID();

/** A failed deletion leaves the saved draft editable; cancelled jobs are never resurrected. */
export async function resumeAfterFailedDelete(uid: string) {
  if (!reliabilityOn()) return;
  await sbRest(`${draftPath(uid)}&suspension_reason=eq.deleting`, { method: 'PATCH', body: { suspended: false, suspension_reason: null } });
}
