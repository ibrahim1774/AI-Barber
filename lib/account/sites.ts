// The address table (one-account plan, Wave C lane C1; migration 038): one address (slug) per account per environment.
// Both publish paths take the row before they give out an address, so two first publishes at once give one address and a web
// address never sits next to an Apple one. Read lib/account/mayTake.ts for the purchase-link check that uses it.
//
// THE SWITCH: ONE_SITE_GUARD. Unset or any other value = OFF: no function in this file is called by a flow and nothing new is read
// or written (the flows ask guardMode() first). 'alert' = a refusal is recorded and alerted only, never refused. '1' = enforce.
// The code also behaves as OFF when the table is missing (migration 038 not applied): a 404 from PostgREST is "no table".
//   - alert mode: any read error on the table never fails a publish.
//   - '1' mode: a MISSING table behaves as off; any other read error answers 503 (temporarily-unavailable) BEFORE anything is written.
//     Reason: an unreadable table cannot prove the account has no other address, and a first publish that goes through blind is the
//     exact state this guard exists to prevent. A retry is cheap (the barber taps Publish again).
// DEPLOY ORDER (read before switching ONE_SITE_GUARD to 'alert' or '1'): apply migrations 038 (account_sites), 039 (blocked_purchases) and 041
// (maintenance_runs) FIRST, then run scripts/one-account-backfill.ts (dry run, then --apply --yes-production) and the re-count script, THEN set the
// switch. Without 039 a refusal is still decided but nothing is emailed (the alert goes out best effort); without 038 the guard behaves as off;
// without the backfill, accounts that already hold a site have no row (the purchase facts still decide, but two first publishes can race).
// Environment vocabulary: 'Production' | 'Sandbox' everywhere here. web_app_* rows carry 'live' | 'test' (kindEnvOf maps).
// `holder` 'web' rows are the only ones ever released or cleaned up: a bound iOS slug is permanent even if never published.
import { sbRest } from '../webApp/webAppServer.js';
import { alertOwner } from '../webApp/emails.js';
import { reportBlocked } from './blocked.js';
import { kindEnvOf, type KindEnv, type StripeMode } from './kind.js';

export type GuardMode = 'off' | 'alert' | 'enforce';
/** Read per call (tests and env changes apply). '1' = enforce, 'alert' = record and alert only, anything else = off. */
export function guardMode(env: Record<string, string | undefined> = process.env): GuardMode {
  const v = env.ONE_SITE_GUARD;
  return v === '1' ? 'enforce' : v === 'alert' ? 'alert' : 'off';
}

export type Holder = 'web' | 'apple';
export interface AddressRow {
  user_id: string;
  environment: KindEnv;
  slug: string;
  holder: Holder;
  published_once: boolean;
  taken_at?: string;
  updated_at?: string;
}

/** A missing table (migration not applied): PostgREST answers 404. */
export const tableMissing = (e: any): boolean => e?.status === 404;

export interface SitesDeps {
  get(uid: string, env: KindEnv): Promise<AddressRow | null>;
  /** Insert-ignore on (user_id, environment): true when THIS call inserted. A slug held by another account throws {status:409}. */
  insert(row: { user_id: string; environment: KindEnv; slug: string; holder: Holder }): Promise<boolean>;
  markPublishedOnce(uid: string, env: KindEnv, slug: string): Promise<void>;
  /** Delete the account's row when it never published. With `slug`: only that exact row (any holder, the request's own row). Without: holder 'web' only. */
  release(uid: string, env: KindEnv, slug?: string): Promise<void>;
  /**
   * The daily clean-up: rows with published_once=false taken before `beforeIso` (this environment only, when given). A WEB row goes unless its site
   * is published (web_app_sites.published_at; such a row is healed to published_once=true instead). An APPLE row goes only when its slug is bound to
   * no ios_purchases row. Returns how many were deleted.
   */
  cleanup(beforeIso: string, env?: KindEnv, budgetMs?: number): Promise<number>;
  /** Refresh taken_at (a retried first publish re-takes its row: the 24 hour clock starts again). */
  touch(uid: string, env: KindEnv, slug: string): Promise<void>;
  /** Re-point the row of (from, slug, holder apple) to `to`. */
  move(from: string, to: string, slug: string): Promise<void>;
  /** Is this slug held by any account's row? */
  held(slug: string): Promise<boolean>;
}

