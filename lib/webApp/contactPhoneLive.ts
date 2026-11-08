// Live (Supabase REST + auth admin) wiring for lib/webApp/contactPhone.ts and the /me phone lookup.
import { callerFrom, sbRest } from './webAppServer.js';
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

/** The saved phone for /me: customer_contacts, then the auth phone, then user_metadata.phone. Fails soft to null. */
export async function savedPhoneOf(userId: string): Promise<string | null> {
  try {
    const c = (await sbRest(`customer_contacts?user_id=eq.${enc(userId)}&select=phone_e164&limit=1`))?.[0]?.phone_e164;
    if (typeof c === 'string' && c) return c;
  } catch (e: any) { console.error('[web-app phone] contacts read failed:', e?.status ?? 'err'); }
  try {
    const u = (await authAdmin(userId)).json;
    const p = u?.phone || u?.user_metadata?.phone;
    if (typeof p === 'string' && p.trim()) return p.trim();
  } catch { /* fail soft */ }
  return null;
}

/** True when the user has a bound (non-removed) site row in this mode: payment happened even if the webhook entitlement lags. */
export async function hasBoundSite(userId: string, mode: 'live' | 'test'): Promise<boolean> {
  try { return ((await sbRest(`web_app_sites?user_id=eq.${enc(userId)}&environment=eq.${mode}&removed_at=is.null&select=slug&limit=1`)) ?? []).length > 0; }
  catch { return false; }
}
