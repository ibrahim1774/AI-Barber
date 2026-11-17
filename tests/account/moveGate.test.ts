import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { runTransfer, type TransferDeps } from '../../lib/ios/transfer.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { VerifyFailure, type VerifiedTx } from '../../lib/ios/appleVerify.js';
import { fakePurchasesDb } from '../ios/fakePurchasesDb.js';

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

type K = 'web' | 'apple' | 'mixed' | 'neither';
const reading = (kind: K, o: any = {}) => ({ kind, holdsWebAddress: kind === 'web' || kind === 'mixed', holdsAppleAddress: kind === 'apple' || kind === 'mixed', ...o });
const withKinds = (kinds: Record<string, any>, calls: string[] = []) => ({ kindOf: vi.fn(async (u: string) => { calls.push(u); return kinds[u] ?? reading('neither'); }) });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Move with GATE_ANY_SOURCE', () => {
  const owned = [{ ...base, user_id: O, ...liveSite }];
  const BLOCK = { error: 'move-blocked-web-account' };
  beforeEach(() => vi.stubEnv('GATE_ANY_SOURCE', '1'));

  it('refuses a receiving web account', async () => {
    const s = setup(owned, withKinds({ [A]: reading('web') }));
    const r = await call(s, CONF);
    expect(r.status).toBe(409); expect(r.body).toMatchObject(BLOCK);
    expect(s.db.row(OTID)!.user_id).toBe(O);
    expect(s.calls.some((c) => c.startsWith('move:'))).toBe(false);
  });
  it('refuses a receiving mixed account', async () => {
    const s = setup(owned, withKinds({ [A]: reading('mixed') }));
    expect((await call(s, CONF)).body).toMatchObject(BLOCK);
  });
  it('refuses a giving web account', async () => {
    const s = setup(owned, withKinds({ [O]: reading('web') }));
    expect((await call(s, CONF)).body).toMatchObject(BLOCK);
    expect(s.db.row(OTID)!.user_id).toBe(O);
  });
  it('refuses a giving mixed account', async () => {
    const s = setup(owned, withKinds({ [O]: reading('mixed') }));
    expect((await call(s, CONF)).body).toMatchObject(BLOCK);
  });
  it('an Apple receiver with a live site under another purchase still gets account-has-site (today)', async () => {
    const other = { ...base, original_transaction_id: '3000000999', user_id: A, site_slug: 'a-site', published_at: '2026-10-01T00:00:00Z' };
    const s = setup([...owned, other], withKinds({ [A]: reading('apple') }));
    const r = await call(s, CONF);
    expect(r.status).toBe(409); expect(r.body).toMatchObject({ error: 'account-has-site', slug: 'a-site', reason: 'site' });
  });
  it('an Apple receiver with a shop of its own still gets account-has-site (shop)', async () => {
    const s = setup(owned, withKinds({ [A]: reading('apple') }));
    s.state.shops[A] = { id: 'shop-a', ios_otid: 'other' };
    expect((await call(s, CONF)).body).toMatchObject({ error: 'account-has-site', reason: 'shop' });
  });
  it('an Apple receiver holding only a lapsed address moves exactly as today', async () => {
    const s = setup(owned, withKinds({ [A]: reading('apple') }));
    expect((await call(s, CONF)).status).toBe(200);
  });
  it('a Free account that never published (neither) may receive', async () => {
    const s = setup(owned, withKinds({ [A]: reading('neither') }));
    const r = await call(s, CONF);
    expect(r.status).toBe(200); expect(r.body).toEqual({ moved: true, linked: true });
    expect(s.db.row(OTID)!.user_id).toBe(A);
  });
  it('an Apple giver with an Apple address is fine', async () => {
    const s = setup(owned, withKinds({ [O]: reading('apple') }));
    expect((await call(s, CONF)).status).toBe(200);
  });
  it('the message is plain English with no em dash', async () => {
    const s = setup(owned, withKinds({ [A]: reading('web') }));
    const b: any = (await call(s, CONF)).body;
    expect(typeof b.message).toBe('string'); expect(b.message).not.toMatch(/\u2014|\u2013/); expect(b.message.length).toBeGreaterThan(20);
  });
  it('a first link of an unlinked purchase is refused for a web or mixed receiver only', async () => {
    const free = [{ ...base }];
    expect((await call(setup(free, withKinds({ [A]: reading('web') })), { transactionId: '1' })).body).toMatchObject(BLOCK);
    const ok = setup(free, withKinds({ [A]: reading('apple') }));
    expect((await call(ok, { transactionId: '1' })).status).toBe(200);
    expect(ok.db.row(OTID)!.user_id).toBe(A);
  });
  it('an already-mine purchase is idempotent and reads no kind', async () => {
    const k = withKinds({ [A]: reading('web') });
    const s = setup([{ ...base, user_id: A }], k);
    expect((await call(s, { transactionId: '1' })).status).toBe(200);
    expect(k.kindOf).not.toHaveBeenCalled();
  });
  it('a kind lookup error fails closed (503) and moves nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = setup(owned, { kindOf: async () => { throw new Error('db'); } });
    const r = await call(s, CONF);
    expect(r.status).toBe(503);
    expect(s.db.row(OTID)!.user_id).toBe(O);
  });
});

describe('Move with the switch off', () => {
  it('same result for every kind and the kind reader is never called', async () => {
    for (const kind of ['web', 'mixed', 'apple', 'neither'] as K[]) {
      const k = withKinds({ [A]: reading(kind), [O]: reading(kind) });
      const s = setup([{ ...base, user_id: O, ...liveSite }], k);
      const r = await call(s, CONF);
      expect(r.status).toBe(200); expect(r.body).toEqual({ moved: true, linked: true });
      expect(k.kindOf).not.toHaveBeenCalled();
    }
  });
});
