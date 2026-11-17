// iOS customer emails: the flows (welcome, "not live yet" sweep, Apple billing notices) with injected deps; live deps at the bottom.
// Each email has its own switch (OFF unless "1"): IOS_EMAIL_WELCOME, IOS_EMAIL_NOT_LIVE (+ IOS_EMAIL_NOT_LIVE_SINCE), IOS_EMAIL_BILLING.
// With a switch off a flow returns before reading or writing anything. A missing table (migration 037 not applied) behaves as off.
// Every entry point swallows its own errors: an email problem must never change a signup or an Apple notification answer.
// Sandbox purchases (App Review, TestFlight) never get any of these emails. Logs carry user ids and kinds, never addresses or bodies.
import { isInternalTestEmail, liveSignupNudgeDeps, resendWhy, type AdminUser } from '../webApp/signupNudges.js';
import { sbRest } from '../webApp/webAppServer.js';
import { sendMail, type Mail } from '../webApp/emails.js';
import { isSuppressed } from '../webApp/suppressions.js';
import { isLapsed } from './lapse.js';
import { iosBillingEmail, iosEmailOn, iosNotLiveEmail, iosWelcomeEmail, type BillingKind } from './emails.js';

export const HOUR = 3600_000;
export const NOT_LIVE_DUE_MS: [number, number] = [24 * HOUR, 72 * HOUR];
export const NOT_LIVE_EXPIRY_MS = 7 * 24 * HOUR;
export const NOT_LIVE_MIN_GAP_MS = 20 * HOUR;
export const STALE_CLAIM_MS = 15 * 60_000;
export const PACE_MS = 700;

export type StopReason = 'live' | 'lapsed' | 'refunded' | 'removed' | 'moved' | 'deleted' | 'suppressed' | 'sandbox' | 'expired' | 'done' | 'late' | 'before_launch';

export interface AccountRow {
  user_id: string; original_transaction_id: string; signup_at: string;
  welcome_sent_at: string | null; step1_sent_at: string | null; step2_sent_at: string | null;
  claimed_step: number | null; claimed_at: string | null; stopped_at: string | null; stop_reason: StopReason | null;
}
export interface PurchaseLite {
  original_transaction_id: string; product_id: string | null; environment: string | null; site_slug: string | null; user_id: string | null;
  expires_at: string | null; revoked_at: string | null; published_at: string | null; taken_down_at: string | null; removed_at: string | null;
}
export interface BillingKey { otid: string; kind: BillingKind; period: string }

export interface IosEmailDeps {
  env: Record<string, string | undefined>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Insert-ignore-duplicates; true when THIS call created the row. Throws {status:404} while the table is missing. */
  insertAccount(row: { user_id: string; original_transaction_id: string; signup_at: string }): Promise<boolean>;
  markWelcome(userId: string, resendId: string, nowIso: string): Promise<void>;
  activeRows(limit: number): Promise<AccountRow[]>;
  /** Atomic: the claimed row for the one caller that got the claim, else null. */
  claim(userId: string, step: 1 | 2, nowIso: string, staleBeforeIso: string): Promise<AccountRow | null>;
  release(userId: string, claimedAtIso: string): Promise<void>;
  markSent(userId: string, step: 1 | 2, resendId: string, nowIso: string): Promise<void>;
  stop(userId: string, reason: StopReason, nowIso: string): Promise<void>;
  stampChecked(userId: string, nowIso: string): Promise<void>;
  /** null = the account is gone. Throws on any other problem. */
  adminUser(userId: string): Promise<AdminUser | null>;
  purchase(otid: string): Promise<PurchaseLite | null>;
  /** The account has any purchase with a live (published, not removed) site. */
  hasPublishedSite(userId: string): Promise<boolean>;
  isSuppressed(email: string): Promise<boolean>;
  /** The address to show for a slug. */
  siteUrl(slug: string): Promise<string>;
  send(to: string, mail: Mail, idempotencyKey: string): Promise<string>;
  /** Insert-ignore-duplicates on (otid, kind, period): true only for the caller that created the row. */
  claimBilling(k: BillingKey, userId: string): Promise<boolean>;
  markBilling(k: BillingKey, resendId: string, nowIso: string): Promise<void>;
  releaseBilling(k: BillingKey): Promise<void>;
}

