// ios_domains (migration 012): one row per custom-domain subscription (Apple
// originalTransactionId). The row IS the state machine (lib/ios/domainFlow.ts); every state
// change is a conditional UPDATE on the current state, so two runners can never both move it.
// Service role only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IosEnv } from './appleVerify.js';

export const DOMAIN_STATES = [
  'reserved', 'buying', 'ordered', 'bought', 'attached', 'live', 'detaching', 'detached', 'failed', 'transferred',
] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

/** States in which a site's domain slot is taken (one per site; partial unique index in 012). */
export const SITE_HOLDING_STATES: readonly DomainState[] = ['reserved', 'buying', 'ordered', 'bought', 'attached', 'live', 'detaching'];
/** States the sweep resumes (a step is still due). */
export const RESUMABLE_STATES: readonly DomainState[] = ['reserved', 'buying', 'ordered', 'bought', 'attached', 'detaching'];
/** The domain is registered on our account (until it runs out). */
export const OWNED_STATES: readonly DomainState[] = ['bought', 'attached', 'live', 'detaching', 'detached'];

export interface DomainRow {
  original_transaction_id: string;
  environment: IosEnv;
  /** Bound at the first claim and never changed: one domain subscription, one site. */
  site_slug: string;
  domain: string;
  state: DomainState;
  /** Sandbox purchase: the whole lifecycle is simulated, Vercel is never called (see domainFlow). */
  simulated: boolean;
  failure_reason: string | null;
  last_error: string | null;
  order_id: string | null;
  expected_price: number | null;
  buy_started_at: string | null;
  vercel_bought_at: string | null;
  registration_expires_at: string | null;
  /** Desired Vercel auto-renew: on while the Apple subscription renews. */
  auto_renew: boolean;
  /** False after auto_renew changed until the sweep (or the step) applied it at Vercel. */
  auto_renew_synced: boolean;
  /** The Apple period paid for (expiresDate); never moves backwards. */
  paid_until: string | null;
  revoked_at: string | null;
  last_notification: string | null;
  lapse_checked_at: string | null;
  linked_at: string | null;
  detached_at: string | null;
  transferred_at: string | null;
  transferred_by: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

export type NewDomainRow = Pick<DomainRow, 'original_transaction_id' | 'environment' | 'site_slug' | 'domain' | 'simulated'> &
  Partial<Pick<DomainRow, 'paid_until'>>;

export interface DomainsRepo {
  get(otid: string): Promise<DomainRow | null>;
  /** The row holding this site's slot (SITE_HOLDING_STATES), if any. */
  holdingSite(slug: string): Promise<DomainRow | null>;
  /** Insert a reserved row. 'conflict' when the otid, the domain or the site slot is already taken. */
  insertReserved(row: NewDomainRow): Promise<'ok' | 'conflict'>;
  /**
   * UPDATE … WHERE otid AND state IN `from` (any state when `from` is null). Returns the new
   * row, or null when the row was not in one of those states (someone else moved it).
   * `updated_at` is always bumped. A 23505 (domain held by another row) throws DomainConflict.
   */
  update(otid: string, from: readonly DomainState[] | null, patch: Partial<DomainRow>, where?: { auto_renew?: boolean }): Promise<DomainRow | null>;
  /** paid_until = max(paid_until, at), in SQL. */
  extendPaidUntil(otid: string, at: number): Promise<void>;
  /** Take the row's lease until now + ms when it is free (null or past). */
  acquireLease(otid: string, now: number, ms: number): Promise<boolean>;
  releaseLease(otid: string): Promise<void>;
  /** RESUMABLE_STATES, lease free, least recently updated first. */
  resumable(limit: number, now: number): Promise<DomainRow[]>;
  /** OWNED attached rows whose Apple period may have ended: revoked, or paid_until ≤ cutoff. Oldest-checked first. */
  lapseCandidates(limit: number, cutoff: number): Promise<DomainRow[]>;
  /** auto_renew_synced = false and the registration is ours. */
  autoRenewUnsynced(limit: number): Promise<DomainRow[]>;
  /** Every row (admin; small table). */
  all(): Promise<DomainRow[]>;
}

export class DomainConflict extends Error {
  constructor() {
    super('domain-conflict');
    this.name = 'DomainConflict';
  }
}

const TABLE = 'ios_domains';
const iso = (ms: number) => new Date(ms).toISOString();

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`ios_domains ${op} failed: ${error?.message ?? 'unknown'}`);
}

