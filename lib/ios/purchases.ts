import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedTx } from './appleVerify.js';

export interface PurchaseRow {
  original_transaction_id: string; product_id: string; environment: 'Production' | 'Sandbox';
  site_slug: string | null; user_id: string | null; expires_at: string | null; revoked_at: string | null;
  last_notification: string | null; published_at: string | null;
}

export interface PurchasesRepo {
  get(otid: string): Promise<PurchaseRow | null>;
  upsertVerified(tx: VerifiedTx): Promise<PurchaseRow>;
  bindSlug(otid: string, slug: string): Promise<boolean>;
  slugTaken(slug: string): Promise<boolean>;
  markPublished(otid: string): Promise<void>;
  setUser(otid: string, userId: string): Promise<void>;
  applyNotification(n: { otid: string; productId: string; environment: string; expiresAt: number | null; revokedAt: number | null; type: string }): Promise<void>;
  unpublishedBound(limit: number): Promise<PurchaseRow[]>;
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
      const payload: Record<string, unknown> = {
        original_transaction_id: tx.originalTransactionId,
        product_id: tx.productId,
        environment: tx.environment,
        expires_at: iso(tx.expiresAt),
        verified_at: new Date().toISOString(),
      };
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
        expires_at: iso(n.expiresAt),
        last_notification: n.type,
      };
      if (n.revokedAt != null) payload.revoked_at = iso(n.revokedAt);
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
  };
}
