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
const TX: VerifiedTx = { originalTransactionId: OTID, transactionId: '2000000555', latestTransactionId: '2000000555', productId: 'com.ibrahim1774.aibarber.store.monthly', environment: 'Production', expiresAt: NOW + 86_400_000, revoked: false, status: 1, productPurchasedAt: NOW - 1000 };
const base = { original_transaction_id: OTID, product_id: TX.productId, environment: 'Production', site_slug: null, user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null, taken_down_at: null, lapse_checked_at: null, removed_at: null };
const liveSite = { site_slug: 'fade-lab', published_at: '2026-10-01T00:00:00Z' };
const tok = (owner: string) => `tok:${owner}:${OTID}`;
const CONF = { transactionId: '1', confirm: true, ownerToken: tok(O) };
const BUNDLE = 'com.ibrahim1774.aibarber';
const proofFor = (jws: string) => {
  // jws string encodes the payload for the fake decoder: 'ok', 'stale', 'other-otid', 'other-bundle', 'other-env'
  const d = { originalTransactionId: OTID, transactionId: '2000000555', productId: TX.productId, bundleId: BUNDLE, environment: 'Production', signedDate: NOW - 60_000 } as any;
  if (jws === 'stale') d.signedDate = NOW - 46 * 86_400_000;
  if (jws === 'old-ok') d.signedDate = NOW - 44 * 86_400_000;
  if (jws === 'future') d.signedDate = NOW + 6 * 60_000;
  if (jws === 'old-renewal') d.transactionId = '2000000111';
  if (jws === 'nodate') delete d.signedDate;
  if (jws === 'other-otid') d.originalTransactionId = '999';
  if (jws === 'other-bundle') d.bundleId = 'com.evil';
  if (jws === 'other-env') d.environment = 'Sandbox';
  if (jws === 'edge') d.signedDate = NOW - 45 * 86_400_000;
  return d;
};
const tokens: Record<string, string> = { ta: A, tb: B, to: O };

