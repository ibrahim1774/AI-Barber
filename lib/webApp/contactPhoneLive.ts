// Live (Supabase REST + auth admin) wiring for lib/webApp/contactPhone.ts and the /me phone lookup.
import { callerFrom, sbRest } from './webAppServer.js';
import { normalizePhoneE164 } from '../phone/e164.js';
import type { ContactPhoneDeps, AuthPhoneSync } from './contactPhone.js';

const enc = encodeURIComponent;
const sbEnv = () => ({ url: process.env.SUPABASE_URL as string | undefined, key: process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined });

async function authAdmin(userId: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: any }> {
  const { url, key } = sbEnv();
  if (!url || !key) return { status: 0, json: null };
  const r = await fetch(`${url}/auth/v1/admin/users/${enc(userId)}`, {
    method: init.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

export function liveContactPhoneDeps(mode: 'live' | 'test'): ContactPhoneDeps {
  return {
    callerFrom,
    mode,
    now: () => new Date().toISOString(),
    async upsertContact(row) {
      await sbRest('customer_contacts?on_conflict=user_id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal' });
    },
    async stampSite(userId, m, phone, at) {
      const rows: any[] = (await sbRest(`web_app_sites?user_id=eq.${enc(userId)}&environment=eq.${m}&removed_at=is.null&select=slug&limit=1`)) ?? [];
      const slug = rows[0]?.slug;
      if (typeof slug !== 'string') return null;
      await sbRest(`web_app_sites?slug=eq.${enc(slug)}`, { method: 'PATCH', body: { contact_phone: phone, contact_phone_at: at }, prefer: 'return=minimal' });
      return slug;
    },
    async syncAuthPhone(userId, phone): Promise<AuthPhoneSync> {
      const r = await authAdmin(userId, { method: 'PUT', body: { phone, phone_confirm: true } });
      if (r.status >= 200 && r.status < 300) return 'synced';
      return r.status === 422 || r.status === 409 ? 'conflict' : 'error';
    },
    async mergeMetadataPhone(userId, phone) {
      const cur = await authAdmin(userId);
      if (cur.status !== 200) return;
      await authAdmin(userId, { method: 'PUT', body: { user_metadata: { ...(cur.json?.user_metadata ?? {}), phone } } });
    },
  };
}

let warned = false;
/**
 * The saved phone for /me as E.164: customer_contacts, then the auth phone, then user_metadata.phone (each validated).
 * `contactsOk` is false when the customer_contacts read itself failed (e.g. migration 032 not applied yet): /me then
 * fails open (no gate), so nobody is locked behind a step that cannot save. Logged once per process.
 */
export async function savedPhoneState(userId: string): Promise<{ phone: string | null; contactsOk: boolean }> {
  let contactsOk = true;
  try {
    const c = (await sbRest(`customer_contacts?user_id=eq.${enc(userId)}&select=phone_e164&limit=1`))?.[0]?.phone_e164;
    const n = normalizePhoneE164(c);
    if (n.ok) return { phone: n.e164, contactsOk };
  } catch (e: any) {
    contactsOk = false;
    if (!warned) { warned = true; console.error('[web-app phone] contacts read failed, phone gate off until it works:', e?.status ?? 'err'); }
  }
  try {
    const u = (await authAdmin(userId)).json;
    // Supabase stores auth.phone without '+'. Junk (free-text sign-up phone) must not count as a saved phone.
    const ap = typeof u?.phone === 'string' && /^\d+$/.test(u.phone.trim()) ? `+${u.phone.trim()}` : u?.phone;
    for (const cand of [ap, u?.user_metadata?.phone]) { const n = normalizePhoneE164(cand); if (n.ok) return { phone: n.e164, contactsOk }; }
  } catch { /* fail soft */ }
  return { phone: null, contactsOk };
}

export async function savedPhoneOf(userId: string): Promise<string | null> {
  return (await savedPhoneState(userId)).phone;
}
