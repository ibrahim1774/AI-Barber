// Unpaid sign-up reminders (1 h / 24 h / 72 h after sign-up). Pure sweep logic with injected deps (live deps at the
// bottom); folded into the 10-minute /api/web-app/lapse cron. Rules the code below enforces:
//  - nothing happens unless WEB_APP_NUDGES=1, WEB_APP_NUDGES_SINCE parses, and the secret + Resend key exist;
//  - at most ONE mail per user per sweep, never catching up a missed window, nothing after 7 days, 3 mails max;
//  - exactly-once: an atomic claim, then every check again, then the send with a fixed Idempotency-Key;
//  - Stripe/admin/DB errors never send and never stop a row (the next sweep tries again);
//  - tokens, email addresses and mail bodies are never logged (user id + step only).
import { promises as dns } from 'node:dns';
import { signContinueToken, signUnsubscribeToken } from './nudgeToken.js';
import { isEntitledStatus, WEB_APP_TAG } from './stripeCore.js';
import { APP_ORIGIN, sbRest, stripeCall } from './webAppServer.js';
import { appStoreStateOf, type AppStoreState } from './appStoreGuard.js';
import { sendMail, signupNudgeEmail, type Mail } from './emails.js';
import { isSuppressed } from './suppressions.js';

type Mode = 'live' | 'test';
export type StopReason = 'paid' | 'deleted' | 'suppressed' | 'not_web' | 'live' | 'expired' | 'done' | 'before_launch' | 'bad_address';

export const HOUR = 3600_000;
export const EXPIRY_MS = 7 * 24 * HOUR;
export const BUSY_MS = 30 * 60_000;
export const STALE_CLAIM_MS = 15 * 60_000;
export const MAX_SENDS_PER_SWEEP = 25;
export const PACE_MS = 700;
export const MAX_ENROLL_LOOKUPS = 100;
/** Minimum gap after the previous mail (a second guard on top of the windows). */
const MIN_GAP_MS: Record<2 | 3, number> = { 2: 20 * HOUR, 3: 40 * HOUR };

/**
 * When each step becomes due, in ms after sign-up. Production: 1 h, 24 h, 72 h. WEB_APP_NUDGE_SCHEDULE_MINUTES
 * ("2,5,8") overrides this for staging only and is IGNORED when the Stripe key is live.
 */
export function scheduleMs(mode: Mode, env: Record<string, string | undefined> = process.env): { due: [number, number, number]; overridden: boolean } {
  const std: [number, number, number] = [1 * HOUR, 24 * HOUR, 72 * HOUR];
  const raw = env.WEB_APP_NUDGE_SCHEDULE_MINUTES;
  if (mode === 'live' || !raw) return { due: std, overridden: false };
  const m = raw.split(',').map((x) => Number(x.trim()));
  if (m.length !== 3 || m.some((x) => !Number.isFinite(x) || x <= 0) || !(m[0] < m[1] && m[1] < m[2])) return { due: std, overridden: false };
  return { due: [m[0] * 60_000, m[1] * 60_000, m[2] * 60_000], overridden: true };
}
export const SCHEDULE_MS = scheduleMs;

export interface NudgeRow {
  user_id: string; environment: Mode; signup_at: string; email: string | null;
  step1_sent_at: string | null; step2_sent_at: string | null; step3_sent_at: string | null;
  claimed_step: number | null; claimed_at: string | null;
  stopped_at: string | null; stop_reason: StopReason | null;
}
export interface AdminUser { email: string | null; emailConfirmedAt: string | null; createdAt: string | null; lastSignInAt: string | null; name: string | null }
export interface DraftInfo { updatedAt: string | null; deployedUrl: string | null; shopName: string | null }

