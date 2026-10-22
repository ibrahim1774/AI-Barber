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
  /** The owner account's email when user_id is set (013: becomes the claim email if that account is deleted). */
  owner_email?: string | null;
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
    owner_email: userMatches ? email : null,
    source: 'checkout',
    checkout_session_id: input.sessionId ?? null,
  };
  if (!row.user_id && !row.claim_email) return null; // nothing to record (no email on the session)
  return (await store.insertIfAbsent(row)) ? row : null;
}

/**
 * The Stripe webhook's write: record the checkout owner only when the slug is not live yet (no
 * server stamp on the stored copy, no Vercel project). Until the backfill runs, an existing
 * site has no owner row, so without this a paid checkout naming someone else's live slug would
 * store the payer's email, which they could claim to lock the real owner out. A lookup error
 * records nothing (the deploy path or the admin can set it later).
 */
export async function recordCheckoutOwnerIfFirst(
  slug: string,
  input: { checkoutEmail?: unknown; sessionId?: string | null },
  store: SiteOwnerStore,
  live: { storedStamp(slug: string): Promise<string | null>; projectExists(slug: string): Promise<boolean> },
): Promise<SiteOwnerRow | null> {
  const s = slugify(slug);
  if (!s) return null;
  try {
    if ((await live.storedStamp(s)) || (await live.projectExists(s))) {
      console.log(`[SiteOwners] ${s}: already live before this checkout; no owner recorded from it`);
      return null;
    }
  } catch (e: any) {
    console.warn(`[SiteOwners] ${s}: first-publish check failed; no owner recorded:`, e?.message || e);
    return null;
  }
  return recordCheckoutOwner(s, input, store);
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

const COLS = 'slug, user_id, claim_email, owner_email, source, checkout_session_id, created_at, claimed_at';

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
        .update({ user_id: userId, owner_email: email, claim_email: null, claimed_at: at, updated_at: at })
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

// ─── admin (comped sites): /api/admin/sites actions web-owner / set-web-owner, CLI ───

export interface WebOwnerAdminDeps {
  store: SiteOwnerStore;
  /** Is this slug an iOS app site (ios_purchases.site_slug)? Their owner is not kept here. */
  isAppSlug(slug: string): Promise<boolean>;
  /** The Supabase account with this email, or null. */
  userByEmail(email: string): Promise<{ id: string; email: string; emailConfirmed: boolean } | null>;
  /** The account's email, or null. */
  emailOf(userId: string): Promise<string | null>;
  audit?(e: { action: 'set-web-owner'; slug: string; by?: string; userId: string | null; claimEmail: string | null; previous: SiteOwnerRow | null }): Promise<void>;
  now(): number;
}

export interface WebOwnerView {
  ok: boolean;
  error?: 'bad-request' | 'app-site';
  detail?: string;
  slug?: string;
  owner?: { userId: string | null; email: string | null; claimEmail: string | null; source: OwnerSource; since: string | null } | null;
}

export async function getWebOwner(slug: unknown, deps: WebOwnerAdminDeps): Promise<WebOwnerView> {
  const s = slugify(String(slug ?? ''));
  if (!s) return { ok: false, error: 'bad-request', detail: 'slug required' };
  const row = await deps.store.get(s);
  if (!row) return { ok: true, slug: s, owner: null };
  return {
    ok: true, slug: s,
    owner: {
      userId: row.user_id, email: row.user_id ? await deps.emailOf(row.user_id) : null, claimEmail: row.claim_email,
      source: row.source, since: row.claimed_at ?? row.created_at ?? null,
    },
  };
}

/**
 * Admin: set (or replace) a web site's owner by email, e.g. a comped site with no checkout. An
 * existing account with that email becomes the owner at once; otherwise the email is stored and
 * claimed when that person signs in with a confirmed email. Refuses app (iOS) slugs.
 */
export async function setWebOwner(slug: unknown, email: unknown, deps: WebOwnerAdminDeps, by?: string): Promise<WebOwnerView> {
  const s = slugify(String(slug ?? ''));
  const e = normEmail(email);
  if (!s) return { ok: false, error: 'bad-request', detail: 'slug required' };
  if (!e) return { ok: false, error: 'bad-request', detail: 'a valid email is required' };
  if (await deps.isAppSlug(s)) return { ok: false, error: 'app-site', detail: 'an iOS app site: its owner is the App Store purchase\'s account' };
  const previous = await deps.store.get(s);
  const found = await deps.userByEmail(e);
  // Review fix round 1 (finding 4): only a CONFIRMED account owns at once. An unconfirmed one may
  // be a squatter who pre-registered the barber's address: store the email to be claimed at a
  // confirmed sign-in instead, like the backfill.
  const user = found?.emailConfirmed ? found : null;
  const row: SiteOwnerRow = {
    slug: s, user_id: user?.id ?? null, claim_email: user ? null : e, owner_email: user ? e : null, source: 'admin', checkout_session_id: null,
    claimed_at: user ? new Date(deps.now()).toISOString() : null,
  };
  await deps.store.upsert(row);
  await deps.audit?.({ action: 'set-web-owner', slug: s, by, userId: row.user_id, claimEmail: row.claim_email, previous })
    .catch((err: any) => console.warn('[SiteOwners] audit write failed (ignored):', err?.message || err));
  console.log(`[SiteOwners] ${s}: owner set by ${by || 'admin'} (${user ? 'existing account' : found ? 'unconfirmed account: email to claim' : 'email to claim'})`);
  const view = await getWebOwner(s, deps);
  return found && !user ? { ...view, detail: 'that account has not confirmed its email: it owns the site once it signs in with the email confirmed' } : view;
}

/** auth.users by email (service role), paging listUsers. */
export async function findUserByEmail(client: SupabaseClient, email: string): Promise<{ id: string; email: string; emailConfirmed: boolean } | null> {
  const want = normEmail(email);
  if (!want) return null;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth listUsers failed: ${error.message}`);
    const users = ((data as any)?.users ?? []) as { id: string; email?: string | null; email_confirmed_at?: string | null }[];
    const u = users.find((x) => normEmail(x.email) === want);
    if (u) return { id: u.id, email: want, emailConfirmed: !!u.email_confirmed_at };
    if (users.length < 1000) break;
  }
  return null;
}

export function liveWebOwnerAdminDeps(client: SupabaseClient, isAppSlug: (slug: string) => Promise<boolean>): WebOwnerAdminDeps {
  return {
    store: supabaseSiteOwners(client),
    isAppSlug,
    userByEmail: (email) => findUserByEmail(client, email),
    async emailOf(id) {
      const { data } = await client.auth.admin.getUserById(id);
      return data?.user?.email?.toLowerCase() ?? null;
    },
    async audit(e) {
      const { error } = await client.from('ab_events').insert({ kind: 'admin_site_owner', payload: { ...e, at: new Date().toISOString() } });
      if (error) throw new Error(error.message);
    },
    now: () => Date.now(),
  };
}
