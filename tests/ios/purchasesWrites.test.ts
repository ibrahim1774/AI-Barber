// upsertVerified and applyNotification against a stateful fake of ios_purchases (filters are
// evaluated at write time, like Postgres), including writers racing between read and write.
import { describe, it, expect } from 'vitest';
import { expiryGuard, supabasePurchases } from '../../lib/ios/purchases.js';
import { GRACE_MS, isLapsed } from '../../lib/ios/lapse.js';
import { fakePurchasesDb } from './fakePurchasesDb.js';

const P = 'com.ibrahim1774.aibarber.';
const T0 = 1_800_000_000_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const stored = (over: Record<string, unknown> = {}) => ({
  original_transaction_id: 'o1', product_id: `${P}hosting.monthly`, environment: 'Production',
  site_slug: 'fresh-cuts', user_id: 'u1', published_at: iso(T0), expires_at: iso(T0 + 30 * DAY),
  revoked_at: null, taken_down_at: null, product_purchased_at: iso(T0), last_notification: null, ...over,
});
const vtx = (over: Record<string, unknown> = {}) => ({
  originalTransactionId: 'o1', transactionId: 't1', productId: `${P}hosting.monthly`, environment: 'Production' as const,
  expiresAt: T0 + 30 * DAY, revoked: false, status: 1, productPurchasedAt: T0, ...over,
});
const note = (over: Record<string, unknown> = {}) => ({
  otid: 'o1', productId: `${P}hosting.monthly`, environment: 'Production' as const,
  expiresAt: null, revokedAt: null, type: 'DID_RENEW', ...over,
});