const num = (r: any): DomainRow => (r && r.expected_price != null ? { ...r, expected_price: Number(r.expected_price) } : r);

export function supabaseDomains(client?: SupabaseClient): DomainsRepo {
  let sb = client;
  const db = () => (sb ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }));

  return {
    async get(otid) {
      const { data, error } = await db().from(TABLE).select('*').eq('original_transaction_id', otid).maybeSingle();
      if (error) fail('get', error);
      return data ? num(data) : null;
    },

    async holdingSite(slug) {
      const { data, error } = await db().from(TABLE).select('*').eq('site_slug', slug).in('state', SITE_HOLDING_STATES as string[]).limit(1);
      if (error) fail('holdingSite', error);
      return Array.isArray(data) && data[0] ? num(data[0]) : null;
    },

    async insertReserved(row) {
      const { error } = await db().from(TABLE).insert({ ...row, state: 'reserved' });
      if (error) {
        if ((error as { code?: string }).code === '23505') return 'conflict';
        fail('insertReserved', error);
      }
      return 'ok';
    },

    async update(otid, from, patch, where) {
      let q = db().from(TABLE).update({ ...patch, updated_at: new Date().toISOString() }).eq('original_transaction_id', otid);
      if (from) q = q.in('state', from as string[]);
      if (where?.auto_renew !== undefined) q = q.eq('auto_renew', where.auto_renew);
      const { data, error } = await q.select();
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new DomainConflict();
        fail('update', error);
      }
      return Array.isArray(data) && data[0] ? num(data[0]) : null;
    },

    async extendPaidUntil(otid, at) {
      const t = iso(at);
      const { error } = await db().from(TABLE).update({ paid_until: t, updated_at: new Date().toISOString() })
        .eq('original_transaction_id', otid).or(`paid_until.is.null,paid_until.lt."${t}"`);
      if (error) fail('extendPaidUntil', error);
    },

    async acquireLease(otid, now, ms) {
      const { data, error } = await db().from(TABLE).update({ lease_until: iso(now + ms) })
        .eq('original_transaction_id', otid).or(`lease_until.is.null,lease_until.lt."${iso(now)}"`).select('original_transaction_id');
      if (error) fail('acquireLease', error);
      return Array.isArray(data) && data.length > 0;
    },

    async releaseLease(otid) {
      const { error } = await db().from(TABLE).update({ lease_until: null }).eq('original_transaction_id', otid);
      if (error) fail('releaseLease', error);
    },

    async resumable(limit, now) {
      const { data, error } = await db().from(TABLE).select('*').in('state', RESUMABLE_STATES as string[])
        .or(`lease_until.is.null,lease_until.lt."${iso(now)}"`).order('updated_at', { ascending: true }).limit(limit);
      if (error) fail('resumable', error);
      return ((data as DomainRow[]) ?? []).map(num);
    },

    async lapseCandidates(limit, cutoff) {
      const { data, error } = await db().from(TABLE).select('*').in('state', ['bought', 'attached', 'live'])
        .or(`revoked_at.not.is.null,paid_until.lte."${iso(cutoff)}"`)
        .order('lapse_checked_at', { ascending: true, nullsFirst: true }).limit(limit);
      if (error) fail('lapseCandidates', error);
      return ((data as DomainRow[]) ?? []).map(num);
    },

    async autoRenewUnsynced(limit) {
      const { data, error } = await db().from(TABLE).select('*').eq('auto_renew_synced', false)
        .in('state', OWNED_STATES as string[]).order('updated_at', { ascending: true }).limit(limit);
      if (error) fail('autoRenewUnsynced', error);
      return ((data as DomainRow[]) ?? []).map(num);
    },

    async all() {
      const { data, error } = await db().from(TABLE).select('*').order('created_at', { ascending: true });
      if (error) fail('all', error);
      return ((data as DomainRow[]) ?? []).map(num);
    },
  };
}