export type TakeResult =
  | { status: 'ok'; created: boolean; row: AddressRow }
  /** `existing` is the account's row when it holds another address; null when the slug itself is held by another account. */
  | { status: 'refused'; existing: AddressRow | null };

/**
 * Take the account's address. Same row (same slug and holder) = ok, created:false. No row = inserted (created:true).
 * Another row, or the slug held by another account = refused. THROWS on any read or write error (callers apply the mode policy).
 */
export async function takeAddress(uid: string, env: KindEnv, slug: string, holder: Holder, deps: SitesDeps = liveSitesDeps()): Promise<TakeResult> {
  const existing = await deps.get(uid, env);
  if (existing) {
    return existing.slug === slug && existing.holder === holder ? { status: 'ok', created: false, row: existing } : { status: 'refused', existing };
  }
  let inserted: boolean;
  try {
    inserted = await deps.insert({ user_id: uid, environment: env, slug, holder });
  } catch (e: any) {
    if (e?.status !== 409) throw e;
    // 409: the slug belongs to another account's row, or a concurrent request of this account inserted its row first. Decide on a re-read.
    const now = await deps.get(uid, env);
    if (now) return now.slug === slug && now.holder === holder ? { status: 'ok', created: false, row: now } : { status: 'refused', existing: now };
    return { status: 'refused', existing: null };
  }
  if (!inserted) {
    // The primary key was taken between our read and the insert (two first publishes at once): converge on the winner's row.
    const now = await deps.get(uid, env);
    if (!now) throw new Error('account_sites row vanished');
    return now.slug === slug && now.holder === holder ? { status: 'ok', created: false, row: now } : { status: 'refused', existing: now };
  }
  return { status: 'ok', created: true, row: { user_id: uid, environment: env, slug, holder, published_once: false } };
}

/** The first publish succeeded: the row no longer counts as "taken for a publish that may never happen". Idempotent; throws on error. */
export async function markPublishedOnce(uid: string, env: KindEnv, slug: string, deps: SitesDeps = liveSitesDeps()): Promise<void> {
  await deps.markPublishedOnce(uid, env, slug);
}

/** Release the account's WEB row when it never published (job gave up). Throws on error. */
export async function releaseUnpublished(uid: string, env: KindEnv, opts: { slug?: string } = {}, deps: SitesDeps = liveSitesDeps()): Promise<void> {
  await deps.release(uid, env, opts.slug);
}

/** The daily clean-up: unpublished web rows older than 24 hours. */
export const UNPUBLISHED_TTL_MS = 24 * 3600_000;
export async function cleanupUnpublished(now: number, deps: SitesDeps = liveSitesDeps(), env?: KindEnv, budgetMs?: number): Promise<number> {
  return deps.cleanup(new Date(now - UNPUBLISHED_TTL_MS).toISOString(), env, budgetMs);
}

/**
 * Move carries the address row (step d of Move): re-points the Apple row of the slug from the old owner to the new one.
 * NEVER throws and never touches anything else: a missing table, no row, or a conflict (the receiver already has a row) is logged and
 * ignored, so it cannot fail a Move. Runs whether the guard is on or not.
 */
export async function moveAddress(from: string, to: string, slug: string | null, deps: SitesDeps = liveSitesDeps()): Promise<'moved' | 'skipped' | 'error'> {
  if (!slug || from === to) return 'skipped';
  try {
    await deps.move(from, to, slug);
    return 'moved';
  } catch (e: any) {
    if (tableMissing(e)) return 'skipped';
    console.error('[account sites] move: address row not re-pointed (the Move itself went on):', e?.status ?? e?.message ?? e);
    // The owner is told (best effort; never fails the Move): the guard would now be wrong for this slug until it is fixed by hand.
    try { await alertOwner('Prime Barber: Move could not carry the address row', [`from: ${from}`, `to: ${to}`, `slug: ${slug}`, `error: ${e?.status ?? e?.message ?? e}`]); } catch { /* best effort */ }
    return 'error';
  }
}

// ---------- the policy flows use ----------

export type TryTake =
  /** Do exactly what happens today: guard off, table missing, or (alert mode) a read error. Nothing was taken. */
  | { kind: 'skip' }
  | { kind: 'ok'; created: boolean }
  | { kind: 'refused'; existing: AddressRow | null }
  /** Enforce mode and the table could not be read: the caller answers 503 before writing anything. */
  | { kind: 'unavailable' };