describe('upsertVerified', () => {
  it('creates the row with the product and its purchase date; never sends site_slug, user_id or published_at', async () => {
    const db = fakePurchasesDb();
    const row = await supabasePurchases(db.client).upsertVerified(vtx({ productId: `${P}bookings.monthly` }));
    expect(row).toMatchObject({ product_id: `${P}bookings.monthly`, product_purchased_at: iso(T0), expires_at: iso(T0 + 30 * DAY), environment: 'Production' });
    expect(row.revoked_at ?? null).toBeNull();
    for (const w of db.log) for (const k of ['site_slug', 'user_id', 'published_at']) expect(Object.keys(w.payload!)).not.toContain(k);
    // The create never overwrites a row someone else created first.
    expect(db.log[0]).toMatchObject({ op: 'upsert' });
  });

  it('an existing row is only UPDATEd (no upsert, no product sent back)', async () => {
    const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + DAY) })]);
    await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: T0 }));
    expect(db.log.map((w) => w.op)).toEqual(['update', 'update', 'update', 'update']); // fields, upgrade (expiry+product), guarded expiry, guarded product
    expect(Object.keys(db.log[0].payload!)).not.toContain('product_id');
    expect(db.row('o1')!.product_id).toBe(`${P}store.monthly`);
  });

  it('a first create without a purchase date still records the product (undated, so any dated write wins)', async () => {
    const db = fakePurchasesDb();
    await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: null }));
    expect(db.row('o1')).toMatchObject({ product_id: `${P}hosting.monthly` });
    expect(db.row('o1')!.product_purchased_at ?? null).toBeNull();
  });

  it('a row created concurrently is not overwritten by the create (ON CONFLICT DO NOTHING)', async () => {
    const db = fakePurchasesDb([], {
      onRead: (rows) => { if (!rows.has('o1')) rows.set('o1', stored({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + DAY) })); },
    });
    await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: T0 }));
    expect(db.row('o1')!.product_id).toBe(`${P}store.monthly`);
  });

  it('sets revoked_at when revoked; a null expiry leaves a new row\'s expiry null', async () => {
    const db = fakePurchasesDb();
    await supabasePurchases(db.client).upsertVerified(vtx({ revoked: true, expiresAt: null }));
    expect(typeof db.row('o1')!.revoked_at).toBe('string');
    expect(db.row('o1')!.expires_at ?? null).toBeNull(); // never written: the column default (NULL)
  });

  describe('expires_at never moves backwards', () => {
    const STORED = T0 + 30 * DAY;
    it('older incoming expiry is not written', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).upsertVerified(vtx({ expiresAt: STORED - DAY }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED));
    });
    it('newer incoming expiry is written', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).upsertVerified(vtx({ expiresAt: STORED + DAY }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED + DAY));
    });
    it('null incoming expiry does not wipe a stored one', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).upsertVerified(vtx({ expiresAt: null }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED));
    });
    it('N1 race: a stale verify landing after a DID_RENEW never puts the older expiry back', async () => {
      // The stale verify read E0 = STORED; DID_RENEW writes E1 right after that read.
      const db = fakePurchasesDb([stored()], {
        onRead: (rows) => Object.assign(rows.get('o1')!, { expires_at: iso(STORED + 30 * DAY) }),
      });
      await supabasePurchases(db.client).upsertVerified(vtx({ expiresAt: STORED }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED + 30 * DAY));
    });

    it('N1: the expiry write is guarded in SQL (is null or older than the new value)', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).upsertVerified(vtx({ expiresAt: STORED + DAY }));
      const w = db.log.find((l) => l.payload && Object.keys(l.payload).join() === 'expires_at')!;
      expect(w.payload).toEqual({ expires_at: iso(STORED + DAY) });
      expect(w.filters).toContain(`or(${expiryGuard(iso(STORED + DAY), { purchasedAt: iso(T0), productId: `${P}hosting.monthly` })})`);
    });

    it('N1: an undated verify keeps the plain guard (is null or older than the new value)', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).upsertVerified(vtx({ expiresAt: STORED + DAY, productPurchasedAt: null }));
      const w = db.log.find((l) => l.payload && 'expires_at' in l.payload)!;
      expect(w.filters).toContain(`or(expires_at.is.null,expires_at.lt."${iso(STORED + DAY)}")`);
    });
  });

  describe('fix48: expires_at follows the newest transaction (upgrade to a shorter period)', () => {
    // hosting.yearly bought at T0 (expires T0+365d); upgraded to store.monthly at T0+30d (expires T0+60d).
    const YEARLY = stored({ product_id: `${P}hosting.yearly`, expires_at: iso(T0 + 365 * DAY) });
    const UP = { productId: `${P}store.monthly`, productPurchasedAt: T0 + 30 * DAY, expiresAt: T0 + 60 * DAY };

    it('a verify of the upgraded (newer, other product) transaction moves the expiry BACK to the new period', async () => {
      const db = fakePurchasesDb([YEARLY]);
      const row = await supabasePurchases(db.client).upsertVerified(vtx(UP));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 60 * DAY), product_purchased_at: iso(T0 + 30 * DAY) });
      expect(row.expires_at).toBe(iso(T0 + 60 * DAY));
    });

    it('then the old yearly transaction, re-verified late (older purchase date), never puts the yearly date back', async () => {
      const db = fakePurchasesDb([YEARLY]);
      const repo = supabasePurchases(db.client);
      await repo.upsertVerified(vtx(UP));
      await repo.upsertVerified(vtx({ productId: `${P}hosting.yearly`, productPurchasedAt: T0, expiresAt: T0 + 365 * DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 60 * DAY) });
    });

    it('a newer transaction of the SAME product never moves it back (the QA override stretch is kept)', async () => {
      const db = fakePurchasesDb([stored({ expires_at: iso(T0 + 31 * DAY) })]);
      await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: T0 + DAY, expiresAt: T0 + 2 * DAY }));
      expect(db.row('o1')!.expires_at).toBe(iso(T0 + 31 * DAY));
    });

    it('a row stored undated (before 010) keeps forward-only, even for another product', async () => {
      const db = fakePurchasesDb([{ ...YEARLY, product_purchased_at: null }]);
      await supabasePurchases(db.client).upsertVerified(vtx(UP));
      expect(db.row('o1')!.expires_at).toBe(iso(T0 + 365 * DAY));
      expect(db.row('o1')!.product_id).toBe(`${P}store.monthly`);
    });

    it('race: the upgrade landing between a stale yearly verify\'s read and write is not undone', async () => {
      const db = fakePurchasesDb([YEARLY], {
        onRead: (rows) => Object.assign(rows.get('o1')!, {
          product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + 30 * DAY), expires_at: iso(T0 + 60 * DAY),
        }),
      });
      await supabasePurchases(db.client).upsertVerified(vtx({ productId: `${P}hosting.yearly`, productPurchasedAt: T0, expiresAt: T0 + 400 * DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 60 * DAY) });
    });

    it('fix48 race: a stale older-yearly verify arriving right after the upgrade\'s expiry move cannot restore the yearly expiry', async () => {
      let fired = false;
      let staleRepo: ReturnType<typeof supabasePurchases>;
      const db = fakePurchasesDb([YEARLY], {
        // Fires after the first update that carries expires_at: with the old two-statement code that is
        // between the expiry move and the product move; now the upgrade is one statement, so it is after both.
        afterUpdate: async (_rows, payload) => {
          if (fired || !('expires_at' in payload)) return;
          fired = true;
          await staleRepo.upsertVerified(vtx({ productId: `${P}hosting.yearly`, productPurchasedAt: T0, expiresAt: T0 + 400 * DAY }));
        },
      });
      staleRepo = supabasePurchases(db.client);
      await staleRepo.upsertVerified(vtx(UP));
      expect(fired).toBe(true);
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 60 * DAY), product_purchased_at: iso(T0 + 30 * DAY) });
    });

    it('a cancelled upgrade lapses on the NEW expiry (takedown prefilter), not the old yearly date', async () => {
      const db = fakePurchasesDb([YEARLY]);
      await supabasePurchases(db.client).upsertVerified(vtx(UP));
      const r = db.row('o1')! as any;
      expect(isLapsed(r, T0 + 60 * DAY + GRACE_MS)).toBe(true);
    });

    it('read error throws, nothing written', async () => {
      const db = fakePurchasesDb([stored()], { readError: 'db down' });
      await expect(supabasePurchases(db.client).upsertVerified(vtx())).rejects.toThrow(/upsertVerified/);
      expect(db.log).toEqual([]);
    });
  });

  describe('product_id never moves backwards (conditional in SQL)', () => {
    it('an older productPurchasedAt keeps the stored product', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0) })]);
      const row = await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: T0 - DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0) });
      expect(row.product_id).toBe(`${P}store.monthly`);
    });
    it('a newer one overwrites both columns, and the returned row has it', async () => {
      const db = fakePurchasesDb([stored()]);
      const row = await supabasePurchases(db.client).upsertVerified(vtx({ productId: `${P}store.yearly`, productPurchasedAt: T0 + DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.yearly`, product_purchased_at: iso(T0 + DAY) });
      expect(row.product_id).toBe(`${P}store.yearly`);
    });
    it('the same purchase date (a re-verify of the same transaction) writes', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).upsertVerified(vtx({ productId: `${P}bookings.monthly`, productPurchasedAt: T0 }));
      expect(db.row('o1')!.product_id).toBe(`${P}bookings.monthly`);
    });
    it('a pre-010 row (stored purchase date null) takes the incoming product', async () => {
      const db = fakePurchasesDb([stored({ product_purchased_at: null })]);
      await supabasePurchases(db.client).upsertVerified(vtx({ productId: `${P}store.monthly`, productPurchasedAt: T0 - 9 * DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0 - 9 * DAY) });
    });
    it('an undated transaction never replaces a stored product', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly`, product_purchased_at: null })]);
      await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: undefined }));
      expect(db.row('o1')!.product_id).toBe(`${P}store.monthly`);
    });

    it('race: an upgrade landing between a stale verify\'s read and write is NOT undone', async () => {
      // The stale verify carries hosting@T0; the UPGRADE (store@T0+1d) lands right after its read.
      const db = fakePurchasesDb([stored()], {
        onRead: (rows) => Object.assign(rows.get('o1')!, { product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + DAY) }),
      });
      await supabasePurchases(db.client).upsertVerified(vtx({ productPurchasedAt: T0 }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + DAY) });
    });

    it('race: a finished downgrade is not re-raised by a stale higher-tier write', async () => {
      // A stale verify carries store@T0; the DID_RENEW onto hosting@T0+30d lands right after its read.
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly` })], {
        onRead: (rows) => Object.assign(rows.get('o1')!, { product_id: `${P}hosting.monthly`, product_purchased_at: iso(T0 + 30 * DAY) }),
      });
      await supabasePurchases(db.client).upsertVerified(vtx({ productId: `${P}store.monthly`, productPurchasedAt: T0 }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}hosting.monthly`, product_purchased_at: iso(T0 + 30 * DAY) });
    });
  });

  describe('stale revocations clear only on a newer, active, unrevoked answer', () => {
    const T = T0;
    it('checkedAt + Apple active clears a revocation older than the check (conditional in SQL)', async () => {
      const db = fakePurchasesDb([stored({ revoked_at: iso(T - DAY) })]);
      const row = await supabasePurchases(db.client).upsertVerified(vtx(), { checkedAt: T });
      expect(row.revoked_at).toBeNull();
      expect(db.row('o1')!.revoked_at).toBeNull();
    });
    it('a revocation recorded after the check survives', async () => {
      const db = fakePurchasesDb([stored({ revoked_at: iso(T + 1000) })]);
      const row = await supabasePurchases(db.client).upsertVerified(vtx(), { checkedAt: T });
      expect(row.revoked_at).toBe(iso(T + 1000));
    });
    it('never clears without checkedAt, for a revoked tx, or when Apple says inactive (billing retry)', async () => {
      for (const [tx, o] of [[vtx(), undefined], [vtx({ revoked: true, status: 5 }), { checkedAt: T }], [vtx({ status: 3 }), { checkedAt: T }]] as const) {
        const db = fakePurchasesDb([stored({ revoked_at: iso(T - DAY) })]);
        await supabasePurchases(db.client).upsertVerified(tx as any, o as any);
        expect(db.row('o1')!.revoked_at).not.toBeNull();
      }
    });
  });
});

