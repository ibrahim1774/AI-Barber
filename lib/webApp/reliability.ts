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

/** This is an immutable snapshot. Browser redirects never supply its contents to the worker. */
export async function prepareIntent(uid: string, draftId: unknown, revision: unknown, purpose: string, baseVersion: number | null = null, publication?: any): Promise<Intent> {
  const d = await readDraft(uid);
  if (!d || d.draft_id !== draftId || d.revision !== revision || (d.suspended && !(d.suspension_reason === 'offline' && purpose === 'publish'))) throw Object.assign(new Error('draft_changed'), { status: 409 });
  // Only derived links/team may differ from the acknowledged editor draft. All text/images come from that revision.
  const snapshot = publication ? { ...d.site_data, bookingUrl: publication.bookingUrl, shopUrl: publication.shopUrl, staff: publication.staff ?? d.site_data.staff } : d.site_data;
  try { validateWebSnapshot(snapshot); } catch { throw Object.assign(new Error('invalid_snapshot'), { status: 400 }); }
  const id = digest([uid, d.environment, d.draft_id, d.revision, purpose, baseVersion, digest(snapshot)]);
  const rows = await sbRest('rpc/submit_web_app_intent', { method: 'POST', body: {
    p_user: uid, p_environment: d.environment, p_draft: d.draft_id, p_revision: d.revision,
    p_id: id, p_snapshot: snapshot, p_status: purpose.startsWith('checkout') ? 'awaiting_payment' : 'queued', p_base_version: baseVersion,
  } });
  if (!rows?.length) throw Object.assign(new Error('draft_changed_or_publish_running'), { status: 503 });
  return rows[0];
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