const missing = (e: any) => e?.status === 404;
const firstNameOf = (n: string | null | undefined) => (n || '').trim().split(/\s+/)[0] || null;
const errTag = (e: any): string => String(e?.status ?? e?.code ?? e?.type ?? (/^(resend|supabase|admin lookup) \d{3}$/.test(e?.message ?? '') ? e.message : 'error'));

// ---------- 1. Welcome (and the state row both account emails share) ----------

export interface AccountCreated { userId: string; email: string; name?: string | null; originalTransactionId: string; environment: 'Production' | 'Sandbox' }
export type WelcomeResult = 'off' | 'sandbox' | 'no_table' | 'exists' | 'suppressed' | 'sent' | 'error';

/** Called after /api/ios/signup created the account. Never throws. Sends the welcome at most once per account (the state row is the once-only key). */
export async function onAccountCreated(deps: IosEmailDeps, a: AccountCreated): Promise<WelcomeResult> {
  const welcomeOn = iosEmailOn('IOS_EMAIL_WELCOME', deps.env);
  const notLiveOn = iosEmailOn('IOS_EMAIL_NOT_LIVE', deps.env);
  if (!welcomeOn && !notLiveOn) return 'off';
  if (a.environment !== 'Production') return 'sandbox';
  try {
    const created = await deps.insertAccount({ user_id: a.userId, original_transaction_id: a.originalTransactionId, signup_at: new Date(deps.now()).toISOString() });
    if (!welcomeOn) return 'off';
    if (!created) return 'exists';
    if (isInternalTestEmail(a.email) || (await deps.isSuppressed(a.email))) return 'suppressed';
    // If the first publish has already finished (claim-start sites are published before the account exists), name the live address.
    let siteUrl: string | null = null;
    try {
      const p = await deps.purchase(a.originalTransactionId);
      if (p?.site_slug && p.published_at && !p.removed_at && !p.taken_down_at && !p.revoked_at && (p.user_id == null || p.user_id === a.userId)) siteUrl = await deps.siteUrl(p.site_slug);
    } catch { /* no address: the "being set up" wording is still true */ }
    const id = await deps.send(a.email, iosWelcomeEmail({ firstName: firstNameOf(a.name), siteUrl }), `aibarber-ios:welcome:${a.userId}`);
    await deps.markWelcome(a.userId, id, new Date(deps.now()).toISOString()).catch(() => {});
    console.info('[ios email] welcome sent', { userId: a.userId });
    return 'sent';
  } catch (e: any) {
    if (missing(e)) return 'no_table';
    console.error('[ios email] welcome failed', a.userId, errTag(e), resendWhy(e));
    return 'error';
  }
}

// ---------- 2. "Your website isn't live yet" sweep ----------

export interface NotLiveSummary { sent: number; stopped: number; skipped: number; errors: number; skippedReason?: 'off' | 'no_since' | 'misconfigured' | 'no_table' }