/** takeAddress under the mode policy (see the file header). With the guard off nothing is called. */
export async function tryTake(uid: string, env: KindEnv, slug: string, holder: Holder, mode: GuardMode = guardMode(), deps?: SitesDeps): Promise<TryTake> {
  if (mode === 'off') return { kind: 'skip' };
  try {
    const r = await takeAddress(uid, env, slug, holder, deps);
    return r.status === 'ok' ? { kind: 'ok', created: r.created } : { kind: 'refused', existing: r.existing };
  } catch (e: any) {
    if (tableMissing(e)) return { kind: 'skip' };
    console.error('[account sites] address table could not be used:', e?.status ?? e?.message ?? e);
    return mode === 'enforce' ? { kind: 'unavailable' } : { kind: 'skip' };
  }
}

/** Best effort, never throws, never runs with the guard off or for a row this request did not create. */
export async function tryRelease(uid: string, env: KindEnv, slug: string, mode: GuardMode = guardMode(), deps?: SitesDeps): Promise<void> {
  if (mode === 'off') return;
  try { await releaseUnpublished(uid, env, { slug }, deps); } catch (e: any) { if (!tableMissing(e)) console.error('[account sites] release failed:', e?.status ?? e?.message ?? e); }
}

/** A retried first publish keeps its row: refresh taken_at so the 24 hour clean-up clock starts again. Best effort, never throws, no-op with the guard off. */
export async function tryTouch(uid: string, env: KindEnv, slug: string, mode: GuardMode = guardMode(), deps: SitesDeps = liveSitesDeps()): Promise<void> {
  if (mode === 'off') return;
  try { await deps.touch(uid, env, slug); } catch (e: any) { if (!tableMissing(e)) console.error('[account sites] touch failed:', e?.status ?? e?.message ?? e); }
}

/**
 * Best effort, never throws, no-op with the guard off. With `ensure` (web): the live site must have its row, so the row is taken first when
 * a concurrent request released it (a refusal there is ignored; the row of a live site is never removed by a cleaner).
 */
export async function tryMarkPublishedOnce(uid: string, env: KindEnv, slug: string, mode: GuardMode = guardMode(), deps?: SitesDeps, ensure?: Holder): Promise<void> {
  if (mode === 'off') return;
  try {
    await markPublishedOnce(uid, env, slug, deps);
    // Mark first, then make sure the row exists: once published_once is true no release can remove it, and a row that a concurrent request
    // released before the mark is taken again here and marked.
    if (ensure) {
      const again = await takeAddress(uid, env, slug, ensure, deps);
      if (again.status === 'ok' && again.created) await markPublishedOnce(uid, env, slug, deps);
      // A site that just went live while the account's row belongs to the OTHER side (an Apple first publish got there first): two sites. Never silent:
      // recorded as `mixed` and the owner is alerted (no barber email), whatever the mode.
      if (again.status === 'refused' && again.existing && again.existing.holder !== ensure) {
        await reportBlocked({ otid: `${ensure === 'web' ? 'web-publish' : 'apple-publish'}:${again.existing.slug}`, uid, reason: 'mixed', slug: again.existing.slug, environment: null, email: false, where: `${ensure} publish went live while the account's row is ${again.existing.holder}` });
      }
    }
  } catch (e: any) { if (!tableMissing(e)) console.error('[account sites] markPublishedOnce failed:', e?.status ?? e?.message ?? e); }
}

/**
 * isTaken for chooseSlug with the guard on: a slug held by any account_sites row counts as taken, so a candidate that another account's row holds is never
 * chosen again (chooseSlug is deterministic). Off: the function itself. A missing table, or any read error in alert mode: not held (as today).
 */
export function withAddressTaken(isTaken: (slug: string) => Promise<boolean>, mode: GuardMode = guardMode(), deps?: SitesDeps): (slug: string) => Promise<boolean> {
  if (mode === 'off') return isTaken;
  return async (slug) => {
    if (await isTaken(slug)) return true;
    try { return await (deps ?? liveSitesDeps()).held(slug); }
    catch (e: any) { if (tableMissing(e) || mode === 'alert') return false; throw e; }
  };
}

export const envOfMode = (mode: StripeMode): KindEnv => kindEnvOf(mode);

// ---------- live wiring ----------