function setup(rows: any[], over: Partial<TransferDeps> & { tx?: VerifiedTx } = {}) {
  const db = fakePurchasesDb(rows);
  const repo = supabasePurchases(db.client);
  const calls: string[] = [];
  const snap = () => ({ ...db.row(OTID) });
  const store = new Map<string, any>();
  const intents = {
    async begin(i: any) { if (state.failBegin) throw new Error('db'); store.set(`${i.otid}:${i.to}`, { ...i }); calls.push(`intent:${i.otid}:from=${i.from === O ? 'O' : i.from}:owner=${snap().user_id}`); },
    async find(otid: string, to: string) { return store.get(`${otid}:${to}`) ?? null; },
    async pendingFor() { return []; }, async pendingFrom() { return []; },
    async pendingForOtid(otid: string) { return [...store.values()].filter((i: any) => i.otid === otid); },
    async finish(otid: string, to: string) { store.delete(`${otid}:${to}`); calls.push('finish'); },
    async cancel(otid: string, to: string) { store.delete(`${otid}:${to}`); calls.push('cancel'); },
  };
  const state = { hasShop: false, failBegin: false, failMove: false, shops: {} as Record<string, { id: string; ios_otid: string | null }> };
  const deps: TransferDeps = {
    verify: async () => over.tx ?? TX,
    repo,
    userOf: async (t) => (tokens[t] ? { id: tokens[t] } : null),
    emailOf: async (id) => (id === O ? 'alice@gmail.com' : null),
    allow: async () => true,
    now: () => NOW,
    shopSummary: async () => ({ hasShop: state.hasShop }),
    intents,
    shopOf: async (u) => state.shops[u] ?? null,
    moveBusiness: async (otid, from, caller, slug) => {
      if (state.failMove) throw new Error('db');
      calls.push(`move:${otid}:from=${from === O ? 'O' : from}:${caller === A ? 'A' : 'B'}:${slug}:owner=${snap().user_id}`);
    },
    decodeProof: async (env, jws) => {
      if (jws === 'bad-sig') throw new Error('VerificationException');
      if (jws === 'down') throw new VerifyFailure('apple-unavailable');
      return proofFor(jws);
    },
    bundleId: BUNDLE,
    requireProof: false,
    ownerToken: (o, t) => `tok:${o}:${t}`,
    ...over,
  };
  return { db, deps, calls, state, store };
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
    expect(await call(s, { transactionId: '1' })).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'mine', reason: 'site' } });
    expect(s.db.row(OTID)!.user_id).toBeNull();
  });

  it('unlinked legacy slug owned by another account: 409 purchase-other-account, nothing linked', async () => {
    const s = setup([{ ...base, ...liveSite }], { bindingOwner: async () => O });
    const r = await call(s, { transactionId: '1' });
    expect(r).toEqual({ status: 409, body: { error: 'purchase-other-account', hint: 'a***@gmail.com', ownerHint: 'a***@gmail.com', hasLiveSite: true } });
    expect(s.db.row(OTID)!.user_id).toBeNull();
  });

  it('already linked to the caller WITHOUT an intent row: moved:false and NOTHING is moved (H2), whoever owns the shop/site of this otid', async () => {
    const s = setup([{ ...base, user_id: A, ...liveSite }]);
    expect(await call(s, CONF)).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(await call(s, { transactionId: '1' })).toEqual({ status: 200, body: { moved: false, linked: true } });
    expect(s.db.row(OTID)!.site_slug).toBe('fade-lab');
    expect(s.calls).toEqual([]);
  });

  describe('linked to another account O', () => {
    it('no confirm: 409 confirm-required with masked hint, hasLiveSite, hasShop, url; WRITES NOTHING', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.state.hasShop = true;
      const r = await call(s, { transactionId: '1' });
      expect(r).toEqual({ status: 409, body: { error: 'confirm-required', ownerHint: 'a***@gmail.com', hasLiveSite: true, hasShop: true, ownerToken: tok(O), siteUrl: 'https://fade-lab.vercel.app' } });
      expect(s.calls).toEqual([]);
      expect(s.db.row(OTID)).toMatchObject({ user_id: O, site_slug: 'fade-lab', taken_down_at: null, removed_at: null });
      expect(s.db.log.filter((l) => l.payload && 'user_id' in l.payload)).toEqual([]);
    });

    it.each([[{ confirm: false }], [{ confirm: null }], [{}]])('confirm %j is not a yes', async (extra) => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const r = await call(s, { transactionId: '1', ...extra });
      expect(r.status).toBe(409);
      expect((r.body as any).error).toBe('confirm-required');
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.calls).toEqual([]);
    });

    it('no site, no shop: hasLiveSite false, hasShop false, no siteUrl; unknown email -> ownerHint null', async () => {
      const s = setup([{ ...base, user_id: O }], { emailOf: async () => null });
      expect(await call(s, { transactionId: '1' })).toEqual({ status: 409, body: { error: 'confirm-required', ownerHint: null, hasLiveSite: false, hasShop: false, ownerToken: tok(O) } });
    });

    it('a taken-down or removed site is not live', async () => {
      for (const over of [{ taken_down_at: '2026-10-05T00:00:00Z' }, { removed_at: '2026-10-05T00:00:00Z' }, { published_at: null }]) {
        const s = setup([{ ...base, user_id: O, ...liveSite, ...over }]);
        expect(((await call(s, { transactionId: '1' })).body as any).hasLiveSite).toBe(false);
      }
    });

    it('confirm:true: intent recorded, THEN the CAS, THEN the business moves from O; the site stays live; nothing offline', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(await call(s, CONF)).toEqual({ status: 200, body: { moved: true, linked: true } });
      // the intent was written while the purchase was still O's; moveBusiness ran when it was already the caller's
      expect(s.calls).toEqual([`intent:${OTID}:from=O:owner=${O}`, `move:${OTID}:from=O:A:fade-lab:owner=${A}`, 'finish']);
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: 'fade-lab', published_at: liveSite.published_at, taken_down_at: null, removed_at: null });
      expect(log).toHaveBeenCalledWith(`ios-transfer otid=0123 from=aaaaaaaa to=bbbbbbbb`);
    });

    it('the slug is re-read AFTER the CAS (a publish that bound one meanwhile)', async () => {
      const s = setup([{ ...base, user_id: O }]);
      const real = s.deps.repo.transferUser!.bind(s.deps.repo);
      s.deps.repo.transferUser = async (o, f, t) => { const r = await real(o, f, t); s.db.row(OTID)!.site_slug = 'late-slug'; return r; };
      await call(s, CONF);
      expect(s.calls).toContain(`move:${OTID}:from=O:A:late-slug:owner=${A}`);
    });

    it('an intent that cannot be recorded stops BEFORE the CAS (503, nothing moved)', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.state.failBegin = true;
      expect((await call(s, CONF)).status).toBe(503);
      expect(s.db.row(OTID)!.user_id).toBe(O);
    });

    it('there is no takedown or deletion capability in the deps at all', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect(Object.keys(s.deps)).not.toEqual(expect.arrayContaining(['takedown']));
      for (const k of ['takedown', 'purge', 'deleteContent', 'releaseDomains', 'detachShop']) expect(k in s.deps).toBe(false);
    });

    it('O has no site and no shop: still moves (slug null)', async () => {
      const s = setup([{ ...base, user_id: O }]);
      expect((await call(s, CONF)).status).toBe(200);
      expect(s.calls).toContain(`move:${OTID}:from=O:A:null:owner=${A}`);
    });

    it('a removed site moves too (state is preserved, not cleared)', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite, removed_at: '2026-10-05T00:00:00Z', taken_down_at: '2026-10-05T00:00:00Z' }]);
      expect((await call(s, CONF)).status).toBe(200);
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: 'fade-lab', removed_at: '2026-10-05T00:00:00Z' });
    });

    it('caller with a live site under a different purchase: 409 account-has-site (site), NOTHING changes', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }, { ...base, original_transaction_id: '999', user_id: A, ...liveSite, site_slug: 'mine' }]);
      expect(await call(s, CONF)).toEqual({ status: 409, body: { error: 'account-has-site', slug: 'mine', reason: 'site' } });
      expect(s.db.row(OTID)).toMatchObject({ user_id: O, site_slug: 'fade-lab' });
      expect(s.calls).toEqual([]);
      expect(s.db.log.filter((l) => l.op === 'update' && l.payload && 'user_id' in l.payload)).toEqual([]);
    });

    it('caller with a shop of their own (not this purchase): 409 account-has-site (shop), NOTHING changes', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.state.shops[A] = { id: 'shop-a', ios_otid: null };
      expect(await call(s, CONF)).toEqual({ status: 409, body: { error: 'account-has-site', slug: '', reason: 'shop' } });
      s.state.shops[A] = { id: 'shop-a', ios_otid: '777' };
      expect((await call(s, CONF)).status).toBe(409);
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.calls).toEqual([]);
    });

    it('a caller whose other purchase has no site (or a removed one) may take it', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }, { ...base, original_transaction_id: '999', user_id: A }, { ...base, original_transaction_id: '998', user_id: A, site_slug: 'old', removed_at: '2026-10-01T00:00:00Z' }]);
      expect((await call(s, CONF)).body).toMatchObject({ moved: true, linked: true });
    });

    it('CAS lost (changed before the CAS): 409 purchase-changed, the intent is cancelled and NOTHING else happens', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const real = s.deps.repo.upsertVerified.bind(s.deps.repo);
      s.deps.repo.upsertVerified = async (tx, o) => { const r = await real(tx, o); s.db.row(OTID)!.user_id = B; return r; };
      expect(await call(s, CONF)).toEqual({ status: 409, body: { error: 'purchase-changed' } });
      expect(s.calls).toEqual([`intent:${OTID}:from=O:owner=${B}`, 'cancel']);
      expect(s.store.size).toBe(0);
      expect(s.db.row(OTID)).toMatchObject({ user_id: B, site_slug: 'fade-lab' });
    });

    it('RACE: two callers confirm at once, exactly one wins; only the winner moves the business', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const [ra, rb] = await Promise.all([call(s, CONF, 'ta'), call(s, CONF, 'tb')]);
      expect([ra, rb].filter((r) => r.status === 200)).toHaveLength(1);
      expect([ra, rb].filter((r) => r.status === 409 && (r.body as any).error === 'purchase-changed')).toHaveLength(1);
      const winner = ra.status === 200 ? A : B;
      expect(s.db.row(OTID)!.user_id).toBe(winner);
      expect(s.calls.filter((c) => c.startsWith('move:'))).toEqual([`move:${OTID}:from=O:${winner === A ? 'A' : 'B'}:fade-lab:owner=${winner}`]);
    });

    it('N3: a duplicate confirm that loses to the caller\'s OWN winning request does not cancel the winner\'s intent', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.state.failMove = true; // the winner\'s business step fails after its CAS
      const [r1, r2] = await Promise.all([call(s, CONF), call(s, CONF)]);
      expect([r1.status, r2.status].sort()).toEqual([409, 503]);
      expect(s.db.row(OTID)!.user_id).toBe(A);
      expect(s.store.size).toBe(1); // the intent survives so a retry still finishes the move
      s.state.failMove = false;
      expect((await call(s, { transactionId: '1' })).status).toBe(200);
      expect(s.calls.filter((c) => c.startsWith('move:'))).toEqual([`move:${OTID}:from=O:A:fade-lab:owner=${A}`]);
    });

    it('N3: when the purchase went to someone ELSE the lost-CAS caller\'s intent is cancelled', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      const real = s.deps.repo.upsertVerified.bind(s.deps.repo);
      s.deps.repo.upsertVerified = async (tx, o) => { const r = await real(tx, o); s.db.row(OTID)!.user_id = B; return r; };
      await call(s, CONF);
      expect(s.calls).toContain('cancel');
      expect(s.store.size).toBe(0);
    });

    it('L2: while an unfinished move to account C exists, a move of the same purchase away from C is refused (409 move-in-progress), nothing written', async () => {
      const s = setup([{ ...base, user_id: A, ...liveSite }]);
      s.store.set(`${OTID}:${A}`, { otid: OTID, from: O, to: A, slug: 'fade-lab' });
      const conf = { transactionId: '1', confirm: true, ownerToken: tok(A) };
      expect(await call(s, conf, 'tb')).toEqual({ status: 409, body: { error: 'move-in-progress' } });
      expect(s.db.row(OTID)!.user_id).toBe(A);
      expect(s.store.get(`${OTID}:${A}`).from).toBe(O); // O is still recorded as the previous owner
      expect(s.calls).toEqual([]);
    });

    it('confirm-required and success carry no payment fields any more', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect(Object.keys((await call(s, { transactionId: '1' })).body).sort()).toEqual(['error', 'hasLiveSite', 'hasShop', 'ownerHint', 'ownerToken', 'siteUrl']);
      expect((await call(s, CONF)).body).toEqual({ moved: true, linked: true });
    });

    it('a half-finished move: the business step fails after the CAS (503); the purchase is the caller\'s, the intent stays, nothing is undone', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.state.failMove = true;
      expect(await call(s, CONF)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: 'fade-lab', published_at: liveSite.published_at });
      expect(s.store.size).toBe(1);
      expect(err.mock.calls.some((c) => /ALERT/.test(String(c[0])))).toBe(true);
    });

    it('RETRY completes a half-finished move (intent exists), moves from the RECORDED owner, then closes the intent', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      s.state.failMove = true;
      await call(s, CONF);
      s.state.failMove = false;
      expect(await call(s, { transactionId: '1' })).toEqual({ status: 200, body: { moved: false, linked: true } });
      expect(s.calls.filter((c) => c.startsWith('move:'))).toEqual([`move:${OTID}:from=O:A:fade-lab:owner=${A}`]);
      expect(s.store.size).toBe(0);
      expect(s.db.row(OTID)).toMatchObject({ user_id: A, site_slug: 'fade-lab' });
      // a second retry has no intent any more: moves nothing
      s.calls.length = 0;
      await call(s, { transactionId: '1' });
      expect(s.calls).toEqual([]);
    });

    it('a retry whose business step fails again is 503 (never reports success) and keeps the intent', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: A, ...liveSite }]);
      s.store.set(`${OTID}:${A}`, { otid: OTID, from: O, to: A, slug: 'fade-lab' });
      s.state.failMove = true;
      expect((await call(s, { transactionId: '1' })).status).toBe(503);
      expect(s.store.size).toBe(1);
    });

    it('L2: a purchase that lapsed after the CAS still lets the OWNER finish the move (data only), the answer stays 402', async () => {
      const s = setup([{ ...base, user_id: A, ...liveSite }], { tx: { ...TX, expiresAt: NOW - 1000, status: 2 } });
      s.store.set(`${OTID}:${A}`, { otid: OTID, from: O, to: A, slug: 'fade-lab' });
      expect((await call(s, { transactionId: '1' })).status).toBe(402);
      expect(s.calls).toEqual([`move:${OTID}:from=O:A:fade-lab:owner=${A}`, 'finish']);
    });

    it('L2 negative: an inactive purchase of ANOTHER account finishes nothing', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }], { tx: { ...TX, revoked: true } });
      s.store.set(`${OTID}:${A}`, { otid: OTID, from: O, to: A, slug: 'fade-lab' });
      expect((await call(s, CONF)).status).toBe(402);
      expect(s.calls).toEqual([]);
    });

    it('H2: purchase is C\'s but the shop/site of this otid belongs to X and there is no intent row: a probe or a retry moves nothing', async () => {
      const s = setup([{ ...base, user_id: A, ...liveSite }]);
      for (let i = 0; i < 2; i++) { await call(s, { transactionId: '1' }); await call(s, CONF); }
      expect(s.calls).toEqual([]);
    });

    it('H2: an intent for ANOTHER caller does not let this caller finish anything', async () => {
      const s = setup([{ ...base, user_id: A, ...liveSite }]);
      s.store.set(`${OTID}:${B}`, { otid: OTID, from: O, to: B, slug: 'fade-lab' });
      await call(s, { transactionId: '1' });
      expect(s.calls).toEqual([]);
    });

    it('owner changed between the probe and the confirm (stale ownerToken): 409 purchase-changed, nothing happens', async () => {
      const s = setup([{ ...base, user_id: B, ...liveSite }]);
      expect(await call(s, CONF)).toEqual({ status: 409, body: { error: 'purchase-changed' } });
      expect(s.calls).toEqual([]);
      expect(s.db.row(OTID)).toMatchObject({ user_id: B, site_slug: 'fade-lab' });
    });

    it('confirm:true without an ownerToken is 400; a wrong token is purchase-changed', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect(await call(s, { transactionId: '1', confirm: true })).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect(await call(s, { transactionId: '1', confirm: true, ownerToken: 'x' })).toEqual({ status: 409, body: { error: 'purchase-changed' } });
      expect(await call(s, { transactionId: '1', confirm: true, ownerToken: 5 })).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.calls).toEqual([]);
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

  describe('proof of device (JWS)', () => {
    const withProof = (extra: object = {}) => ({ ...CONF, ...extra });

    it('required (flag on) and missing: 400 proof-required before ANY read or write, including the probe', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }], { requireProof: true });
      expect(await call(s, withProof())).toEqual({ status: 400, body: { error: 'proof-required' } });
      expect(await call(s, { transactionId: '1' })).toEqual({ status: 400, body: { error: 'proof-required' } });
      expect(await call(s, withProof({ proof: '' }))).toEqual({ status: 400, body: { error: 'proof-required' } });
      expect(s.db.log).toHaveLength(0);
      expect(s.calls).toEqual([]);
    });

    it('required and valid: moves', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }], { requireProof: true });
      expect(await call(s, withProof({ proof: 'ok' }))).toEqual({ status: 200, body: { moved: true, linked: true } });
    });

    it('H1: a JWS signed weeks ago (44 days) is accepted, 45 days exactly is the edge, 46 days is refused', async () => {
      for (const [proof, status] of [['old-ok', 200], ['edge', 200], ['stale', 403]] as const) {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = setup([{ ...base, user_id: O, ...liveSite }]);
        expect((await call(s, withProof({ proof }))).status).toBe(status);
      }
    });

    it('flag off, no proof: a bare transactionId still works', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect((await call(s, CONF)).status).toBe(200);
    });

    it('flag off, valid proof: accepted', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect((await call(s, withProof({ proof: 'ok' }))).status).toBe(200);
    });

    it.each(['bad-sig', 'old-renewal', 'stale', 'future', 'nodate', 'other-otid', 'other-bundle', 'other-env'])('flag off, a present-but-invalid proof (%s) is refused 403 proof-invalid, nothing written', async (proof) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect(await call(s, withProof({ proof }))).toEqual({ status: 403, body: { error: 'proof-invalid' } });
      expect(s.db.log).toHaveLength(0);
      expect(s.db.row(OTID)!.user_id).toBe(O);
      expect(s.calls).toEqual([]);
    });

    it('the same refusals with the flag on (stale JWS refused)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O, ...liveSite }], { requireProof: true });
      for (const proof of ['stale', 'other-otid', 'bad-sig']) expect((await call(s, withProof({ proof }))).status).toBe(403);
      expect(s.db.row(OTID)!.user_id).toBe(O);
    });

    it('N2: without a latest transaction id from Apple the JWS must at least be unexpired', async () => {
      const noLatest = { ...TX, latestTransactionId: undefined };
      const ok = setup([{ ...base, user_id: O, ...liveSite }], { tx: noLatest, decodeProof: async () => ({ ...proofFor('ok'), expiresDate: NOW + 1000 }) });
      expect((await call(ok, withProof({ proof: 'ok' }))).status).toBe(200);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const expiresDate of [NOW - 1000, undefined]) {
        const bad = setup([{ ...base, user_id: O, ...liveSite }], { tx: noLatest, decodeProof: async () => ({ ...proofFor('ok'), expiresDate }) });
        expect((await call(bad, withProof({ proof: 'ok' }))).status).toBe(403);
      }
    });

    it('exactly 45 days old passes (edge)', async () => {
      const s = setup([{ ...base, user_id: O, ...liveSite }]);
      expect((await call(s, withProof({ proof: 'edge' }))).status).toBe(200);
    });

    it('a proof is also required for the probe and for linking an unlinked purchase', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const s = setup([{ ...base }], { requireProof: true });
      expect((await call(s, { transactionId: '1', proof: 'stale' })).status).toBe(403);
      expect(s.db.row(OTID)!.user_id).toBeNull();
      expect((await call(s, { transactionId: '1', proof: 'ok' })).status).toBe(200);
    });

    it('proof verifier unavailable -> 503; non-string proof -> 400; huge proof -> 403', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const s = setup([{ ...base, user_id: O }]);
      expect((await call(s, withProof({ proof: 'down' }))).status).toBe(503);
      expect(await call(s, withProof({ proof: 5 }))).toEqual({ status: 400, body: { error: 'bad-request' } });
      expect((await call(s, withProof({ proof: 'x'.repeat(20_000) }))).status).toBe(403);
      expect(s.db.row(OTID)!.user_id).toBe(O);
    });

    it('an inactive purchase with a valid proof is 402 (payment gates the move)', async () => {
      const s = setup([{ ...base, user_id: O }], { tx: { ...TX, revoked: true }, requireProof: true });
      expect((await call(s, withProof({ proof: 'ok' }))).status).toBe(402);
      expect(s.db.row(OTID)!.user_id).toBe(O);
    });
  });

  it('a repo without transferUser is 503 (never moves)', async () => {
    const s = setup([{ ...base, user_id: O }]);
    delete (s.deps.repo as any).transferUser;
    expect((await call(s, CONF)).status).toBe(503);
  });

  it('conditional stamps: markPublished / clearTakenDown from the OLD owner cannot land on the moved row', async () => {
    const s = setup([{ ...base, user_id: A, site_slug: 'fade-lab', published_at: null, taken_down_at: '2026-10-05T00:00:00Z' }]);
    await s.deps.repo.markPublished(OTID, { userId: O, slug: 'fade-lab' });
    await s.deps.repo.clearTakenDown(OTID, { userId: O, slug: 'fade-lab' });
    expect(s.db.row(OTID)).toMatchObject({ published_at: null, taken_down_at: '2026-10-05T00:00:00Z' });
  });
});
