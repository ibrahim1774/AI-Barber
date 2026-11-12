// Sign-up log: every new Prime Barber account is posted once to a Make.com webhook that appends a Google Sheet row.
// Runs inside the 10-minute /api/web-app/nudges cron, after enrollment, so every sign-up already has a row in
// web_app_signup_nudges; that row is the ledger (sheet_sent_at / sheet_claimed_at, migration 035).
//  - gated by MAKE_SIGNUP_WEBHOOK_URL (never hardcoded) and MAKE_SIGNUP_SINCE (ISO; only accounts created after it);
//  - independent of the nudge stop rules: a paid / iOS / live user is still a sign-up;
//  - claim before send (atomic PATCH), 10 s timeout, non-2xx or a network error releases the claim = retried next run;
//  - the webhook URL, addresses, phones and payloads are never logged (user id + status only).
import { normalizePhoneE164 } from '../phone/e164.js';
import { sbRest } from './webAppServer.js';
import { stampedSiteUrl } from '../ios/siteUrlFor.js';
import { adminShape } from './signupNudges.js';

type Mode = 'live' | 'test';
const enc = encodeURIComponent;
const T = 'web_app_signup_nudges';

export const SHEET_TIMEOUT_MS = 10_000;
export const SHEET_STALE_CLAIM_MS = 30 * 60_000;
export const SHEET_MAX_PER_RUN = 30;
/** A sign-up is looked at only after this long, so the web client has had time to post its price group / save a draft. */
export const SHEET_SETTLE_MS = 15 * 60_000;
/** An account that still has no web signal after this long is an iOS-app (or other) account: closed without a post. */
export const SHEET_NON_WEB_AFTER_MS = 24 * 3600_000;
export const SHEET_MAX_CONSECUTIVE_FAILS = 5;
/** Internal test accounts (ibrahim3709+anything@...) never go to the sheet. */
export const isInternalTest = (email: string | null | undefined) => /^ibrahim3709\+/i.test((email ?? '').trim());

export interface SheetRow { user_id: string; email: string | null; signup_at: string }
export interface SheetDetails { email: string | null; companyName: string; location: string; phone: string; bookingLink: string; priceGroup: 'base' | 'g10' | 'g20' | 'free' }
export interface SheetPayload { companyName: string; location: string; phone: string; bookingLink: string; timestamp: string; email: string; source: string; priceGroup: string; industry: string }

export interface SignupSheetDeps {
  /** Rows with sheet_sent_at null and signup_at >= sinceIso, oldest first. Throws {status:400|404} when the columns are missing. */
  pending(sinceIso: string, limit: number): Promise<SheetRow[]>;
  claim(userId: string, nowIso: string, staleBeforeIso: string): Promise<boolean>;
  release(userId: string, claimedAtIso: string): Promise<void>;
  markSent(userId: string, nowIso: string): Promise<void>;
  details(userId: string): Promise<SheetDetails | null>;
  /** Web-app signal (price group, draft, customer or checkout-session row). iOS-app accounts have none. Throws on error. */
  hasWebSignal(userId: string): Promise<boolean>;
  /** The HTTP status Make answered with; throws on a network error or timeout. */
  post(url: string, payload: SheetPayload): Promise<number>;
  now(): number;
}

export interface SignupSheetSummary { sent: number; failed: number; skipped: number; skippedReason?: 'off' | 'no_since' | 'bad_url' | 'no_columns' }

export function buildPayload(row: SheetRow, d: SheetDetails): SheetPayload {
  return {
    companyName: d.companyName, location: d.location, phone: d.phone, bookingLink: d.bookingLink,
    timestamp: new Date(row.signup_at).toISOString(), email: (d.email ?? row.email ?? '').trim(),
    source: d.priceGroup === 'free' ? 'primebarber.org/free-site' : 'primebarber.org', priceGroup: d.priceGroup, industry: 'barber',
  };
}

