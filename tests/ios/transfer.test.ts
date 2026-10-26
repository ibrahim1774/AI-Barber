import { describe, it, expect, vi, afterEach } from 'vitest';
import { runTransfer, type TransferDeps } from '../../lib/ios/transfer.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { fakePurchasesDb } from './fakePurchasesDb.js';

const NOW = 1_800_000_000_000;
const OTID = '2000000123';
const O = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = 'bbbbbbbb-2222-4222-8222-222222222222';
const B = 'cccccccc-3333-4333-8333-333333333333';
const TX: VerifiedTx = { originalTransactionId: OTID, transactionId: '2000000555', productId: 'com.ibrahim1774.aibarber.store.monthly', environment: 'Production', expiresAt: NOW + 86_400_000, revoked: false, status: 1, productPurchasedAt: NOW - 1000 };
const base = { original_transaction_id: OTID, product_id: TX.productId, environment: 'Production', site_slug: null, user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null, lapse_checked_at: null, removed_at: null };
const liveSite = { site_slug: 'fade-lab', published_at: '2026-10-01T00:00:00Z' };
const tok = (owner: string) => `tok:${owner}:${OTID}`;
const CONF = { transactionId: '1', confirm: true, ownerToken: tok(O) };
const tokens: Record<string, string> = { ta: A, tb: B, to: O };

function setup(rows: any[], over: Partial<TransferDeps> & { tx?: VerifiedTx } = {}) {
  const db = fakePurchasesDb(rows);
  const repo = supabasePurchases(db.client);
  const calls: string[] = [];
  const snap = () => ({ ...db.row(OTID) });
  const deps: TransferDeps = {
    verify: async () => over.tx ?? TX,
    repo,
    userOf: async (t) => (tokens[t] ? { id: tokens[t] } : null),
    emailOf: async (id) => (id === O ? 'alice@gmail.com' : null),
    allow: async () => true,
    takedown: {
      now: () => NOW,
      deployOffline: async (slug) => { calls.push(`offline:${slug}:owner=${snap().user_id}:slug=${snap().site_slug}`); },
    },
    detachShop: async (otid, caller) => { calls.push(`detach:${otid}:${caller === A ? 'A' : 'B'}`); },
    ownerToken: (o, t) => `tok:${o}:${t}`,
    ...over,
  };
  return { db, deps, calls };
}
const call = (s: ReturnType<typeof setup>, body: unknown, token: string | null = 'ta') =>
  runTransfer(body, s.deps, { authorization: token ? `Bearer ${token}` : undefined });

afterEach(() => vi.restoreAllMocks());

