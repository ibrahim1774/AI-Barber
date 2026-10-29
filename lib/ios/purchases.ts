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
  /**
   * 019: when a paid-but-unclaimed purchase (claim-start: user_id null, no slug) stops being fresh.
   * Only the sweep reads it, to LOG expired rows (no auto-refund, no takedown). Set once.
   */
  claim_expires_at?: string | null;
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
  /** With `only`, the stamp is written only while the row still belongs to that account and slug (a transfer may have moved it). */
  markPublished(otid: string, only?: { userId: string; slug: string }): Promise<void>;
  /**
   * THE ONLY writer of ios_purchases.user_id (besides the FK's ON DELETE SET NULL): a single
   * conditional UPDATE ... WHERE user_id IS NULL, so it never re-points an existing owner and of two
   * racing accounts exactly one gets true. False = already linked (to anyone, the caller included).
   */
  setUserIfUnlinked(otid: string, userId: string): Promise<boolean>;
  /**
   * Move a purchase between accounts (POST /api/ios/transfer) in ONE conditional UPDATE:
   * `SET user_id = to WHERE original_transaction_id = otid AND user_id = from`. The slug, publish stamps
   * and everything else stay (the whole business moves with the purchase). True = moved; false = changed first.
   */
  transferUser?(otid: string, fromUserId: string, toUserId: string): Promise<boolean>;
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
  clearTakenDown(otid: string, only?: { userId: string; slug: string }): Promise<void>;
  /** 017: stamp removed_at (owner-initiated removal; idempotent, keeps the first stamp). */
  markRemoved(otid: string, at: number): Promise<void>;
  /** 017: clear removed_at only if it still equals `removedAt` (a newer removal keeps its stamp). */
  clearRemoved(otid: string, removedAt: string): Promise<void>;
  /** Stamp lapse_checked_at (the sweep asked Apple about this row). */
  markLapseChecked(otid: string, at: number): Promise<void>;
  /** The purchase bound to this slug, if any. */
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  /**
   * 019: stamp claim_expires_at on a still-unclaimed row (user_id null, no slug) that has none yet.
   * Never extends an existing deadline (claim-start is idempotent per otid). True = this call set it.
   */
  setClaimExpiryIfUnset?(otid: string, at: number): Promise<boolean>;
  /** The purchases linked to this account (user_id = userId), newest expiry first. Plan GET for a shop-less account. */
  ofUser?(userId: string): Promise<PurchaseRow[]>;
  /** Purchases linked to this account that hold a live (not removed) site: the one-site-per-account check. */
  liveSitesOfUser?(userId: string): Promise<PurchaseRow[]>;
  /** 019: unclaimed rows (no user, no slug, not revoked/removed) whose claim_expires_at has passed. */
  expiredUnclaimed?(limit: number, now: number): Promise<PurchaseRow[]>;
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

/**
 * The PostgREST or() filter guarding an expires_at write (evaluated in SQL under the row lock).
 *
 * Undated (no purchase date): forward only, so a stale verify or a retried older notification
 * can't put an older expiry back over a renewal.
 *
 * Dated: the expiry belongs to the NEWEST transaction (by purchase date), like product_id.
 * - Same or newer transaction than the stored product's: forward only (a renewal, a re-verify).
 * - A newer transaction for a DIFFERENT product may also move it backwards: an upgrade is
 *   immediate and starts a new period, so hosting.yearly with 11 months left -> store.monthly
 *   expires in 1 month (Apple refunds the rest pro rata). Forward-only kept the yearly date, so a
 *   cancelled upgrade stayed live (site up, Bookings / Store open) until the old yearly date.
 *   The same product only moves forward (an IOS_QA_ACTIVE_OTIDS row keeps its stretched expiry).
 * - An OLDER transaction than the stored product's never writes it, even a later date (the old
 *   yearly transaction retried after the upgrade must not put the yearly date back).
 * - A row stored undated (before 010, or seeded undated) keeps the forward-only rule.
 */
