// POST /api/web-app/contact-phone core: validate, store the number, mirror it where it is useful.
// Never reveals whether a number is used by another account (an auth unique-phone conflict still answers 200),
// and never logs a number in full.
import { normalizePhoneE164 } from '../phone/e164.js';

export type AuthPhoneSync = 'synced' | 'conflict' | 'error';

export interface ContactPhoneDeps {
  callerFrom(authorization: unknown): Promise<{ id: string; email: string | null } | null>;
  mode: 'live' | 'test';
  now(): string;
  /** Upsert the customer_contacts row. Throws on failure. */
  upsertContact(row: { user_id: string; phone_e164: string; source: 'post_pay_web'; environment: 'live' | 'test'; site_slug: string | null; auth_phone_synced: boolean; updated_at: string }): Promise<void>;
  /** Stamp web_app_sites.contact_phone of the user's current non-removed site in this mode; returns its slug or null. */
  stampSite(userId: string, mode: 'live' | 'test', phone: string, at: string): Promise<string | null>;
  /** Best effort auth.admin.updateUserById({phone, phone_confirm:true}). */
  syncAuthPhone(userId: string, phone: string): Promise<AuthPhoneSync>;
  /** Best effort merge of user_metadata.phone. */
  mergeMetadataPhone(userId: string, phone: string): Promise<void>;
  /** Log helper; receives already-masked text only. */
  log?(msg: string): void;
}

export type ContactPhoneResult =
  | { status: 200; body: { ok: true; phone: string } }
  | { status: 400 | 401 | 405 | 500; body: { error: 'invalid_phone' | 'unauthorized' | 'method_not_allowed' | 'save_failed' } };

/** +1•••••••123: country part and last 3 digits only. */
export const maskPhone = (e164: string) => `${e164.slice(0, 2)}${'•'.repeat(Math.max(0, e164.length - 5))}${e164.slice(-3)}`;

export async function saveContactPhone(authorization: unknown, body: unknown, deps: ContactPhoneDeps, method = 'POST'): Promise<ContactPhoneResult> {
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const caller = await deps.callerFrom(authorization);
  if (!caller) return { status: 401, body: { error: 'unauthorized' } };
  const raw = body && typeof body === 'object' ? (body as any).phone : undefined;
  const n = normalizePhoneE164(raw);
  if (!n.ok) return { status: 400, body: { error: 'invalid_phone' } };
  const phone = n.e164;
  const at = deps.now();
  const log = deps.log ?? ((m: string) => console.error(m));
  const tag = `[contact-phone ${caller.id.slice(0, 8)} ${maskPhone(phone)}]`;

  let slug: string | null = null;
  try { slug = await deps.stampSite(caller.id, deps.mode, phone, at); } catch (e: any) { log(`${tag} site stamp failed: ${e?.status ?? 'err'}`); }

  const row = (synced: boolean) => ({ user_id: caller.id, phone_e164: phone, source: 'post_pay_web' as const, environment: deps.mode, site_slug: slug, auth_phone_synced: synced, updated_at: at });
  try { await deps.upsertContact(row(false)); } catch (e: any) { log(`${tag} save failed: ${e?.status ?? 'err'}`); return { status: 500, body: { error: 'save_failed' } }; }

  let sync: AuthPhoneSync = 'error';
  try { sync = await deps.syncAuthPhone(caller.id, phone); } catch { sync = 'error'; }
  if (sync === 'synced') {
    try { await deps.upsertContact(row(true)); } catch (e: any) { log(`${tag} synced-flag update failed: ${e?.status ?? 'err'}`); }
  } else {
    log(`${tag} auth phone not synced (${sync})`); // same outcome for a taken number and a transient error: nothing is revealed to the caller
  }
  try { await deps.mergeMetadataPhone(caller.id, phone); } catch { /* best effort */ }
  return { status: 200, body: { ok: true, phone } };
}