describe('POST /api/ios/transfer', () => {
  it('no / bad token is 401 and nothing is verified or written', async () => {
    const verify = vi.fn(async () => TX);
    const s = setup([{ ...base, user_id: O }], { verify });
    expect((await call(s, { transactionId: '1' }, null)).status).toBe(401);
    expect((await call(s, { transactionId: '1' }, 'nope')).status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(s.db.log).toHaveLength(0);
  });

  it('an auth outage is 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup([], { userOf: async () => { throw new Error('down'); } });
    expect((await call(s, { transactionId: '1' })).status).toBe(503);
  });

  it('bad body: missing / oversized id, non-boolean confirm -> 400', async () => {
    const s = setup([{ ...base, user_id: O }]);
    for (const b of [{}, { transactionId: '' }, { transactionId: 5 }, { transactionId: 'x'.repeat(65) }, null, { transactionId: '1', confirm: 'true' }, { transactionId: '1', confirm: 1 }]) {
      expect(await call(s, b)).toEqual({ status: 400, body: { error: 'bad-request' } });
    }
    expect(s.db.row(OTID)!.user_id).toBe(O);
  });

  it('rate limited -> 429; a limiter that throws fails CLOSED (503), Apple never asked', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const verify = vi.fn(async () => TX);
    expect((await call(setup([], { allow: async () => false, verify }), { transactionId: '1' })).status).toBe(429);
    expect((await call(setup([], { allow: async () => { throw new Error('store'); }, verify }), { transactionId: '1' })).status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it('Apple failures map to 404 / 400 / 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const [code, status] of [['not-found', 404], ['bad-bundle', 400], ['bad-product', 400], ['apple-unavailable', 503]] as const) {
      const s = setup([{ ...base, user_id: O }], { verify: async () => { throw new VerifyFailure(code); } });
      expect((await call(s, CONF)).status).toBe(status);
      expect(s.db.row(OTID)!.user_id).toBe(O);
    }
  });

  describe('inactive purchase cannot move', () => {
    it.each([
      ['expired', { ...TX, expiresAt: NOW - 1000, status: 2 } as VerifiedTx, {}, 402],
      ['revoked per Apple', { ...TX, revoked: true } as VerifiedTx, {}, 402],
      ['revoked in our row (newer than Apple answer)', TX, { revoked_at: '2030-01-01T00:00:00Z' }, 402],
    ])('%s: 402 subscription-inactive, owner and site untouched, no takedown', async (_n, tx, over, status) => {
      const s = setup([{ ...base, user_id: O, ...liveSite, ...over }], { tx });
      const r = await call(s, CONF);
      expect(r.status).toBe(status);
      expect((r.body as any).error).toBe('subscription-inactive');
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.db.row(OTID)!.site_slug).toBe('fade-lab');
      expect(s.calls).toEqual([]);
    });
    it('revoked reports reason', async () => {
      const s = setup([{ ...base, user_id: O }], { tx: { ...TX, revoked: true } });
      expect(await call(s, CONF)).toEqual({ status: 402, body: { error: 'subscription-inactive', reason: 'revoked' } });
    });
  });

  it('unlinked purchase: linked to the caller, moved:false', async () => {
    const s = setup([{ ...base }]);
    expect(await call(s, { transactionId: '1' })).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(s.db.row(OTID)!.user_id).toBe(A);
    expect(s.calls).toEqual([]);
  });

  it('unlinked, no row yet (verified fresh): created and linked', async () => {
    const s = setup([]);
    expect(await call(s, { transactionId: '1' })).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(s.db.row(OTID)!.user_id).toBe(A);
  });

  it('unlinked, caller already holds a live site under a different purchase: 409 account-has-site, not linked', async () => {
    const s = setup([{ ...base }, { ...base, original_transaction_id: '999', user_id: A, ...liveSite, site_slug: 'mine' }]);
    expect(await call(s, { transactionId: '1' })).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'mine' } });
    expect(s.db.row(OTID)!.user_id).toBeNull();
  });

  it('unlinked legacy slug owned by another account: 409 purchase-other-account, nothing linked', async () => {
    const s = setup([{ ...base, ...liveSite }], { bindingOwner: async () => O });
    const r = await call(s, { transactionId: '1' });
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true } });
    expect(s.db.row(OTID)!.user_id).toBeNull();
  });

  it('already linked to the caller: moved:false, idempotent, nothing written', async () => {
    const s = setup([{ ...base, user_id: A, ...liveSite }]);
    expect(await call(s, CONF)).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(s.db.row(OTID)!.site_slug).toBe('fade-lab');
    expect(s.calls).toEqual([`detach:${OTID}:A`]); // only the idempotent detach of other accounts shops
  });

  describe('linked to another account O', () => {
    it('no confirm: 409 confirm-required with masked hint, live site and its url; WRITES NOTHING', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const before = JSON.stringify(s.db.row(OTID));
      const r = await call(s, { transactionId: '1' });
      expect(r).toEqual({ status: 409, body: { error: 'confirm-required', ownerHint: 'a***@gmail.com', hasLiveSite: true, ownerToken: tok(O), siteUrl: 'https://fade-lab.vercel.app' } });
      expect(s.calls).toEqual([]);
      // no ownership / site writes (Apple's refresh only touches verify bookkeeping)
      const after = s.db.row(OTID)!;
      expect(after.user_id).toBe(O);
      expect(after.site_slug).toBe('fade-lab');
      expect(after.taken_down_at).toBeNull();
      expect(after.removed_at).toBeNull();
      expect(s.db.log.filter((l) => l.payload && 'user_id' in l.payload)).toEqual([]);
      void before;
    });

    it.each([[{ confirm: false }], [{ confirm: null }], [{}]])('confirm %j is not a yes', async (extra) => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const r = await call(s, { transactionId: '1', ...extra });
      expect(r.status).toBe(409);
      expect((r.body as any).error).toBe('confirm-required');
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.calls).toEqual([]);
    });

    it('no confirm, O has no live site: hasLiveSite false and no siteUrl; unknown email -> ownerHint null', async () => {
      const s = setup([{ ...base, user_id: O }], { emailOf: async () => null });
      expect(await call(s, { transactionId: '1' })).toEqual({ status: 409, body: { error: 'confirm-required', ownerHint: null, hasLiveSite: false, ownerToken: tok(O) } });
    });

    it('O site already taken down or removed is not live', async () => {
      for (const over of [{ taken_down_at: '2026-10-05T00:00:00Z' }, { removed_at: '2026-10-05T00:00:00Z' }, { published_at: null }]) {
        const s = setup([{ ...base, user_id: O, ...liveSite, ...over }]);
        expect(((await call(s, { transactionId: '1' })).body as any).hasLiveSite).toBe(false);
      }
    });

    it('confirm:true: CAS first, THEN O\'s site goes offline, slug cleared, shop detached, 200 moved', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const r = await call(s, CONF);
      expect(r).toEqual({ status: 200, body: { moved: true, linked: true } });
      // every takedown step saw the purchase already owned by the caller (CAS happened before it)
      // the offline deploy ran when the purchase was already the caller's and the slug already detached
      expect(s.calls).toEqual([`offline:fade-lab:owner=${A}:slug=null`, `detach:${OTID}:A`]);
      const row = s.db.row(OTID)!;
      expect(row).toMatchObject({ user_id: A, site_slug: null, published_at: null, taken_down_at: null, removed_at: null });
      expect(log).toHaveBeenCalledWith(`ios-transfer otid=0123 from=aaaaaaaa to=bbbbbbbb`);
    });

    it('does not delete anything: only the takedown pieces exist in the deps (no purge / deleteContent / releaseDomains)', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect(Object.keys(s.deps.takedown).sort()).toEqual(['deployOffline', 'now']);
    });

    it('O has no published site: nothing is deployed, still moves and detaches', async () => {
      const s = setup([{ ...base, user_id: O }]);
      expect(await call(s, CONF)).toEqual({ status: 200, body: { moved: true, linked: true } });
      expect(s.calls).toEqual([`detach:${OTID}:A`]);
      expect(s.db.row(OTID)!.user_id).toBe(A);
    });

    it('O bound a slug but never published: slug cleared without any deploy', async () => {
      const s = setup([{ ...base, user_id: O, site_slug: 'draft-slug' }]);
      await call(s, CONF);
      expect(s.calls).toEqual([`detach:${OTID}:A`]);
      expect(s.db.row(OTID)!.site_slug).toBeNull();
    });

    it('O already removed its own site: no second takedown, slug still released', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite, removed_at: '2026-10-05T00:00:00Z', taken_down_at: '2026-10-05T00:00:00Z' }]);
      expect((await call(s, CONF)).status).toBe(200);
      expect(s.calls).toEqual([`detach:${OTID}:A`]);
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: null, removed_at: null, taken_down_at: null });
    });

    it('caller with a live site under a different purchase: 409 account-has-site, NOTHING changes', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }, { ...base, original_transaction_id: '999', user_id: A, ...liveSite, site_slug: 'mine' }]);
      const r = await call(s, CONF);
      expect(r).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'mine' } });
      expect(s.db.row(OTID)).toMatchObject({ user_id: O, site_slug: 'fade-lab' });
      expect(s.calls).toEqual([]);
      expect(s.db.log.filter((l) => l.op === 'update' && l.payload && 'user_id' in l.payload)).toEqual([]);
    });

    it('a caller whose other purchase has no site (or a removed one) may take it', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }, { ...base, original_transaction_id: '999', user_id: A }, { ...base, original_transaction_id: '998', user_id: A, site_slug: 'old', removed_at: '2026-10-01T00:00:00Z' }]);
      expect((await call(s, CONF)).body).toEqual({ moved: true, linked: true });
    });

    it('CAS lost (changed before the CAS): 409 purchase-changed and NOTHING else happens', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      // someone moves it to B right after we read it
      const real = s.deps.repo.upsertVerified.bind(s.deps.repo);
      s.deps.repo.upsertVerified = async (tx, o) => { const r = await real(tx, o); s.db.row(OTID)!.user_id = B; return r; };
      const r = await call(s, CONF);
      expect(r).toEqual({ status: 409, body: { error: 'purchase-changed' } });
      expect(s.calls).toEqual([]);
      expect(s.db.row(OTID)).toMatchObject({ user_id: B, site_slug: 'fade-lab', removed_at: null, taken_down_at: null });
    });

    it('RACE: two callers confirm at once, exactly one wins; only the winner takes the site offline', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const [ra, rb] = await Promise.all([call(s, CONF, 'ta'), call(s, CONF, 'tb')]);
      const results = [ra, rb];
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409 && (r.body as any).error === 'purchase-changed')).toHaveLength(1);
      const winner = ra.status === 200 ? A : B;
      expect(s.db.row(OTID)!.user_id).toBe(winner);
      expect(s.calls.filter((c) => c.startsWith('offline:'))).toEqual([`offline:fade-lab:owner=${winner}:slug=null`]);
      expect(s.calls.filter((c) => c.startsWith('detach:'))).toHaveLength(1);
    });

    it('the offline deploy failing after the CAS (retried once) reverses the move exactly (503)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      let n = 0;
      s.deps.takedown.deployOffline = async () => { n++; throw new Error('vercel down'); };
      const r = await call(s, CONF);
      expect(r).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
      expect(n).toBe(2);
      expect(s.db.row(OTID)).toMatchObject({ user_id: O, site_slug: 'fade-lab', published_at: liveSite.published_at, removed_at: null, taken_down_at: null });
      expect(s.calls.some((c) => c.startsWith('detach:'))).toBe(false);
    });

    it('a transient deploy failure succeeds on the in-request retry', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      let n = 0;
      s.deps.takedown.deployOffline = async () => { if (n++ === 0) throw new Error('blip'); };
      expect((await call(s, CONF)).body).toEqual({ moved: true, linked: true });
    });

    it('an UNKNOWN deploy outcome reverses with taken_down_at stamped (the sweep restores an active site)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.deps.takedown.deployOffline = async () => { throw Object.assign(new Error('timeout'), { indefinite: true }); };
      expect((await call(s, CONF)).status).toBe(503);
      expect(s.db.row(OTID)).toMatchObject({ user_id: O, site_slug: 'fade-lab', removed_at: null });
      expect(s.db.row(OTID)!.taken_down_at).not.toBeNull();
    });

    it('deploy fails AND the reverse fails: ALERT logged, but the caller has NO slug (O\'s data unreachable)', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.deps.takedown.deployOffline = async () => { throw new Error('down'); };
      s.deps.repo.revertMove = async () => { throw new Error('db'); };
      expect((await call(s, CONF)).status).toBe(503);
      expect(err.mock.calls.some((c) => /ALERT/.test(String(c[0])))).toBe(true);
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: null, published_at: null });
    });

    it('detach failing leaves the caller with no slug; a retry (already the caller\'s) finishes the detach', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      let fail = true;
      const real = s.deps.detachShop;
      s.deps.detachShop = async (o, c) => { if (fail) throw new Error('db'); return real(o, c); };
      expect((await call(s, CONF)).status).toBe(503);
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: null });
      fail = false;
      expect(await call(s, { transactionId: '1' })).toEqual({ status: 200, body: { moved: false, linked: true } });
      expect(s.calls).toContain(`detach:${OTID}:A`);
    });

    it('a failure right after the move (any step) never leaves O\'s slug on the caller', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.deps.detachShop = async () => { throw new Error('x'); };
      await call(s, CONF);
      const row = s.db.row(OTID)!;
      expect(row.user_id).toBe(A);
      expect(row.site_slug).toBeNull();
      expect(row.published_at).toBeNull();
    });

    it('owner changed between the probe and the confirm (stale ownerToken): 409 purchase-changed, nothing happens', async () => {
      const s = setup([{ ...base, user_id: B, ...liveSite }]);
      const r = await call(s, CONF); // token is for O, the owner is now B
      expect(r).toEqual({ status: 409, body: { error: 'purchase-changed' } });
      expect(s.calls).toEqual([]);
      expect(s.db.row(OTID)).toMatchObject({ user_id: B, site_slug: 'fade-lab' });
    });

    it('confirm:true without an ownerToken is 400 and changes nothing; a wrong token is purchase-changed', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect(await call(s, { transactionId: '1', confirm: true })).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect(await call(s, { transactionId: '1', confirm: true, ownerToken: 'x' })).toEqual({ status: 409, body: { error: 'purchase-changed' } });
      expect(await call(s, { transactionId: '1', confirm: true, ownerToken: 5 })).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.calls).toEqual([]);
    });

    it('detach never touches the caller\'s own shop: it is told who the caller is', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      await call(s, CONF);
      expect(s.calls).toContain(`detach:${OTID}:A`);
    });

    it('logs carry no email and no full ids', async () => {
      const lines: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...a) => { lines.push(a.join(' ')); });
      vi.spyOn(console, 'warn').mockImplementation((...a) => { lines.push(a.join(' ')); });
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      await call(s, CONF);
      const wire = lines.join('\n');
      expect(wire).toMatch(/^ios-transfer otid=0123 from=aaaaaaaa to=bbbbbbbb$/m);
      expect(wire).not.toMatch(/alice|gmail|@|2000000123|aaaaaaaa-1111|bbbbbbbb-2222/);
    });
  });

  it('a repo without the move methods is 503 (never moves)', async () => {
    const s = setup([{ ...base, user_id: O }]);
    delete (s.deps.repo as any).moveUserAndRelease;
    expect((await call(s, CONF)).status).toBe(503);
  });

  it('conditional stamps: markPublished / clearTakenDown from the OLD owner cannot land on the moved row', async () => {
    const s = setup([{ ...base, user_id: A, site_slug: null, published_at: null, taken_down_at: '2026-10-05T00:00:00Z' }]);
    await s.deps.repo.markPublished(OTID, { userId: O, slug: 'fade-lab' });
    await s.deps.repo.clearTakenDown(OTID, { userId: O, slug: 'fade-lab' });
    expect(s.db.row(OTID)).toMatchObject({ published_at: null, taken_down_at: '2026-10-05T00:00:00Z' });
    await s.deps.repo.clearTakenDown(OTID, { userId: A, slug: 'x' });
    expect(s.db.row(OTID)!.taken_down_at).toBe('2026-10-05T00:00:00Z');
  });
});
