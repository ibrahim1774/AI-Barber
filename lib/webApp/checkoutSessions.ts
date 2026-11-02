// The one open Checkout session per (user, mode), kept in web_app_checkout_sessions (migration 026). Everything here is
// best effort and fails soft while the table is missing: a problem is logged, never thrown.
import { sbRest, stripeCall } from './webAppServer.js';

const enc = encodeURIComponent;
const path = (uid: string, mode: string) => `web_app_checkout_sessions?user_id=eq.${enc(uid)}&environment=eq.${mode}`;

export async function storedSessionId(uid: string, mode: 'live' | 'test'): Promise<string | null> {
  try { const id = (await sbRest(`${path(uid, mode)}&select=stripe_session_id&limit=1`))?.[0]?.stripe_session_id; return typeof id === 'string' ? id : null; }
  catch (e: any) { console.error('[web-app checkout-sessions] read failed:', e?.message || e); return null; }
}
export async function rememberSession(uid: string, mode: 'live' | 'test', sessionId: string): Promise<void> {
  try { await sbRest('web_app_checkout_sessions?on_conflict=user_id,environment', { method: 'POST', body: { user_id: uid, environment: mode, stripe_session_id: sessionId, created_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' }); }
  catch (e: any) { console.error('[web-app checkout-sessions] write failed:', e?.message || e); }
}
export async function forgetSession(uid: string, mode: 'live' | 'test'): Promise<void> {
  try { await sbRest(path(uid, mode), { method: 'DELETE' }); }
  catch (e: any) { console.error('[web-app checkout-sessions] delete failed:', e?.message || e); }
}
/** Expire a session by id. An already complete or expired one just errors; that is fine. */
export async function expireSession(sessionId: string): Promise<void> {
  await stripeCall(`checkout/sessions/${enc(sessionId)}/expire`, {}, 'POST').catch((e: any) => console.error('[web-app checkout-sessions] expire:', e?.message || e));
}