describe('applyNotification', () => {
  it('creates a missing row, without touching site_slug, user_id or published_at', async () => {
    const db = fakePurchasesDb();
    await supabasePurchases(db.client).applyNotification(note({ expiresAt: 5000, purchasedAt: T0 }));
    expect(db.row('o1')).toMatchObject({ product_id: `${P}hosting.monthly`, last_notification: 'DID_RENEW', expires_at: iso(5000), product_purchased_at: iso(T0) });
    for (const w of db.log) for (const k of ['site_slug', 'user_id', 'published_at', 'revoked_at']) expect(Object.keys(w.payload!)).not.toContain(k);
  });

  it('omits expires_at when expiresAt is null', async () => {
    const db = fakePurchasesDb([stored()]);
    await supabasePurchases(db.client).applyNotification(note({ type: 'DID_CHANGE_RENEWAL_STATUS' }));
    expect(db.row('o1')).toMatchObject({ expires_at: iso(T0 + 30 * DAY), last_notification: 'DID_CHANGE_RENEWAL_STATUS' });
  });

  describe('expires_at never moves backwards', () => {
    const STORED = T0 + 30 * DAY;
    it('an older (late, retried) notification keeps the stored expiry but still records the rest', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).applyNotification(note({ expiresAt: STORED - DAY }));
      expect(db.row('o1')).toMatchObject({ expires_at: iso(STORED), last_notification: 'DID_RENEW' });
    });
    it('a newer expiry is written', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).applyNotification(note({ expiresAt: STORED + DAY }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED + DAY));
    });
    it('no stored expiry takes the new value', async () => {
      const db = fakePurchasesDb([stored({ expires_at: null })]);
      await supabasePurchases(db.client).applyNotification(note({ expiresAt: STORED }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED));
    });
    it('N1 race: an older retried notification landing after a newer verify never puts the older expiry back', async () => {
      const db = fakePurchasesDb([stored()], {
        onRead: (rows) => Object.assign(rows.get('o1')!, { expires_at: iso(STORED + 30 * DAY) }),
      });
      await supabasePurchases(db.client).applyNotification(note({ expiresAt: STORED + DAY }));
      expect(db.row('o1')!.expires_at).toBe(iso(STORED + 30 * DAY));
    });

    it('a read error throws (Apple retries) and nothing is written', async () => {
      const db = fakePurchasesDb([stored()], { readError: 'boom' });
      await expect(supabasePurchases(db.client).applyNotification(note({ expiresAt: STORED }))).rejects.toThrow(/applyNotification/);
      expect(db.log).toEqual([]);
    });
  });

  describe('revocations', () => {
    it('sets revoked_at when given', async () => {
      const db = fakePurchasesDb([stored()]);
      await supabasePurchases(db.client).applyNotification(note({ revokedAt: 7000, type: 'REFUND' }));
      expect(db.row('o1')!.revoked_at).toBe(iso(7000));
    });
    it('clearRevoked sets revoked_at to null, and wins over a revokedAt', async () => {
      for (const revokedAt of [null, 7000]) {
        const db = fakePurchasesDb([stored({ revoked_at: iso(6000) })]);
        await supabasePurchases(db.client).applyNotification(note({ revokedAt, clearRevoked: true, type: 'REFUND_REVERSED', expiresAt: 9000 }));
        expect(db.row('o1')).toMatchObject({ revoked_at: null, last_notification: 'REFUND_REVERSED' });
      }
    });
    it('clearRevokedBefore clears only revocations older than the purchase', async () => {
      const older = fakePurchasesDb([stored({ revoked_at: iso(T0 - DAY) })]);
      await supabasePurchases(older.client).applyNotification(note({ type: 'SUBSCRIBED', clearRevokedBefore: T0 }));
      expect(older.row('o1')!.revoked_at).toBeNull();
      const newer = fakePurchasesDb([stored({ revoked_at: iso(T0 + DAY) })]);
      await supabasePurchases(newer.client).applyNotification(note({ type: 'SUBSCRIBED', clearRevokedBefore: T0 }));
      expect(newer.row('o1')!.revoked_at).toBe(iso(T0 + DAY));
    });
    it('without clearRevokedBefore issues no clear', async () => {
      const db = fakePurchasesDb([stored({ revoked_at: iso(T0 - DAY) })]);
      await supabasePurchases(db.client).applyNotification(note());
      expect(db.row('o1')!.revoked_at).toBe(iso(T0 - DAY));
    });
  });

  describe('fix48: an upgrade from yearly to a higher monthly (notifications)', () => {
    const YEARLY = stored({ product_id: `${P}hosting.yearly`, expires_at: iso(T0 + 365 * DAY) });
    const UPGRADE = note({
      type: 'DID_CHANGE_RENEWAL_PREF', productId: `${P}store.monthly`, purchasedAt: T0 + 30 * DAY, expiresAt: T0 + 60 * DAY,
    });

    it('UPGRADE moves product, purchase date and expiry to the new transaction (expiry earlier than before)', async () => {
      const db = fakePurchasesDb([YEARLY]);
      await supabasePurchases(db.client).applyNotification(UPGRADE);
      expect(db.row('o1')).toMatchObject({
        product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + 30 * DAY), expires_at: iso(T0 + 60 * DAY),
        last_notification: 'DID_CHANGE_RENEWAL_PREF',
      });
    });

    it('a late retried notification of the old yearly transaction changes neither product nor expiry', async () => {
      const db = fakePurchasesDb([YEARLY]);
      const repo = supabasePurchases(db.client);
      await repo.applyNotification(UPGRADE);
      await repo.applyNotification(note({ type: 'DID_RENEW', productId: `${P}hosting.yearly`, purchasedAt: T0, expiresAt: T0 + 365 * DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 60 * DAY) });
    });

    it('the upgraded-away transaction (isUpgraded) arriving after the upgrade never puts the yearly expiry back', async () => {
      const db = fakePurchasesDb([YEARLY]);
      const repo = supabasePurchases(db.client);
      await repo.applyNotification(UPGRADE);
      await repo.applyNotification(note({
        type: 'DID_CHANGE_RENEWAL_PREF', productId: `${P}hosting.yearly`, purchasedAt: T0, expiresAt: T0 + 365 * DAY,
        isUpgraded: true, revokedAt: T0 + 30 * DAY,
      }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 60 * DAY), revoked_at: null });
    });

    it('an isUpgraded transaction still fills an empty expiry on a row we had none for', async () => {
      const db = fakePurchasesDb();
      await supabasePurchases(db.client).applyNotification(note({ purchasedAt: T0, isUpgraded: true, expiresAt: T0 + 365 * DAY }));
      expect(db.row('o1')!.expires_at).toBe(iso(T0 + 365 * DAY));
    });

    it('then EXPIRED (user cancelled the monthly) leaves a row the sweep picks up one hour after the monthly end', async () => {
      const db = fakePurchasesDb([YEARLY]);
      const repo = supabasePurchases(db.client);
      await repo.applyNotification(UPGRADE);
      await repo.applyNotification(note({ type: 'EXPIRED', productId: `${P}store.monthly`, purchasedAt: T0 + 30 * DAY, expiresAt: T0 + 60 * DAY }));
      expect(isLapsed(db.row('o1') as any, T0 + 60 * DAY + GRACE_MS)).toBe(true);
    });

    it('a downgrade at renewal (store.monthly -> hosting.yearly) moves the expiry forward as before', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly`, expires_at: iso(T0 + 30 * DAY) })]);
      await supabasePurchases(db.client).applyNotification(note({ productId: `${P}hosting.yearly`, purchasedAt: T0 + 30 * DAY, expiresAt: T0 + 395 * DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}hosting.yearly`, expires_at: iso(T0 + 395 * DAY) });
    });
  });

  describe('product_id never moves backwards (Phase 4 tiers)', () => {
    it('a DID_RENEW for a lower tier with a newer purchase date downgrades the product', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly` })]);
      await supabasePurchases(db.client).applyNotification(note({ purchasedAt: T0 + 30 * DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}hosting.monthly`, product_purchased_at: iso(T0 + 30 * DAY) });
    });
    it('an older (late, retried) notification keeps the stored product', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly` })]);
      await supabasePurchases(db.client).applyNotification(note({ purchasedAt: T0 - DAY }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0) });
    });
    it('isUpgraded with a revokedAt: no revoked_at and no product write', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly` })]);
      await supabasePurchases(db.client).applyNotification(note({ purchasedAt: T0 + DAY, isUpgraded: true, revokedAt: T0 + DAY, type: 'REFUND' }));
      expect(db.row('o1')).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: iso(T0), revoked_at: null });
    });
    it('isUpgraded on a purchase we have no row for inserts its product undated (any later write wins)', async () => {
      const db = fakePurchasesDb();
      await supabasePurchases(db.client).applyNotification(note({ purchasedAt: T0, isUpgraded: true }));
      expect(db.row('o1')!.product_id).toBe(`${P}hosting.monthly`);
      expect(db.row('o1')!.product_purchased_at ?? null).toBeNull();
    });
    it('race: an UPGRADE landing between a stale notification\'s read and write is not undone', async () => {
      const db = fakePurchasesDb([stored()], {
        onRead: (rows) => Object.assign(rows.get('o1')!, { product_id: `${P}store.monthly`, product_purchased_at: iso(T0 + DAY) }),
      });
      await supabasePurchases(db.client).applyNotification(note({ purchasedAt: T0 }));
      expect(db.row('o1')!.product_id).toBe(`${P}store.monthly`);
    });
    it('race: a finished downgrade is not re-raised by a stale higher-tier notification', async () => {
      const db = fakePurchasesDb([stored({ product_id: `${P}store.monthly` })], {
        onRead: (rows) => Object.assign(rows.get('o1')!, { product_id: `${P}hosting.monthly`, product_purchased_at: iso(T0 + 30 * DAY) }),
      });
      await supabasePurchases(db.client).applyNotification(note({ productId: `${P}store.monthly`, purchasedAt: T0 }));
      expect(db.row('o1')!.product_id).toBe(`${P}hosting.monthly`);
    });
  });
});