const enc = encodeURIComponent;
const CLEANUP_BATCH = 100;
type CleanRow = { user_id: string; environment: KindEnv; slug: string; holder: Holder };
/** One candidate of the daily clean-up: 'healed' (a live web site: published_once set, row kept), 'kept' (a bound Apple slug), or 'deleted'. */
async function cleanOne(r: CleanRow): Promise<'deleted' | 'healed' | 'kept'> {
  if (r.holder === 'web') {
    const pub = (await sbRest(`web_app_sites?slug=eq.${enc(r.slug)}&published_at=not.is.null&select=slug&limit=1`)) ?? [];
    if (pub.length) {
      await sbRest(`account_sites?user_id=eq.${enc(r.user_id)}&environment=eq.${r.environment}&slug=eq.${enc(r.slug)}`, { method: 'PATCH', prefer: 'return=minimal', body: { published_once: true, updated_at: new Date().toISOString() } });
      return 'healed';
    }
  } else {
    const bound = (await sbRest(`ios_purchases?site_slug=eq.${enc(r.slug)}&select=original_transaction_id&limit=1`)) ?? [];
    if (bound.length) return 'kept'; // a bound iOS slug is permanent
  }
  await sbRest(`account_sites?user_id=eq.${enc(r.user_id)}&environment=eq.${r.environment}&slug=eq.${enc(r.slug)}&published_once=eq.false`, { method: 'DELETE', prefer: 'return=minimal' });
  return 'deleted';
}
const COLS = 'user_id,environment,slug,holder,published_once,taken_at,updated_at';

export function liveSitesDeps(): SitesDeps {
  return {
    async get(uid, env) {
      return ((await sbRest(`account_sites?user_id=eq.${enc(uid)}&environment=eq.${env}&select=${COLS}&limit=1`)) ?? [])[0] ?? null;
    },
    async insert(row) {
      const got = await sbRest('account_sites?on_conflict=user_id,environment', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: row });
      return Array.isArray(got) && got.length > 0;
    },
    async markPublishedOnce(uid, env, slug) {
      await sbRest(`account_sites?user_id=eq.${enc(uid)}&environment=eq.${env}&slug=eq.${enc(slug)}&published_once=eq.false`, {
        method: 'PATCH', prefer: 'return=minimal', body: { published_once: true, updated_at: new Date().toISOString() },
      });
    },
    async release(uid, env, slug) {
      const where = slug ? `&slug=eq.${enc(slug)}` : '&holder=eq.web';
      await sbRest(`account_sites?user_id=eq.${enc(uid)}&environment=eq.${env}&published_once=eq.false${where}`, { method: 'DELETE', prefer: 'return=minimal' });
    },
    async held(slug) {
      return ((await sbRest(`account_sites?slug=eq.${enc(slug)}&select=slug&limit=1`)) ?? []).length > 0;
    },
    async touch(uid, env, slug) {
      await sbRest(`account_sites?user_id=eq.${enc(uid)}&environment=eq.${env}&slug=eq.${enc(slug)}&published_once=eq.false`, { method: 'PATCH', prefer: 'return=minimal', body: { taken_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    },
    async cleanup(beforeIso, env, budgetMs = 60_000) {
      // Batches of CLEANUP_BATCH, oldest first, within a time budget (the lapse function has 300 s and real work to do). A row that is KEPT (a bound,
      // unpublished Apple row) stays in the filter, so the next page starts past the kept ones: they never starve the rest. Healed and deleted rows leave the filter.
      const deadline = Date.now() + budgetMs;
      let n = 0, skipped = 0;
      while (Date.now() < deadline) {
        const rows: { user_id: string; environment: KindEnv; slug: string; holder: Holder }[] =
          (await sbRest(`account_sites?published_once=eq.false&taken_at=lt.${enc(beforeIso)}${env ? `&environment=eq.${env}` : ''}&select=user_id,environment,slug,holder&order=taken_at.asc&limit=${CLEANUP_BATCH}&offset=${skipped}`)) ?? [];
        if (!rows.length) break;
        const before = skipped;
        for (const r of rows) {
          if (Date.now() >= deadline) return n;
          const out = await cleanOne(r);
          if (out === 'deleted') n++; else if (out === 'kept') skipped++;
        }
        if (rows.length < CLEANUP_BATCH) break;
        if (skipped === before && n === 0) break; // a full page of healed rows leaves the filter; nothing else to page past
      }
      return n;
    },
    async move(from, to, slug) {
      await sbRest(`account_sites?user_id=eq.${enc(from)}&slug=eq.${enc(slug)}&holder=eq.apple`, {
        method: 'PATCH', prefer: 'return=minimal', body: { user_id: to, updated_at: new Date().toISOString() },
      });
    },
  };
}