export async function sweepIosNotLive(deps: IosEmailDeps, opts: { deadlineMs?: number; maxSends?: number } = {}): Promise<NotLiveSummary> {
  const out: NotLiveSummary = { sent: 0, stopped: 0, skipped: 0, errors: 0 };
  const skip = (r: NonNullable<NotLiveSummary['skippedReason']>) => ({ ...out, skippedReason: r });
  const env = deps.env;
  if (!iosEmailOn('IOS_EMAIL_NOT_LIVE', env)) return skip('off');
  const since = Date.parse(env.IOS_EMAIL_NOT_LIVE_SINCE ?? '');
  if (!Number.isFinite(since)) return skip('no_since');
  if (!env.RESEND_API_KEY) { console.error('[ios email] not-live misconfigured: Resend key missing'); return skip('misconfigured'); }
  const start = deps.now();
  const deadline = opts.deadlineMs ?? 60_000;
  const maxSends = opts.maxSends ?? 10;
  const iso = (ms: number) => new Date(ms).toISOString();
  let lastSendAt = 0;
  try {
    for (const row of await deps.activeRows(100)) {
      if (deps.now() - start >= deadline || out.sent >= maxSends) break;
      const ctx: { claimedAt: string | null } = { claimedAt: null };
      try { await visit(row, ctx); }
      catch (e: any) {
        if (missing(e)) throw e;
        out.errors++; console.error('[ios email] not-live visit failed', row.user_id, errTag(e));
        if (ctx.claimedAt) await deps.release(row.user_id, ctx.claimedAt).catch(() => {});
      }
    }
  } catch (e: any) {
    if (missing(e)) return skip('no_table');
    out.errors++; console.error('[ios email] not-live sweep failed', errTag(e));
  }
  return out;

  async function visit(row: AccountRow, ctx: { claimedAt: string | null }) {
    const uid = row.user_id;
    await deps.stampChecked(uid, iso(deps.now()));
    const stop = async (r: StopReason) => { await deps.stop(uid, r, iso(deps.now())); out.stopped++; };
    const signupMs = Date.parse(row.signup_at);
    if (!Number.isFinite(signupMs)) { out.skipped++; return; }
    const age = deps.now() - signupMs;
    if (row.step2_sent_at) return stop('done');
    if (signupMs < since) return stop('before_launch'); // launch-date gate: turning the switch on never mails a backlog
    if (age >= NOT_LIVE_EXPIRY_MS) return stop('expired');
    if (age < NOT_LIVE_DUE_MS[0]) { out.skipped++; return; }
    const step: 1 | 2 = age < NOT_LIVE_DUE_MS[1] ? 1 : 2; // only the open window; a missed one is never made up
    if (step === 1 ? row.step1_sent_at : row.step2_sent_at) { out.skipped++; return; }
    if (step === 2 && !row.step1_sent_at) return stop('late');
    const gapBlocks = (r: AccountRow, at: number) => step === 2 && !!r.step1_sent_at && at - Date.parse(r.step1_sent_at) < NOT_LIVE_MIN_GAP_MS;
    if (gapBlocks(row, deps.now())) { out.skipped++; return; }
    if (out.sent > 0 && deps.now() - lastSendAt < PACE_MS) await deps.sleep(PACE_MS - (deps.now() - lastSendAt));

    const claimedAtIso = iso(deps.now());
    const claimed = await deps.claim(uid, step, claimedAtIso, iso(deps.now() - STALE_CLAIM_MS));
    if (!claimed) { out.skipped++; return; }
    ctx.claimedAt = claimedAtIso;
    const back = async () => { await deps.release(uid, claimedAtIso); ctx.claimedAt = null; out.skipped++; };
    if (claimed.step2_sent_at) { await stop('done'); ctx.claimedAt = null; return; }
    if ((step === 1 ? claimed.step1_sent_at : claimed.step2_sent_at) || gapBlocks(claimed, deps.now())) return back();

    // Every stop condition is checked again now, after the claim and right before the send.
    const user = await deps.adminUser(uid);
    if (!user) { await stop('deleted'); ctx.claimedAt = null; return; }
    const email = user.email?.trim();
    if (!email) return back();
    if (isInternalTestEmail(email) || (await deps.isSuppressed(email))) { await stop('suppressed'); ctx.claimedAt = null; return; }
    const p = await deps.purchase(row.original_transaction_id);
    if (!p) return back(); // cannot tell yet: hold
    const stopNow = async (r: StopReason) => { await stop(r); ctx.claimedAt = null; };
    if (p.environment !== 'Production') return stopNow('sandbox');
    if (p.revoked_at) return stopNow('refunded');
    if (p.removed_at) return stopNow('removed');
    if (p.taken_down_at || isLapsed({ expires_at: p.expires_at, revoked_at: p.revoked_at }, deps.now())) return stopNow('lapsed');
    if (p.user_id && p.user_id !== uid) return stopNow('moved');
    if (p.published_at || (await deps.hasPublishedSite(uid))) return stopNow('live');

    let id: string;
    try { id = await deps.send(email, iosNotLiveEmail(step, { firstName: firstNameOf(user.name) }), `aibarber-ios:not-live:${uid}:${step}`); }
    catch (e: any) { await deps.release(uid, claimedAtIso).catch(() => {}); ctx.claimedAt = null; out.errors++; console.error('[ios email] not-live send failed', uid, step, errTag(e), resendWhy(e)); return; }
    lastSendAt = deps.now();
    out.sent++;
    await deps.markSent(uid, step, id, iso(lastSendAt));
    console.info('[ios email] not-live sent', { userId: uid, step });
    if (step === 2) await stop('done').catch(() => {});
  }
}

