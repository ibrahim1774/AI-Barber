import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedTx, IosEnv } from './appleVerify.js';
import { GRACE_MS, isActiveRow, isLapsed } from './lapse.js';

export interface PurchaseRow {
  original_transaction_id: string; product_id: string; environment: 'Production' | 'Sandbox';
  site_slug: string | null; user_id: string | null; expires_at: string | null; revoked_at: string | null;
  last_notification: string | null; published_at: string | null;
  /** Set while the live site is replaced by the offline page (subscription lapsed). Content is kept. */
  taken_down_at: string | null;
}

export interface PurchasesRepo {
  get(otid: string): Promise<PurchaseRow | null>;
  upsertVerified(tx: VerifiedTx): Promise<PurchaseRow>;
  bindSlug(otid: string, slug: string): Promise<boolean>;
  slugTaken(slug: string): Promise<boolean>;
  markPublished(otid: string): Promise<void>;
  setUser(otid: string, userId: string): Promise<void>;
  applyNotification(n: {
    otid: string; productId: string; environment: IosEnv; expiresAt: number | null; revokedAt: number | null; type: string;
    /** REFUND_REVERSED: set revoked_at = null (wins over revokedAt). */
    clearRevoked?: boolean;
  }): Promise<void>;
  unpublishedBound(limit: number): Promise<PurchaseRow[]>;
  /** Published, bound, not yet taken down, and lapsed (lapse.ts). */
  takedownCandidates(limit: number, now: number): Promise<PurchaseRow[]>;
  /** Taken down and active again (lapse.ts). */
  restoreCandidates(limit: number, now: number): Promise<PurchaseRow[]>;
  markTakenDown(otid: string, at: number): Promise<void>;
  clearTakenDown(otid: string): Promise<void>;
  /** The purchase bound to this slug, if any. */
  findBySlug(slug: string): Promise<PurchaseRow | null>;
}

const TABLE = 'ios_purchases';
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`ios_purchases ${op} failed: ${error?.message ?? 'unknown'}`);
}

export function supabasePurchases(client?: SupabaseClient): PurchasesRepo {
  let sb = client;
  const db = () => (sb ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }));

  return {
    async get(otid) {
      const { data, error } = await db().from(TABLE).select('*').eq('original_transaction_id', otid).maybeSingle();
      if (error) fail('get', error);
      return (data as PurchaseRow) ?? null;
    },

    async upsertVerified(tx) {
      // Never sends site_slug / user_id / published_at. revoked_at is only set when revoked
      // (an existing revoked_at is never cleared here).
      //
      // expires_at never moves backwards (nor is wiped by a null): read the stored
      // value, write ours only if it is newer. Read-then-write, not atomic: only this
      // server writes the row, and the race (a concurrent verify or notification
      // landing between read and write) can at worst leave a value Apple reported
      // moments earlier; the next verify or notification corrects it. Benign.
      const { data: cur, error: readErr } = await db().from(TABLE).select('expires_at')
        .eq('original_transaction_id', tx.originalTransactionId).maybeSingle();
      if (readErr) fail('upsertVerified', readErr);
      const stored = cur?.expires_at ? Date.parse(cur.expires_at as string) : NaN;
      const keepStored = Number.isFinite(stored) && (tx.expiresAt == null || tx.expiresAt < stored);

      const payload: Record<string, unknown> = {
        original_transaction_id: tx.originalTransactionId,
        product_id: tx.productId,
        environment: tx.environment,
        verified_at: new Date().toISOString(),
      };
      if (!keepStored) payload.expires_at = iso(tx.expiresAt);
      if (tx.revoked) payload.revoked_at = new Date().toISOString();
      const { data, error } = await db().from(TABLE).upsert(payload, { onConflict: 'original_transaction_id' }).select().single();
      if (error) fail('upsertVerified', error);
      return data as PurchaseRow;
    },

    async bindSlug(otid, slug) {
      const { data, error } = await db().from(TABLE).update({ site_slug: slug })
        .eq('original_transaction_id', otid).is('site_slug', null).select('original_transaction_id');
      if (error) {
        if ((error as { code?: string }).code === '23505') return false; // slug already bound to another purchase
        fail('bindSlug', error);
      }
      return Array.isArray(data) && data.length > 0;
    },

    async slugTaken(slug) {
      const { data, error } = await db().from(TABLE).select('original_transaction_id').eq('site_slug', slug).limit(1);
      if (error) fail('slugTaken', error);
      return Array.isArray(data) && data.length > 0;
    },

    async markPublished(otid) {
      const { error } = await db().from(TABLE).update({ published_at: new Date().toISOString() }).eq('original_transaction_id', otid);
      if (error) fail('markPublished', error);
    },

    async setUser(otid, userId) {
      const { error } = await db().from(TABLE).update({ user_id: userId }).eq('original_transaction_id', otid);
      if (error) fail('setUser', error);
    },

    async applyNotification(n) {
      const payload: Record<string, unknown> = {
        original_transaction_id: n.otid,
        product_id: n.productId,
        environment: n.environment,
        last_notification: n.type,
      };
      if (n.expiresAt != null) payload.expires_at = iso(n.expiresAt);
      if (n.clearRevoked) payload.revoked_at = null;
      else if (n.revokedAt != null) payload.revoked_at = iso(n.revokedAt);
      const { error } = await db().from(TABLE).upsert(payload, { onConflict: 'original_transaction_id' });
      if (error) fail('applyNotification', error);
    },

    async unpublishedBound(limit) {
      const { data, error } = await db().from(TABLE).select('*')
        .not('site_slug', 'is', null).is('published_at', null).is('revoked_at', null)
        .order('verified_at', { ascending: true }).limit(limit);
      if (error) fail('unpublishedBound', error);
      return (data as PurchaseRow[]) ?? [];
    },

    async takedownCandidates(limit, now) {
      // Coarse filter in SQL, exact rule (isLapsed) re-checked here.
      const cutoff = new Date(now - GRACE_MS).toISOString();
      const { data, error } = await db().from(TABLE).select('*')
        .not('site_slug', 'is', null).not('published_at', 'is', null).is('taken_down_at', null)
        .or(`revoked_at.not.is.null,expires_at.lte."${cutoff}"`)
        .order('expires_at', { ascending: true }).limit(limit);
      if (error) fail('takedownCandidates', error);
      return ((data as PurchaseRow[]) ?? []).filter((r) => isLapsed(r, now));
    },

    async restoreCandidates(limit, now) {
      const { data, error } = await db().from(TABLE).select('*')
        .not('taken_down_at', 'is', null).is('revoked_at', null).gt('expires_at', new Date(now).toISOString())
        .order('taken_down_at', { ascending: true }).limit(limit);
      if (error) fail('restoreCandidates', error);
      return ((data as PurchaseRow[]) ?? []).filter((r) => isActiveRow(r, now));
    },

    async markTakenDown(otid, at) {
      const { error } = await db().from(TABLE).update({ taken_down_at: new Date(at).toISOString() }).eq('original_transaction_id', otid);
      if (error) fail('markTakenDown', error);
    },

    async clearTakenDown(otid) {
      const { error } = await db().from(TABLE).update({ taken_down_at: null }).eq('original_transaction_id', otid);
      if (error) fail('clearTakenDown', error);
    },

    async findBySlug(slug) {
      const { data, error } = await db().from(TABLE).select('*').eq('site_slug', slug).maybeSingle();
      if (error) fail('findBySlug', error);
      return (data as PurchaseRow) ?? null;
    },
  };
}