export function expiryGuard(at: string, dated: { purchasedAt: string; productId: string } | null): string {
  if (!dated) return `expires_at.is.null,expires_at.lt."${at}"`;
  const forward = `or(expires_at.is.null,expires_at.lt."${at}")`;
  const p = `"${dated.purchasedAt}"`;
  return [
    `and(product_purchased_at.is.null,${forward})`,
    `and(product_purchased_at.lte.${p},${forward})`,
    `and(product_purchased_at.lt.${p},product_id.neq."${dated.productId}")`,
  ].join(',');
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
      // expires_at follows the newest transaction (expiryGuard): never backwards on a renewal or a
      // stale verify, but an upgrade to a shorter period (yearly -> a higher monthly) moves it back.
      const at = iso(expiresAt) as string;
      const { data: moved, error: expErr } = await db().from(TABLE)
        .update({ expires_at: at })
        .eq('original_transaction_id', otid)
        .or(product.isUpgraded
          // The transaction an upgrade replaced carries the OLD period's end (the rest of a yearly
          // plan Apple refunded): it only fills an empty expiry, never overrides one.
          ? 'expires_at.is.null'
          : expiryGuard(at, dated ? { purchasedAt: iso(product.purchasedAt as number) as string, productId: product.productId } : null))
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

    async markPublished(otid, only) {
      let q = db().from(TABLE).update({ published_at: new Date().toISOString() }).eq('original_transaction_id', otid);
      if (only) q = q.eq('user_id', only.userId).eq('site_slug', only.slug);
      const { error } = await q;
      if (error) fail('markPublished', error);
    },

    async setUserIfUnlinked(otid, userId) {
      const { data, error } = await db().from(TABLE).update({ user_id: userId })
        .eq('original_transaction_id', otid).is('user_id', null).select('original_transaction_id');
      if (error) fail('setUserIfUnlinked', error);
      return Array.isArray(data) && data.length > 0;
    },

    async transferUser(otid, fromUserId, toUserId) {
      const { data, error } = await db().from(TABLE).update({ user_id: toUserId })
        .eq('original_transaction_id', otid).eq('user_id', fromUserId).select('original_transaction_id');
      if (error) fail('transferUser', error);
      return Array.isArray(data) && data.length > 0;
    },

    async setClaimExpiryIfUnset(otid, at) {
      const { data, error } = await db().from(TABLE).update({ claim_expires_at: iso(at) })
        .eq('original_transaction_id', otid).is('user_id', null).is('site_slug', null).is('claim_expires_at', null)
        .select('original_transaction_id');
      if (error) fail('setClaimExpiryIfUnset', error);
      return Array.isArray(data) && data.length > 0;
    },

    async ofUser(userId) {
      const { data, error } = await db().from(TABLE).select('*').eq('user_id', userId)
        .order('expires_at', { ascending: false, nullsFirst: false }).limit(20);
      if (error) fail('ofUser', error);
      return (data as PurchaseRow[]) ?? [];
    },

    async liveSitesOfUser(userId) {
      const { data, error } = await db().from(TABLE).select('*')
        .eq('user_id', userId).not('site_slug', 'is', null).is('removed_at', null);
      if (error) fail('liveSitesOfUser', error);
      return (data as PurchaseRow[]) ?? [];
    },

    async expiredUnclaimed(limit, now) {
      const { data, error } = await db().from(TABLE).select('*')
        .is('user_id', null).is('site_slug', null).is('revoked_at', null).is('removed_at', null)
        .not('claim_expires_at', 'is', null).lt('claim_expires_at', iso(now))
        .order('claim_expires_at', { ascending: true }).limit(limit);
      if (error) fail('expiredUnclaimed', error);
      return (data as PurchaseRow[]) ?? [];
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

    async clearTakenDown(otid, only) {
      let q = db().from(TABLE).update({ taken_down_at: null }).eq('original_transaction_id', otid);
      if (only) q = q.eq('user_id', only.userId).eq('site_slug', only.slug);
      const { error } = await q;
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