// ---------- 3. Payment problem / subscription ended (App Store Server Notifications) ----------

export interface SubscriptionNotice { otid: string; type: string; subtype?: string; environment: 'Production' | 'Sandbox'; expiresAt: number | null }
export type BillingResult = 'off' | 'ignored' | 'sandbox' | 'no_purchase' | 'no_user' | 'suppressed' | 'no_table' | 'duplicate' | 'sent' | 'error';

/**
 * Once-only key: (original transaction id, kind, billing period) where kind is renewal_failed (DID_FAIL_TO_RENEW with or
 * without a grace period: one mail for both) or expired (EXPIRED), and period is the transaction's expiresDate in ms
 * (the period that failed to renew / ended; the same on every retry within that period).
 */
export const billingKeyOf = (n: SubscriptionNotice): BillingKey | null => {
  const kind: BillingKind | null = n.type === 'DID_FAIL_TO_RENEW' ? 'renewal_failed' : n.type === 'EXPIRED' ? 'expired' : null;
  return kind ? { otid: n.otid, kind, period: n.expiresAt != null ? String(n.expiresAt) : 'na' } : null;
};

/** Never throws. */
export async function onSubscriptionNotice(deps: IosEmailDeps, n: SubscriptionNotice): Promise<BillingResult> {
  const key = billingKeyOf(n);
  if (!key || !iosEmailOn('IOS_EMAIL_BILLING', deps.env)) return key ? 'off' : 'ignored';
  if (n.environment !== 'Production') return 'sandbox';
  let claimed = false;
  try {
    const p = await deps.purchase(n.otid);
    if (!p) return 'no_purchase';
    if (p.environment !== 'Production') return 'sandbox';
    if (p.revoked_at) return 'no_purchase'; // refunded: a payment notice makes no sense
    if (!p.user_id) return 'no_user'; // paid but never made an account: no address
    const user = await deps.adminUser(p.user_id);
    const email = user?.email?.trim();
    if (!user || !email) return 'no_user';
    if (isInternalTestEmail(email) || (await deps.isSuppressed(email))) return 'suppressed';
    if (!(await deps.claimBilling(key, p.user_id))) return 'duplicate';
    claimed = true;
    const mail = iosBillingEmail(key.kind, { firstName: firstNameOf(user.name), graceKept: n.subtype === 'GRACE_PERIOD' });
    const id = await deps.send(email, mail, `aibarber-ios:billing:${key.otid}:${key.kind}:${key.period}`);
    await deps.markBilling(key, id, new Date(deps.now()).toISOString()).catch(() => {});
    console.info('[ios email] billing sent', { kind: key.kind });
    return 'sent';
  } catch (e: any) {
    if (missing(e)) return 'no_table';
    console.error('[ios email] billing failed', key.kind, errTag(e), resendWhy(e));
    // The send failed: give the claim back so a later notice for the same period can still send once.
    if (claimed) await deps.releaseBilling(key).catch(() => {});
    return 'error';
  }
}

// ---------- live deps ----------

