import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedTx, IosEnv } from './appleVerify.js';
import { GRACE_MS, isActiveRow, isLapsed } from './lapse.js';
import { isActive } from './txStatus.js';

export interface PurchaseRow {
  original_transaction_id: string; product_id: string; environment: 'Production' | 'Sandbox';
  site_slug: string | null; user_id: string | null; expires_at: string | null; revoked_at: string | null;
  last_notification: string | null; published_at: string | null;
  /** Set while the live site is replaced by the offline page (subscription lapsed). Content is kept. */
  taken_down_at: string | null;
  /**
   * 017: the owner removed the site (Delete account / Take my website offline). Unlike taken_down_at
   * (also set by a lapse), no automatic path ever restores a row with this set; only an explicit owner
   * publish clears it.
   */
  removed_at?: string | null;
  /** When the sweep last asked Apple about this row as a takedown/restore candidate. */
  lapse_checked_at: string | null;
  /**
   * Purchase date of the transaction product_id came from (010). product_id is only replaced
   * by a transaction purchased at or after this; null on rows from before 010.
   */
  product_purchased_at?: string | null;
  /** 014: set when a downgrade left Book/Shop links the plan no longer covers (the sweep strips them). */
  links_due_at?: string | null;
}

export interface PurchasesRepo {
  get(otid: string): Promise<PurchaseRow | null>;
  /**
   * Record a live Apple verification. With `checkedAt` (when Apple was asked),
   * a stored revoked_at older than that is cleared if Apple says the
   * subscription is active and not revoked (resubscribe after a refund).
   */
  upsertVerified(tx: VerifiedTx, opts?: { checkedAt?: number }): Promise<PurchaseRow>;
  bindSlug(otid: string, slug: string): Promise<boolean>;
  slugTaken(slug: string): Promise<boolean>;
  markPublished(otid: string): Promise<void>;
  setUser(otid: string, userId: string): Promise<void>;
  /**
   * Link the purchase to this account only while it has none (conditional in SQL): never
   * re-points an existing owner. True when this call linked it. Optional for older fakes.
   */
  setUserIfUnlinked?(otid: string, userId: string): Promise<boolean>;
  applyNotification(n: {
    otid: string; productId: string; environment: IosEnv; expiresAt: number | null; revokedAt: number | null; type: string;
    /** REFUND_REVERSED: set revoked_at = null (wins over revokedAt). */
    clearRevoked?: boolean;
    /**
     * A newer, unrevoked transaction (e.g. SUBSCRIBED after a refund) purchased
     * at this time: clear revoked_at only if it is older than this.
     */
    clearRevokedBefore?: number;
    /** The transaction's purchase date: orders product writes (product_id never moves backwards). */
    purchasedAt?: number | null;
    /** The transaction an upgrade replaced: its product is never written and it never revokes. */
    isUpgraded?: boolean;
  }): Promise<void>;
  unpublishedBound(limit: number): Promise<PurchaseRow[]>;
  /** Takedown prefilter: published, bound, not yet taken down, and lapsed per lapse.ts. Apple decides. */
  takedownCandidates(limit: number, now: number, opts?: { includeSandbox?: boolean }): Promise<PurchaseRow[]>;
  /** Restore prefilter: taken down and (revoked, or active again per lapse.ts). Apple decides. */
  restoreCandidates(limit: number, now: number): Promise<PurchaseRow[]>;
  markTakenDown(otid: string, at: number): Promise<void>;
  clearTakenDown(otid: string): Promise<void>;
  /** 017: stamp removed_at (owner-initiated removal; idempotent, keeps the first stamp). */
  markRemoved(otid: string, at: number): Promise<void>;
  /** 017: clear removed_at only if it still equals `removedAt` (a newer removal keeps its stamp). */
  clearRemoved(otid: string, removedAt: string): Promise<void>;
  /** Stamp lapse_checked_at (the sweep asked Apple about this row). */
  markLapseChecked(otid: string, at: number): Promise<void>;
  /** The purchase bound to this slug, if any. */
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  /** 014 (M1): stamp links_due_at (the product stopped covering Book/Shop links). Optional for older fakes. */
  markLinksDue?(otid: string, at: number): Promise<void>;
  /** 014 (M1): bound, published, live rows with links_due_at set, oldest first. */
  linksDue?(limit: number): Promise<PurchaseRow[]>;
  /** 014 (M1): clear links_due_at only if it is still `dueAt` (a newer downgrade keeps its stamp). */
  clearLinksDue?(otid: string, dueAt: string): Promise<void>;
}