export async function sweepSignupSheet(
  deps: SignupSheetDeps,
  opts: { env?: Record<string, string | undefined>; deadlineMs?: number; maxSends?: number } = {},
): Promise<SignupSheetSummary> {
  const env = opts.env ?? process.env;
  const out: SignupSheetSummary = { sent: 0, failed: 0, skipped: 0 };
  const skip = (r: NonNullable<SignupSheetSummary['skippedReason']>) => ({ ...out, skippedReason: r });
  const url = (env.MAKE_SIGNUP_WEBHOOK_URL ?? '').trim();
  if (!url) return skip('off');
  if (!/^https:\/\//i.test(url)) { console.error('[web-app sheet] MAKE_SIGNUP_WEBHOOK_URL is not https'); return skip('bad_url'); }
  const since = Date.parse(env.MAKE_SIGNUP_SINCE ?? '');
  if (!Number.isFinite(since)) return skip('no_since');

  const start = deps.now();
  const deadline = opts.deadlineMs ?? 120_000;
  const maxSends = opts.maxSends ?? SHEET_MAX_PER_RUN;
  const iso = (ms: number) => new Date(ms).toISOString();
  let rows: SheetRow[];
  try { rows = await deps.pending(iso(since), 100); }
  catch (e: any) {
    if (e?.status === 400 || e?.status === 404) { console.error('[web-app sheet] columns missing (migration 035 not applied)'); return skip('no_columns'); }
    throw e;
  }
  let streak = 0;
  for (const row of rows) {
    if (out.sent >= maxSends || deps.now() - start >= deadline || streak >= SHEET_MAX_CONSECUTIVE_FAILS) break;
    if (isInternalTest(row.email)) { out.skipped++; continue; }
    const age = deps.now() - Date.parse(row.signup_at);
    if (!(age >= SHEET_SETTLE_MS)) { out.skipped++; continue; } // too new (or unreadable): the web signal may not exist yet
    try {
      if (!(await deps.hasWebSignal(row.user_id))) {
        out.skipped++;
        // Left pending (a signal can still appear) until 24 h; then closed WITHOUT a post: sheet_sent_at then means "handled".
        if (age >= SHEET_NON_WEB_AFTER_MS) await deps.markSent(row.user_id, iso(deps.now()));
        continue;
      }
    } catch (e: any) { out.failed++; console.error('[web-app sheet] signal check failed', row.user_id, e?.status ?? 'error'); continue; }
    const claimedAt = iso(deps.now());
    let claimed = false;
    try {
      if (!(await deps.claim(row.user_id, claimedAt, iso(deps.now() - SHEET_STALE_CLAIM_MS)))) { out.skipped++; continue; }
      claimed = true;
      const d = await deps.details(row.user_id);
      if (!d) { await deps.release(row.user_id, claimedAt); claimed = false; out.skipped++; continue; } // account gone: nothing to log
      if (isInternalTest(d.email)) { out.skipped++; claimed = false; await deps.markSent(row.user_id, iso(deps.now())); continue; }
      const status = await deps.post(url, buildPayload(row, d));
      if (status >= 200 && status < 300) {
        out.sent++; streak = 0;
        // The post is done: a failure to record it must not release the claim (it expires on its own after 30 min).
        await deps.markSent(row.user_id, iso(deps.now()));
        claimed = false;
        console.info('[web-app sheet] sent', { userId: row.user_id });
      } else {
        out.failed++; streak++;
        console.error('[web-app sheet] webhook answered', status, row.user_id);
        await deps.release(row.user_id, claimedAt); claimed = false;
      }
    } catch (e: any) {
      out.failed++; streak++;
      console.error('[web-app sheet] failed', row.user_id, e?.status ?? e?.name ?? 'error');
      if (claimed) await deps.release(row.user_id, claimedAt).catch(() => {});
    }
  }
  return out;
}

// ---------- phone (same precedence as lib/admin/customers.ts) ----------
function showPhone(raw: string): string {
  const n = normalizePhoneE164(raw);
  if (n.ok) return n.e164;
  if (/^\d{11,15}$/.test(raw.trim())) { const p = normalizePhoneE164('+' + raw.trim()); if (p.ok) return p.e164; } // Supabase stores auth phones without '+'
  return raw;
}
/** First entry that really is a phone (contact, auth, metadata, site, legacy site, draft), E.164. */
export function bestPhone(list: Array<unknown>): string {
  for (const v of list) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const s = showPhone(v);
    if (normalizePhoneE164(s).ok) return s;
  }
  return '';
}