const enc = encodeURIComponent;
const T = 'ios_account_emails';
const ACOLS = 'user_id,original_transaction_id,signup_at,welcome_sent_at,step1_sent_at,step2_sent_at,claimed_step,claimed_at,stopped_at,stop_reason';
const PCOLS = 'original_transaction_id,product_id,environment,site_slug,user_id,expires_at,revoked_at,published_at,taken_down_at,removed_at';

export function liveIosEmailDeps(rest: typeof sbRest = sbRest, env: Record<string, string | undefined> = process.env): IosEmailDeps {
  const row = (uid: string) => `${T}?user_id=eq.${enc(uid)}`;
  const bill = (k: BillingKey) => `ios_billing_emails?original_transaction_id=eq.${enc(k.otid)}&kind=eq.${k.kind}&period_key=eq.${enc(k.period)}`;
  return {
    env,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async insertAccount(r) {
      const got = await rest(`${T}?on_conflict=user_id`, { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: r });
      return Array.isArray(got) && got.length > 0;
    },
    async markWelcome(uid, id, nowIso) { await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { welcome_sent_at: nowIso, welcome_resend_id: id, updated_at: nowIso } }); },
    async activeRows(limit) { return (await rest(`${T}?stopped_at=is.null&select=${ACOLS}&order=last_checked_at.asc.nullsfirst&limit=${limit}`)) ?? []; },
    async claim(uid, step, nowIso, staleBeforeIso) {
      const got = await rest(`${row(uid)}&step${step}_sent_at=is.null&stopped_at=is.null&or=(claimed_at.is.null,claimed_at.lt.${enc(staleBeforeIso)})&select=${ACOLS}`, {
        method: 'PATCH', prefer: 'return=representation', body: { claimed_step: step, claimed_at: nowIso, updated_at: nowIso },
      });
      return Array.isArray(got) && got.length > 0 ? (got[0] as AccountRow) : null;
    },
    async release(uid, claimedAtIso) { await rest(`${row(uid)}&claimed_at=eq.${enc(claimedAtIso)}`, { method: 'PATCH', prefer: 'return=minimal', body: { claimed_step: null, claimed_at: null } }); },
    async markSent(uid, step, id, nowIso) {
      await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { [`step${step}_sent_at`]: nowIso, [`step${step}_resend_id`]: id, claimed_step: null, claimed_at: null, updated_at: nowIso } });
    },
    async stop(uid, reason, nowIso) { await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { stopped_at: nowIso, stop_reason: reason, claimed_step: null, claimed_at: null, updated_at: nowIso } }); },
    async stampChecked(uid, nowIso) { await rest(row(uid), { method: 'PATCH', prefer: 'return=minimal', body: { last_checked_at: nowIso } }); },
    adminUser: (uid) => liveSignupNudgeDeps('live', rest).adminUser(uid),
    async purchase(otid) { return (await rest(`ios_purchases?original_transaction_id=eq.${enc(otid)}&select=${PCOLS}&limit=1`))?.[0] ?? null; },
    async hasPublishedSite(uid) { return ((await rest(`ios_purchases?user_id=eq.${enc(uid)}&published_at=not.is.null&removed_at=is.null&select=original_transaction_id&limit=1`)) ?? []).length > 0; },
    isSuppressed: (email) => isSuppressed(email, rest),
    async siteUrl(slug) { return (await import('./siteUrlFor.js')).stampedSiteUrl(slug); },
    send: (to, mail, key) => sendMail(to, mail, fetch, key),
    async claimBilling(k, userId) {
      const got = await rest('ios_billing_emails?on_conflict=original_transaction_id,kind,period_key', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
        body: { original_transaction_id: k.otid, kind: k.kind, period_key: k.period, user_id: userId },
      });
      return Array.isArray(got) && got.length > 0;
    },
    async markBilling(k, id, nowIso) { await rest(bill(k), { method: 'PATCH', prefer: 'return=minimal', body: { sent_at: nowIso, resend_id: id } }); },
    async releaseBilling(k) { await rest(`${bill(k)}&sent_at=is.null`, { method: 'DELETE', prefer: 'return=minimal' }); },
  };
}
