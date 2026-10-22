// Web site owner list (supabase/migrations/013_site_owners.sql): which account owns each WEB
// (Stripe-paid) site. Written only by the server: at the first paid checkout, by the admin
// (comped sites) and by scripts/backfill-site-owners.mjs. App (iOS) sites are not here; their
// owner is ios_purchases.user_id.
//
// One predicate for every "is this the web site's owner?" question (webOwnerDecision): the
// deploy path (lib/deployAuth.ts) uses it now, and the custom-domain owner check
// (authorizeSiteOwner on the custom-domains branch) should call it once the branches meet.
//
// Email claims: a checkout records the buyer's checkout email when the buyer is not signed in
// (or signed in with another email). The first account that signs in with that email claims the
// row, but only with a CONFIRMED email that equals the checkout email exactly (case-insensitive).
// RISK: with Supabase "Confirm email" off, email_confirmed_at is set at sign-up, so whoever
// registers the buyer's address first could claim the site. Turn "Confirm email" on.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { slugify } from './publishSite.js';

export type OwnerSource = 'checkout' | 'admin' | 'backfill';

export interface SiteOwnerRow {
  slug: string;
  user_id: string | null;
  claim_email: string | null;
  source: OwnerSource;
  checkout_session_id: string | null;
  created_at?: string;
  claimed_at?: string | null;
}

/** The signed-in caller, as the auth lookup reports it. */
export interface OwnerUser {
  id: string;
  email: string | null;
  /** auth.users.email_confirmed_at is set. */
  emailConfirmed?: boolean;
}

export interface SiteOwnerStore {
  /** The row for a slug, or null. Throws on an outage. */
  get(slug: string): Promise<SiteOwnerRow | null>;
  /** Insert unless the slug already has a row (first writer wins). True when inserted. */
  insertIfAbsent(row: SiteOwnerRow): Promise<boolean>;
  /** Claim an unclaimed row: where user_id is null and claim_email = email. True when claimed. */
  claim(slug: string, userId: string, email: string, at: string): Promise<boolean>;
  /** Admin: set (or replace) the owner. */
  upsert(row: SiteOwnerRow): Promise<void>;
}

export const normEmail = (e: unknown): string | null => {
  if (typeof e !== 'string') return null;
  const v = e.trim().toLowerCase();
  return v && v.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(v) ? v : null;
};

/** The caller may claim by email: confirmed, and exactly the stored claim email. */
export const canClaim = (row: Pick<SiteOwnerRow, 'user_id' | 'claim_email'>, user: OwnerUser): boolean =>
  !row.user_id && !!row.claim_email && user.emailConfirmed === true && normEmail(user.email) === row.claim_email;

export type OwnerVerdict =
  /** The caller owns it (an owner row with their id, or they just claimed it by email). */
  | 'owner'
  /** Someone else owns it. */
  | 'not-owner'
  /** No owner yet (no row, or an unclaimed row the caller can't claim): callers apply the interim rule. */
  | 'no-owner';

/**
 * Is `user` the owner of web site `slug`? Claims an unclaimed row on the way when the caller's
 * confirmed email is its checkout email. Throws on an outage (callers fail closed).
 *
 * An unclaimed row counts as "no owner yet", not as a lock: customers whose web account uses a
 * different email than the one they paid with keep editing under the interim rule until the
 * admin sets the owner.
 */
export async function webOwnerDecision(slug: string, user: OwnerUser, store: SiteOwnerStore, now: () => number = Date.now): Promise<OwnerVerdict> {
  const s = slugify(slug);
  const row = await store.get(s);
  if (!row) return 'no-owner';
  if (row.user_id) return row.user_id === user.id ? 'owner' : 'not-owner';
  if (canClaim(row, user) && (await store.claim(s, user.id, row.claim_email!, new Date(now()).toISOString()))) {
    console.log(`[SiteOwners] ${s}: claimed by ${user.id} (confirmed checkout email)`);
    return 'owner';
  }
  // Lost a claim race: whoever won is the owner now.
  const again = row.claim_email && canClaim(row, user) ? await store.get(s) : null;
  if (again?.user_id) return again.user_id === user.id ? 'owner' : 'not-owner';
  return 'no-owner';
}

/**
 * Record the owner of a site at its first paid checkout. The signed-in buyer is the owner only
 * when their confirmed email is the checkout email; otherwise the checkout email is stored to be
 * claimed. Never replaces an existing row. Returns what was written (or null).
 */
export async function recordCheckoutOwner(
  slug: string,
  input: { user?: OwnerUser | null; checkoutEmail?: unknown; sessionId?: string | null },
  store: SiteOwnerStore,
): Promise<SiteOwnerRow | null> {
  const s = slugify(slug);
  if (!s) return null;
  const email = normEmail(input.checkoutEmail);
  const u = input.user;
  const userMatches = !!u && u.emailConfirmed === true && !!email && normEmail(u.email) === email;
  const row: SiteOwnerRow = {
    slug: s,
    user_id: userMatches ? u!.id : null,
    claim_email: userMatches ? null : email,
    source: 'checkout',
    checkout_session_id: input.sessionId ?? null,
  };
  if (!row.user_id && !row.claim_email) return null; // nothing to record (no email on the session)
  return (await store.insertIfAbsent(row)) ? row : null;
}

// ─── live store (service role) ───

let sb: SupabaseClient | undefined;
function db(): SupabaseClient {
  if (sb) return sb;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return (sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}

const COLS = 'slug, user_id, claim_email, source, checkout_session_id, created_at, claimed_at';

/**
 * Migration 013 not applied yet (PostgREST: PGRST205 / Postgres 42P01): reads see no owner and
 * writes are skipped, so the deploy path keeps the interim rule instead of failing closed for
 * every web customer. Logged once per instance.
 */
let warnedMissing = false;
function tableMissing(error: { code?: string; message?: string } | null): boolean {
  const missing = !!error && (error.code === 'PGRST205' || error.code === '42P01' || /site_owners/.test(error.message || '') && /does not exist|could not find/i.test(error.message || ''));
  if (missing && !warnedMissing) {
    warnedMissing = true;
    console.warn('[SiteOwners] table site_owners is missing (migration 013 not applied): owner list skipped');
  }
  return missing;
}

export function supabaseSiteOwners(client?: SupabaseClient): SiteOwnerStore {
  const c = () => client ?? db();
  return {
    async get(slug) {
      const { data, error } = await c().from('site_owners').select(COLS).eq('slug', slug).maybeSingle();
      if (tableMissing(error)) return null;
      if (error) throw new Error(`site_owners get failed: ${error.message}`);
      return (data as SiteOwnerRow) ?? null;
    },
    async insertIfAbsent(row) {
      const { data, error } = await c().from('site_owners')
        .upsert({ ...row }, { onConflict: 'slug', ignoreDuplicates: true }).select('slug');
      if (tableMissing(error)) return false;
      if (error) throw new Error(`site_owners insert failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
    async claim(slug, userId, email, at) {
      const { data, error } = await c().from('site_owners')
        .update({ user_id: userId, claimed_at: at, updated_at: at })
        .eq('slug', slug).is('user_id', null).eq('claim_email', email).select('slug');
      if (tableMissing(error)) return false;
      if (error) throw new Error(`site_owners claim failed: ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
    async upsert(row) {
      const { error } = await c().from('site_owners')
        .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'slug' });
      if (error) throw new Error(`site_owners upsert failed: ${error.message}`);
    },
  };
}