export interface SignupNudgeDeps {
  /** User ids with a web draft touched since `sinceIso` in this mode (newest first). */
  recentDrafts(sinceIso: string, limit: number): Promise<string[]>;
  /** Existing nudge rows for these users in this mode. */
  nudgeRows(userIds: string[]): Promise<NudgeRow[]>;
  /** Not-stopped rows, least recently checked first. */
  activeRows(limit: number): Promise<NudgeRow[]>;
  /** Insert-ignore-duplicates. */
  insertRow(row: { user_id: string; signup_at: string; email: string | null; stopped_at?: string; stop_reason?: StopReason }): Promise<void>;
  /** Atomic: true only for the one caller that got the claim (step unsent, not stopped, no fresh claim). */
  claim(userId: string, step: 1 | 2 | 3, nowIso: string, staleBeforeIso: string): Promise<boolean>;
  release(userId: string): Promise<void>;
  markSent(userId: string, step: 1 | 2 | 3, resendId: string, nowIso: string): Promise<void>;
  stop(userId: string, reason: StopReason, nowIso: string): Promise<void>;
  stampChecked(userId: string, nowIso: string): Promise<void>;
  /** null = the account is gone (404). Throws on any other problem. */
  adminUser(userId: string): Promise<AdminUser | null>;
  draftInfo(userId: string): Promise<DraftInfo | null>;
  /** Entitled web_app_entitlements row for this user in ANY environment. Throws on error. */
  isEntitled(userId: string): Promise<boolean>;
  /** Completed Stripe checkout / entitled subscription for this user. Throws on error. */
  stripePaid(email: string, userId: string): Promise<boolean>;
  appStoreState(userId: string): Promise<AppStoreState>;
  hasIosPurchase(userId: string): Promise<boolean>;
  hasLegacySite(userId: string): Promise<boolean>;
  /** A live (published, not removed or taken down) web site for this user. */
  isPublished(userId: string): Promise<boolean>;
  isSuppressed(email: string): Promise<boolean>;
  /** true / false = DNS answered; null = lookup failed (try again later). */
  hasMx(email: string): Promise<boolean | null>;
  send(to: string, mail: Mail, idempotencyKey: string): Promise<string>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface SignupNudgeSummary {
  enrolled: number; sent: number; stopped: number; skipped: number; errors: number;
  skippedReason?: 'off' | 'no_since' | 'misconfigured' | 'no_table';
}

const isMissingTable = (e: any) => e?.status === 404;

export async function sweepSignupNudges(
  deps: SignupNudgeDeps,
  opts: { mode: Mode; env?: Record<string, string | undefined>; deadlineMs?: number; maxSends?: number },
): Promise<SignupNudgeSummary> {
  const env = opts.env ?? process.env;
  const out: SignupNudgeSummary = { enrolled: 0, sent: 0, stopped: 0, skipped: 0, errors: 0 };
  const skip = (r: NonNullable<SignupNudgeSummary['skippedReason']>) => ({ ...out, skippedReason: r });
  if (env.WEB_APP_NUDGES !== '1') return skip('off');
  const since = Date.parse(env.WEB_APP_NUDGES_SINCE ?? '');
  if (!Number.isFinite(since)) return skip('no_since');
  if (!env.WEB_APP_NUDGE_SECRET || !env.RESEND_API_KEY) { console.error('[web-app nudges] misconfigured: secret or Resend key missing'); return skip('misconfigured'); }

  const mode = opts.mode;
  const sched = scheduleMs(mode, env);
  const [d1, d2, d3] = sched.due;
  const start = deps.now();
  const deadline = opts.deadlineMs ?? 200_000;
  const maxSends = opts.maxSends ?? MAX_SENDS_PER_SWEEP;
  const iso = (ms: number) => new Date(ms).toISOString();
  let lastSendAt = 0;

  try {
    // 1. Enrollment: recent drafts without a nudge row get one (stopped at once when before launch or already too old).
    const recent = await deps.recentDrafts(iso(deps.now() - 8 * 24 * HOUR), 200);
    const have = new Set((recent.length ? await deps.nudgeRows(recent) : []).map((r) => r.user_id));
    let lookups = 0;
    for (const uid of recent) {
      if (have.has(uid)) continue;
      if (lookups >= MAX_ENROLL_LOOKUPS || deps.now() - start >= deadline) break;
      lookups++;
      try {
        const u = await deps.adminUser(uid);
        if (!u || !u.createdAt || !Number.isFinite(Date.parse(u.createdAt))) continue; // gone or unreadable: look again next time
        const created = Date.parse(u.createdAt);
        const tooOld = deps.now() - created > EXPIRY_MS;
        const early = created < since;
        await deps.insertRow({ user_id: uid, signup_at: u.createdAt, email: u.email, ...(early || tooOld ? { stopped_at: iso(deps.now()), stop_reason: early ? 'before_launch' : 'expired' } : {}) });
        out.enrolled++;
      } catch (e: any) {
        if (isMissingTable(e)) throw e;
        out.errors++; console.error('[web-app nudges] enroll failed', uid, e?.message || e);
      }
    }

    // 2. Visit active rows, least recently checked first.
    const rows = await deps.activeRows(100);
    for (const row of rows) {
      if (deps.now() - start >= deadline || out.sent >= maxSends) break;
      try {
        await visit(row);
      } catch (e: any) {
        if (isMissingTable(e)) throw e;
        out.errors++; console.error('[web-app nudges] visit failed', row.user_id, e?.message || e);
        await deps.release(row.user_id).catch(() => {});
      }
    }
  } catch (e: any) {
    if (isMissingTable(e)) return skip('no_table');
    out.errors++; console.error('[web-app nudges] sweep failed', e?.message || e);
  }
  return out;

  async function visit(row: NudgeRow) {
    const uid = row.user_id;
    const nowMs = deps.now();
    await deps.stampChecked(uid, iso(nowMs));
    const stop = async (reason: StopReason) => { await deps.stop(uid, reason, iso(deps.now())); out.stopped++; };
    const age = nowMs - Date.parse(row.signup_at);
    if (!Number.isFinite(age)) { out.skipped++; return; }
    if (row.step3_sent_at) return stop('done');
    if (age >= EXPIRY_MS) return stop('expired');
    if (age < d1) { out.skipped++; return; }
    // Only the step whose window is open now; a missed window is skipped for good (no catch-up).
    const step: 1 | 2 | 3 = age < d2 ? 1 : age < d3 ? 2 : 3;
    const sentAt = [row.step1_sent_at, row.step2_sent_at, row.step3_sent_at];
    if (sentAt[step - 1]) { out.skipped++; return; }
    if (step > 1 && !sched.overridden) {
      const prev = sentAt.slice(0, step - 1).filter(Boolean).map((x) => Date.parse(x as string));
      if (prev.length && nowMs - Math.max(...prev) < MIN_GAP_MS[step as 2 | 3]) { out.skipped++; return; }
    }
    if (out.sent > 0 && nowMs - lastSendAt < PACE_MS) await deps.sleep(PACE_MS - (nowMs - lastSendAt));

    // Claim first: two overlapping sweeps can never both send this step.
    if (!(await deps.claim(uid, step, iso(deps.now()), iso(deps.now() - STALE_CLAIM_MS)))) { out.skipped++; return; }
    const back = async () => { await deps.release(uid); out.skipped++; };

    // Everything is checked again now, after the claim and before the send. Any thrown error lands in the caller's
    // catch: the claim is released, nothing is sent and the row is NOT stopped.
    const user = await deps.adminUser(uid);
    if (!user) return stop('deleted');
    const email = user.email?.trim();
    if (!email || !user.emailConfirmedAt) return back();
    const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
    if (!Number.isFinite(created)) return back();
    if (created < since) return stop('before_launch');
    if (deps.now() - created >= EXPIRY_MS) return stop('expired');
    if (await deps.isSuppressed(email)) return stop('suppressed');
    const draft = await deps.draftInfo(uid);
    if (!draft) return back();
    if (draft.deployedUrl || (await deps.isPublished(uid))) return stop('live');
    if ((await deps.appStoreState(uid)) || (await deps.hasIosPurchase(uid)) || (await deps.hasLegacySite(uid))) return stop('not_web');
    if (await deps.isEntitled(uid)) return stop('paid');
    const recentAt = Math.max(draft.updatedAt ? Date.parse(draft.updatedAt) : 0, user.lastSignInAt ? Date.parse(user.lastSignInAt) : 0);
    if (deps.now() - recentAt < BUSY_MS) return back(); // never mail someone mid-edit
    if (!row.step1_sent_at && !row.step2_sent_at && !row.step3_sent_at) {
      const mx = await deps.hasMx(email);
      if (mx === null) return back();
      if (mx === false) return stop('bad_address');
    }
    if (await deps.stripePaid(email, uid)) return stop('paid'); // last check, immediately before the send

    const origin = APP_ORIGIN();
    const t = signContinueToken(uid, step, deps.now(), env.WEB_APP_NUDGE_SECRET);
    const mail = signupNudgeEmail(step, {
      email, firstName: firstNameOf(user.name), shopName: draft.shopName,
      continueUrl: `${origin}/api/web-app/continue?t=${encodeURIComponent(t)}`,
      unsubscribeUrl: `${origin}/api/web-app/unsubscribe?t=${encodeURIComponent(signUnsubscribeToken(email, env.WEB_APP_NUDGE_SECRET))}`,
    });
    let id: string;
    try { id = await deps.send(email, mail, `aibarber-app:nudge:${uid}:${mode}:${step}`); }
    catch (e: any) { await deps.release(uid).catch(() => {}); out.errors++; console.error('[web-app nudges] send failed', uid, step, e?.message || e); return; }
    lastSendAt = deps.now();
    out.sent++;
    await deps.markSent(uid, step, id, iso(lastSendAt));
    console.info('[web-app nudges] sent', { userId: uid, step });
    if (step === 3) await stop('done').catch(() => {});
  }
}

const firstNameOf = (n: string | null) => (n || '').trim().split(/\s+/)[0] || null;

// ---------- live deps ----------
const enc = encodeURIComponent;
const T = 'web_app_signup_nudges';
const COLS = 'user_id,environment,signup_at,email,step1_sent_at,step2_sent_at,step3_sent_at,claimed_step,claimed_at,stopped_at,stop_reason';

export function liveSignupNudgeDeps(mode: Mode, rest: typeof sbRest = sbRest): SignupNudgeDeps {
  const row = (uid: string) => `${T}?user_id=eq.${enc(uid)}&environment=eq.${mode}`;
  const admin = async (uid: string): Promise<AdminUser | null> => {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('supabase not configured');
    const r = await fetch(`${url}/auth/v1/admin/users/${enc(uid)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`admin lookup ${r.status}`);
    const u: any = await r.json().catch(() => null);
    if (!u || typeof u !== 'object') throw new Error('admin lookup unreadable');
    const m = u.user_metadata ?? {};
    return {
      email: typeof u.email === 'string' ? u.email : null, emailConfirmedAt: u.email_confirmed_at ?? u.confirmed_at ?? null,
      createdAt: u.created_at ?? null, lastSignInAt: u.last_sign_in_at ?? null,
      name: m.first_name || m.given_name || m.full_name || m.name || null,
    };
  };
  return {
    async recentDrafts(sinceIso, limit) {
      const r: any[] = (await rest(`web_app_drafts?environment=eq.${mode}&updated_at=gt.${enc(sinceIso)}&select=user_id&order=updated_at.desc&limit=${limit}`)) ?? [];
      return r.map((x) => x.user_id);
    },
    async nudgeRows(ids) {
      return (await rest(`${T}?environment=eq.${mode}&user_id=in.(${ids.map(enc).join(',')})&select=${COLS}`)) ?? [];
    },
    async activeRows(limit) {
      return (await rest(`${T}?environment=eq.${mode}&stopped_at=is.null&select=${COLS}&order=last_checked_at.asc.nullsfirst&limit=${limit}`)) ?? [];
    },
    async insertRow(r) {
      await rest(`${T}?on_conflict=user_id,environment`, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { ...r, environment: mode } });
    },
    async claim(uid, step, nowIso, staleBeforeIso) {
      const got = await rest(`${row(uid)}&step${step}_sent_at=is.null&stopped_at=is.null&or=(claimed_at.is.null,claimed_at.lt.${enc(staleBeforeIso)})`, {
        method: 'PATCH', prefer: 'return=representation', body: { claimed_step: step, claimed_at: nowIso, updated_at: nowIso },
      });
      return Array.isArray(got) && got.length > 0;
    },
    async release(uid) { await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { claimed_step: null, claimed_at: null } }); },
    async markSent(uid, step, id, nowIso) {
      await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { [`step${step}_sent_at`]: nowIso, [`step${step}_resend_id`]: id, claimed_step: null, claimed_at: null, updated_at: nowIso } });
    },
    async stop(uid, reason, nowIso) {
      await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { stopped_at: nowIso, stop_reason: reason, claimed_step: null, claimed_at: null, updated_at: nowIso } });
    },
    async stampChecked(uid, nowIso) { await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { last_checked_at: nowIso } }); },
    adminUser: admin,
    async draftInfo(uid) {
      const d = (await rest(`web_app_drafts?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=updated_at,deployed_url,shop:site_data->>shopName&limit=1`))?.[0];
      return d ? { updatedAt: d.updated_at ?? null, deployedUrl: d.deployed_url ?? null, shopName: d.shop ?? null } : null;
    },
    async isEntitled(uid) {
      const r: any[] = (await rest(`web_app_entitlements?user_id=eq.${enc(uid)}&select=status&limit=20`)) ?? [];
      return r.some((x) => isEntitledStatus(String(x.status)));
    },
    async stripePaid(email, uid) {
      const customers = new Set<string>();
      const subIds = new Set<string>();
      const known: any[] = (await rest(`web_app_customers?user_id=eq.${enc(uid)}&select=stripe_customer_id&limit=5`)) ?? [];
      for (const k of known) if (k.stripe_customer_id) customers.add(k.stripe_customer_id);
      const mine = await stripeCall(`checkout/sessions?customer_details[email]=${enc(email)}&limit=20`, null, 'GET');
      for (const o of mine?.data ?? []) {
        if (o?.metadata?.app !== WEB_APP_TAG || o?.metadata?.user_id !== uid || o.status !== 'complete') continue;
        const c = typeof o.customer === 'string' ? o.customer : o.customer?.id;
        const s = typeof o.subscription === 'string' ? o.subscription : o.subscription?.id;
        if (c) customers.add(c);
        if (s) subIds.add(s);
      }
      for (const s of subIds) {
        const sub = await stripeCall(`subscriptions/${enc(s)}`, null, 'GET');
        if (isEntitledStatus(String(sub?.status))) return true;
      }
      for (const c of customers) {
        const subs = await stripeCall(`subscriptions?customer=${enc(c)}&status=all&limit=20`, null, 'GET');
        if ((subs?.data ?? []).some((x: any) => x?.metadata?.app === WEB_APP_TAG && isEntitledStatus(String(x.status)))) return true;
      }
      return false;
    },
    appStoreState: (uid) => appStoreStateOf(uid, mode),
    async hasIosPurchase(uid) { return ((await rest(`ios_purchases?user_id=eq.${enc(uid)}&select=original_transaction_id&limit=1`)) ?? []).length > 0; },
    async hasLegacySite(uid) { return ((await rest(`sites?user_id=eq.${enc(uid)}&site_data->>source=is.null&select=id&limit=1`)) ?? []).length > 0; },
    async isPublished(uid) { return ((await rest(`web_app_sites?user_id=eq.${enc(uid)}&environment=eq.${mode}&published_at=not.is.null&removed_at=is.null&taken_down_at=is.null&select=slug&limit=1`)) ?? []).length > 0; },
    isSuppressed: (email) => isSuppressed(email),
    async hasMx(email) {
      const domain = email.split('@')[1]?.toLowerCase();
      if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return false;
      const dead = (e: any) => e?.code === 'ENOTFOUND' || e?.code === 'ENODATA';
      try { if ((await dns.resolveMx(domain)).length) return true; } catch (e: any) { if (!dead(e)) return null; }
      for (const f of [dns.resolve4, dns.resolve6]) {
        try { if ((await f(domain)).length) return true; } catch (e: any) { if (!dead(e)) return null; }
      }
      return false;
    },
    send: (to, mail, key) => sendMail(to, mail, fetch, key),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}