const TABLE = 'ios_purchases';
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

function fail(op: string, error: { message?: string } | null): never {
  throw new Error(`ios_purchases ${op} failed: ${error?.message ?? 'unknown'}`);
}

/** What the never-backwards rules read before writing. */
const STORED_COLS = 'original_transaction_id';

export function supabasePurchases(client?: SupabaseClient): PurchasesRepo {
  let sb = client;
  const db = () => (sb ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }));

  /**
   * Write `fields` to the purchase row, creating it first if `exists` is false, and record
   * the transaction's product under the never-backwards rule (Phase 4 tiers):
   *
   * - The row is created with ON CONFLICT DO NOTHING (product_id is NOT NULL, so the seed
   *   carries the product); an existing row is never overwritten by the seed.
   * - `fields` never carry product_id: they go in a plain UPDATE.
   * - The product is replaced by a conditional UPDATE, evaluated by Postgres under the row
   *   lock: only when the stored product_purchased_at is null (a row from before 010, or
   *   seeded undated) or not after this transaction's purchase date. So a slow writer
   *   holding an older transaction can never undo an upgrade or re-raise a finished
   *   downgrade, whatever lands between its read and its write.
   * - Undated transactions and the transaction an upgrade replaced (isUpgraded) never
   *   replace a stored product.
   */
  async function writeRow(
    op: string,
    otid: string,
    exists: boolean,
    fields: Record<string, unknown>,
    product: { productId: string; purchasedAt?: number | null; isUpgraded?: boolean },
    expiresAt: number | null,
  ): Promise<PurchaseRow> {
    const dated = !product.isUpgraded && product.purchasedAt != null;
    if (!exists) {
      const seed: Record<string, unknown> = {
        original_transaction_id: otid, product_id: product.productId, environment: fields.environment,
      };
      if (dated) seed.product_purchased_at = iso(product.purchasedAt as number);
      const { error } = await db().from(TABLE).upsert(seed, { onConflict: 'original_transaction_id', ignoreDuplicates: true });
      if (error) fail(op, error);
    }
    const { data, error } = await db().from(TABLE).update(fields).eq('original_transaction_id', otid).select().single();
    if (error) fail(op, error);
    let row = data as PurchaseRow;
    if (expiresAt != null) {
      // expires_at never moves backwards either: guarded the same way, so a stale verify or a
      // retried older notification can't put an older expiry back over a renewal.
      const at = iso(expiresAt) as string;
      const { data: moved, error: expErr } = await db().from(TABLE)
        .update({ expires_at: at })
        .eq('original_transaction_id', otid)
        .or(`expires_at.is.null,expires_at.lt."${at}"`)
        .select();
      if (expErr) fail(op, expErr);
      if (Array.isArray(moved) && moved.length > 0) row = moved[0] as PurchaseRow;
    }
    if (dated) {
      const at = iso(product.purchasedAt as number) as string;
      const { data: moved, error: moveErr } = await db().from(TABLE)
        .update({ product_id: product.productId, product_purchased_at: at })
        .eq('original_transaction_id', otid)
        .or(`product_purchased_at.is.null,product_purchased_at.lte."${at}"`)
        .select();
      if (moveErr) fail(op, moveErr);
      if (Array.isArray(moved) && moved.length > 0) row = moved[0] as PurchaseRow;
    }
    return row;
  }

  return {
    async get(otid) {
      const { data, error } = await db().from(TABLE).select('*').eq('original_transaction_id', otid).maybeSingle();
      if (error) fail('get', error);
      return (data as PurchaseRow) ?? null;
    },

    async upsertVerified(tx, opts) {
      // Never sends site_slug / user_id / published_at. revoked_at is only set when revoked
      // (an existing revoked_at is never cleared here). expires_at and product_id never move
      // backwards (nor is expires_at wiped by a null): both are conditional writes in SQL
      // (writeRow), never read-then-write. The read only tells whether the row exists.
      const { data: cur, error: readErr } = await db().from(TABLE).select(STORED_COLS)
        .eq('original_transaction_id', tx.originalTransactionId).maybeSingle();
      if (readErr) fail('upsertVerified', readErr);

      const payload: Record<string, unknown> = {
        environment: tx.environment,
        verified_at: new Date().toISOString(),
      };
      if (tx.revoked) payload.revoked_at = new Date().toISOString();
      const row = await writeRow('upsertVerified', tx.originalTransactionId, !!cur, payload,
        { productId: tx.productId, purchasedAt: tx.productPurchasedAt }, tx.expiresAt);

      // Resubscribed after a refund: Apple's live status says active and not
      // revoked. Clear a revocation recorded BEFORE we asked Apple; the
      // condition is in SQL, so a refund recorded after that moment is kept.
      if (opts?.checkedAt != null && row?.revoked_at != null && !tx.revoked && isActive(tx, opts.checkedAt)) {
        const { data: cleared, error: clearErr } = await db().from(TABLE).update({ revoked_at: null })
          .eq('original_transaction_id', tx.originalTransactionId).lt('revoked_at', iso(opts.checkedAt))
          .select('original_transaction_id');
        if (clearErr) fail('upsertVerified', clearErr);
        if (Array.isArray(cleared) && cleared.length > 0) return { ...row, revoked_at: null };
      }
      return row;
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

    async setUserIfUnlinked(otid, userId) {
      const { data, error } = await db().from(TABLE).update({ user_id: userId })
        .eq('original_transaction_id', otid).is('user_id', null).select('original_transaction_id');
      if (error) fail('setUserIfUnlinked', error);
      return Array.isArray(data) && data.length > 0;
    },

    async markLinksDue(otid, at) {
      const { error } = await db().from(TABLE).update({ links_due_at: iso(at) }).eq('original_transaction_id', otid);
      if (error) fail('markLinksDue', error);
    },

    async linksDue(limit) {
      const { data, error } = await db().from(TABLE).select('*')
        .not('links_due_at', 'is', null).not('site_slug', 'is', null).not('published_at', 'is', null)
        .is('taken_down_at', null).is('revoked_at', null).is('removed_at', null)
        .order('links_due_at', { ascending: true }).limit(limit);
      if (error) fail('linksDue', error);
      return (data as PurchaseRow[]) ?? [];
    },

    async clearLinksDue(otid, dueAt) {
      const { error } = await db().from(TABLE).update({ links_due_at: null })
        .eq('original_transaction_id', otid).eq('links_due_at', dueAt);
      if (error) fail('clearLinksDue', error);
    },

    async applyNotification(n) {
      // Same never-backwards rules as upsertVerified: Apple retries failed
      // notifications for days, so an older one can land after a newer
      // renewal. expires_at drives lapse takedowns and the gates of unwatched
      // purchases (lapse.ts), product_id the tier gates, so a stale value must never
      // overwrite a later one: both are conditional writes in SQL (writeRow). The read
      // only tells whether the row exists.
      const { data: cur, error: readErr } = await db().from(TABLE).select(STORED_COLS)
        .eq('original_transaction_id', n.otid).maybeSingle();
      if (readErr) fail('applyNotification', readErr);
      const payload: Record<string, unknown> = {
        environment: n.environment,
        last_notification: n.type,
      };
      // The transaction an upgrade replaced carries a revocationDate; the purchase is not revoked.
      if (n.clearRevoked) payload.revoked_at = null;
      else if (n.revokedAt != null && !n.isUpgraded) payload.revoked_at = iso(n.revokedAt);
      await writeRow('applyNotification', n.otid, !!cur, payload,
        { productId: n.productId, purchasedAt: n.purchasedAt, isUpgraded: n.isUpgraded === true }, n.expiresAt);
      // A newer unrevoked purchase supersedes an older revocation; a late,
      // older transaction never clears one (condition evaluated in SQL).
      if (!n.clearRevoked && n.clearRevokedBefore != null) {
        const { error: clearErr } = await db().from(TABLE).update({ revoked_at: null })
          .eq('original_transaction_id', n.otid).lt('revoked_at', iso(n.clearRevokedBefore));
        if (clearErr) fail('applyNotification', clearErr);
      }
    },

    async unpublishedBound(limit) {
      const { data, error } = await db().from(TABLE).select('*')
        .not('site_slug', 'is', null).is('published_at', null).is('revoked_at', null).is('removed_at', null)
        .order('verified_at', { ascending: true }).limit(limit);
      if (error) fail('unpublishedBound', error);
      return (data as PurchaseRow[]) ?? [];
    },

    async takedownCandidates(limit, now, opts) {
      // Prefilter only (lapse.ts): coarse in SQL, re-checked here. The sweep asks Apple before acting.
      // Oldest-checked first, so rows Apple keeps answering "active" or can't
      // resolve rotate to the back instead of starving real lapses.
      const includeSandbox = opts?.includeSandbox ?? true;
      const cutoff = new Date(now - GRACE_MS).toISOString();
      let q = db().from(TABLE).select('*')
        .not('site_slug', 'is', null).not('published_at', 'is', null).is('taken_down_at', null)
        .or(`revoked_at.not.is.null,expires_at.lte."${cutoff}"`);
      if (!includeSandbox) q = q.eq('environment', 'Production');
      const { data, error } = await q
        .order('lapse_checked_at', { ascending: true, nullsFirst: true })
        .order('expires_at', { ascending: true }).limit(limit);
      if (error) fail('takedownCandidates', error);
      return ((data as PurchaseRow[]) ?? []).filter((r) =>
        r.site_slug != null && r.published_at != null && r.taken_down_at == null && isLapsed(r, now)
        && (includeSandbox || r.environment === 'Production'));
    },

    async restoreCandidates(limit, now) {
      // Revoked rows too: a refunded customer who resubscribes keeps the same
      // originalTransactionId, and Apple's answer (the sweep asks) clears it.
      const { data, error } = await db().from(TABLE).select('*')
        .not('taken_down_at', 'is', null).is('removed_at', null)
        .or(`revoked_at.not.is.null,expires_at.gt."${new Date(now).toISOString()}"`)
        .order('lapse_checked_at', { ascending: true, nullsFirst: true })
        .order('expires_at', { ascending: true }).limit(limit);
      if (error) fail('restoreCandidates', error);
      return ((data as PurchaseRow[]) ?? []).filter((r) =>
        r.site_slug != null && r.taken_down_at != null && r.removed_at == null && (r.revoked_at != null || isActiveRow(r, now)));
    },

    async markTakenDown(otid, at) {
      const { error } = await db().from(TABLE).update({ taken_down_at: new Date(at).toISOString() }).eq('original_transaction_id', otid);
      if (error) fail('markTakenDown', error);
    },

    async clearTakenDown(otid) {
      const { error } = await db().from(TABLE).update({ taken_down_at: null }).eq('original_transaction_id', otid);
      if (error) fail('clearTakenDown', error);
    },

    async markRemoved(otid, at) {
      const { error } = await db().from(TABLE).update({ removed_at: new Date(at).toISOString() }).eq('original_transaction_id', otid).is('removed_at', null);
      if (error) fail('markRemoved', error);
    },

    async clearRemoved(otid, removedAt) {
      const { error } = await db().from(TABLE).update({ removed_at: null }).eq('original_transaction_id', otid).eq('removed_at', removedAt);
      if (error) fail('clearRemoved', error);
    },

    async markLapseChecked(otid, at) {
      const { error } = await db().from(TABLE).update({ lapse_checked_at: new Date(at).toISOString() }).eq('original_transaction_id', otid);
      if (error) fail('markLapseChecked', error);
    },

    async findBySlug(slug) {
      const { data, error } = await db().from(TABLE).select('*').eq('site_slug', slug).maybeSingle();
      if (error) fail('findBySlug', error);
      return (data as PurchaseRow) ?? null;
    },
  };
}