// ---------- live deps ----------
export function liveSignupSheetDeps(mode: Mode, rest: typeof sbRest = sbRest, fetchImpl: typeof fetch = fetch): SignupSheetDeps {
  const row = (uid: string) => `${T}?user_id=eq.${enc(uid)}&environment=eq.${mode}`;
  const soft = async <X>(p: Promise<X>, fallback: X): Promise<X> => { try { return await p; } catch { return fallback; } };
  return {
    async pending(sinceIso, limit) {
      return (await rest(`${T}?environment=eq.${mode}&sheet_sent_at=is.null&signup_at=gte.${enc(sinceIso)}&or=(email.is.null,email.not.ilike.ibrahim3709%2B*)&select=user_id,email,signup_at&order=signup_at.asc&limit=${limit}`)) ?? [];
    },
    async claim(uid, nowIso, staleBeforeIso) {
      const got = await rest(`${row(uid)}&sheet_sent_at=is.null&or=(sheet_claimed_at.is.null,sheet_claimed_at.lt.${enc(staleBeforeIso)})&select=user_id`, { method: 'PATCH', prefer: 'return=representation', body: { sheet_claimed_at: nowIso } });
      return Array.isArray(got) && got.length > 0;
    },
    async release(uid, claimedAtIso) { await rest(`${row(uid)}&sheet_claimed_at=eq.${enc(claimedAtIso)}`, { method: 'PATCH', prefer: 'return=minimal', body: { sheet_claimed_at: null } }); },
    async markSent(uid, nowIso) { await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { sheet_sent_at: nowIso, sheet_claimed_at: null } }); },
    async hasWebSignal(uid) {
      for (const q of [`web_app_price_groups?user_id=eq.${enc(uid)}`, `web_app_drafts?user_id=eq.${enc(uid)}`, `web_app_customers?user_id=eq.${enc(uid)}`, `web_app_checkout_sessions?user_id=eq.${enc(uid)}`]) {
        if (((await rest(`${q}&select=user_id&limit=1`)) ?? []).length > 0) return true;
      }
      return false;
    },
    async details(uid) {
      const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('supabase not configured');
      const r = await fetchImpl(`${url}/auth/v1/admin/users/${enc(uid)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 404) return null;
      if (!r.ok) throw Object.assign(new Error(`admin lookup ${r.status}`), { status: r.status });
      const u: any = await r.json().catch(() => null);
      if (!u || typeof u !== 'object') throw new Error('admin lookup unreadable');
      const meta = u.user_metadata ?? {};
      const [contact, sites, draft, legacy, group] = await Promise.all([
        soft(rest(`customer_contacts?user_id=eq.${enc(uid)}&select=phone_e164&limit=1`), null),
        soft(rest(`web_app_sites?user_id=eq.${enc(uid)}&environment=eq.${mode}&removed_at=is.null&select=slug,contact_phone,published_at,taken_down_at&order=created_at.desc&limit=5`), null),
        soft(rest(`web_app_drafts?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=shop:site_data->>shopName,address:site_data->contact->>address,phone:site_data->>phone&limit=1`), null),
        soft(rest(`sites?user_id=eq.${enc(uid)}&select=phone&limit=1`), null),
        soft(rest(`web_app_price_groups?user_id=eq.${enc(uid)}&select=price_group&limit=1`), null),
      ]);
      const siteRows: any[] = Array.isArray(sites) ? sites : [];
      const live = siteRows.find((s) => s?.published_at && !s?.taken_down_at && typeof s?.slug === 'string');
      const siteUrl = live ? await soft(stampedSiteUrl(live.slug), '') : '';
      const d: any = Array.isArray(draft) ? draft[0] : null;
      const g = Array.isArray(group) ? group[0]?.price_group : null;
      return {
        email: adminShape(u).email,
        companyName: typeof d?.shop === 'string' ? d.shop.trim() : '',
        location: typeof d?.address === 'string' ? d.address.trim() : '',
        phone: bestPhone([Array.isArray(contact) ? contact[0]?.phone_e164 : null, u.phone, meta.phone, meta.phone_number, siteRows.find((s) => s?.contact_phone)?.contact_phone, Array.isArray(legacy) ? legacy[0]?.phone : null, d?.phone]),
        bookingLink: siteUrl || '',
        priceGroup: g === 'g10' || g === 'g20' || g === 'free' ? g : 'base',
      };
    },
    async post(url, payload) {
      const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(SHEET_TIMEOUT_MS) });
      await r.arrayBuffer().catch(() => {}); // drain
      return r.status;
    },
    now: () => Date.now(),
  };
}
