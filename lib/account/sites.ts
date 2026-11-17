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
// Environment vocabulary: 'Production' | 'Sandbox' everywhere here. web_app_* rows carry 'live' | 'test' (kindEnvOf maps).
// `holder` 'web' rows are the only ones ever released or cleaned up: a bound iOS slug is permanent even if never published.
import { sbRest } from '../webApp/webAppServer.js';
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
  /** Delete unpublished WEB rows taken before `beforeIso`. Returns how many went. */
  cleanup(beforeIso: string): Promise<number>;
  /** Re-point the row of (from, slug, holder apple) to `to`. */
  move(from: string, to: string, slug: string): Promise<void>;
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
export async function cleanupUnpublished(now: number, deps: SitesDeps = liveSitesDeps()): Promise<number> {
  return deps.cleanup(new Date(now - UNPUBLISHED_TTL_MS).toISOString());
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

/** Best effort, never throws, no-op with the guard off. */
export async function tryMarkPublishedOnce(uid: string, env: KindEnv, slug: string, mode: GuardMode = guardMode(), deps?: SitesDeps): Promise<void> {
  if (mode === 'off') return;
  try { await markPublishedOnce(uid, env, slug, deps); } catch (e: any) { if (!tableMissing(e)) console.error('[account sites] markPublishedOnce failed:', e?.status ?? e?.message ?? e); }
}

export const envOfMode = (mode: StripeMode): KindEnv => kindEnvOf(mode);

// ---------- live wiring ----------

const enc = encodeURIComponent;
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
    async cleanup(beforeIso) {
      const got = await sbRest(`account_sites?holder=eq.web&published_once=eq.false&taken_at=lt.${enc(beforeIso)}`, { method: 'DELETE', prefer: 'return=representation' });
      return Array.isArray(got) ? got.length : 0;
    },
    async move(from, to, slug) {
      await sbRest(`account_sites?user_id=eq.${enc(from)}&slug=eq.${enc(slug)}&holder=eq.apple`, {
        method: 'PATCH', prefer: 'return=minimal', body: { user_id: to, updated_at: new Date().toISOString() },
      });
    },
  };
}
