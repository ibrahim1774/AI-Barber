import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  makeVerifier, isActive, VerifyFailure, IOS_PRODUCT_IDS, toDecodedTransaction,
  type AppleLookup, type AppleDecode, type AppleStatuses, type AppleStatusItem, type VerifiedTx,
} from '../../lib/ios/appleVerify.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const BUNDLE = 'com.ibrahim1774.aibarber';
const PRODUCT = IOS_PRODUCT_IDS[0];
const payload = (over: Record<string, unknown> = {}): Awaited<ReturnType<AppleDecode>> => ({
  bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: 'o1', transactionId: 't1',
  expiresDate: 2_000_000_000_000, ...over,
});

interface LatestOpts {
  /** Subscription status Apple reports for this purchase (default 1 = Active). */
  status?: number;
  /** Decoded latest transaction (default: same as the looked-up transaction). */
  decoded?: Awaited<ReturnType<AppleDecode>>;
  /** Raw lastTransactions entries (overrides status). */
  items?: AppleStatusItem[];
  /** HTTP status of the status call (default 200). */
  http?: number;
}

/** Default status lookup: one Active entry for originalTransactionId 'o1', signed `latest-${env}`. */
function statusFake(latest: LatestOpts = {}, otid = 'o1') {
  return vi.fn<AppleStatuses>(async (env) =>
    latest.http && latest.http !== 200
      ? { status: latest.http }
      : { status: 200, items: latest.items ?? [{ status: latest.status ?? 1, originalTransactionId: otid, signedTransactionInfo: `latest-${env}` }] });
}

function setup(statuses: Record<string, number>, decoded: Awaited<ReturnType<AppleDecode>> = payload(), latest: LatestOpts = {}) {
  const lookup = vi.fn<AppleLookup>(async (env) => {
    const status = statuses[env];
    return status === 200 ? { status, signedTransactionInfo: `signed-${env}` } : { status };
  });
  const decode = vi.fn<AppleDecode>(async (_env, signed) => (signed.startsWith('latest-') ? latest.decoded ?? decoded : decoded));
  const statusLookup = statusFake(latest, decoded.originalTransactionId);
  return { lookup, decode, statuses: statusLookup, verify: makeVerifier({ lookup, decode, statuses: statusLookup, bundleId: BUNDLE }) };
}
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as VerifyFailure).code; } return null; };

describe('makeVerifier', () => {
  it('returns the production transaction', async () => {
    const { verify, lookup } = setup({ Production: 200 });
    const tx = await verify('t1');
    expect(tx).toEqual({
      originalTransactionId: 'o1', transactionId: 't1', productId: PRODUCT,
      environment: 'Production', expiresAt: 2_000_000_000_000, revoked: false, status: 1, productPurchasedAt: null,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404])('falls back to sandbox when production is %i', async (s) => {
    const { verify, decode, statuses } = setup({ Production: s, Sandbox: 200 });
    const tx = await verify('t1');
    expect(tx.environment).toBe('Sandbox');
    expect(decode).toHaveBeenCalledWith('Sandbox', 'signed-Sandbox');
    // status comes from the same environment that answered getTransactionInfo
    expect(statuses).toHaveBeenCalledTimes(1);
    expect(statuses).toHaveBeenCalledWith('Sandbox', 'o1');
    expect(decode).toHaveBeenCalledWith('Sandbox', 'latest-Sandbox');
  });

  it('not found in either environment', async () => {
    expect(await code(setup({ Production: 404, Sandbox: 404 }).verify('t1'))).toBe('not-found');
    expect(await code(setup({ Production: 401, Sandbox: 401 }).verify('t1'))).toBe('not-found');
  });

  it("rejects another app's transaction", async () => {
    expect(await code(setup({ Production: 200 }, payload({ bundleId: 'com.other' })).verify('t1'))).toBe('bad-bundle');
  });

  it('rejects unknown product', async () => {
    expect(await code(setup({ Production: 200 }, payload({ productId: 'com.x.other' })).verify('t1'))).toBe('bad-product');
  });

  it('apple 5xx is apple-unavailable', async () => {
    expect(await code(setup({ Production: 500 }).verify('t1'))).toBe('apple-unavailable');
    expect(await code(setup({ Production: 404, Sandbox: 503 }).verify('t1'))).toBe('apple-unavailable');
  });

  it('a thrown lookup is apple-unavailable', async () => {
    const verify = makeVerifier({
      lookup: async () => { throw new Error('network'); }, decode: async () => payload(), statuses: statusFake(), bundleId: BUNDLE,
    });
    expect(await code(verify('t1'))).toBe('apple-unavailable');
  });

  it('maps revocation and missing expiry', async () => {
    const tx = await setup({ Production: 200 }, payload({ expiresDate: undefined, revocationDate: 5 })).verify('t1');
    expect(tx.revoked).toBe(true);
    expect(tx.expiresAt).toBeNull();
  });
});

describe('makeVerifier subscription status (latest transaction)', () => {
  const NOW = 1_900_000_000_000;
  it('a stale original transaction with a renewed latest status is active', async () => {
    // The id the app sent is the first period: long expired. Apple's latest says Active.
    const { verify, statuses } = setup({ Production: 200 },
      payload({ transactionId: 'o1', expiresDate: NOW - 90 * 86_400_000 }),
      { status: 1, decoded: payload({ transactionId: 't9', expiresDate: NOW + 20 * 86_400_000 }) });
    const tx = await verify('o1');
    expect(statuses).toHaveBeenCalledWith('Production', 'o1');
    expect(tx).toMatchObject({ originalTransactionId: 'o1', status: 1, expiresAt: NOW + 20 * 86_400_000, revoked: false });
    expect(isActive(tx, NOW)).toBe(true);
  });

  it('billing grace period is active even though expiresDate has passed', async () => {
    const { verify } = setup({ Production: 200 }, payload(), { status: 4, decoded: payload({ expiresDate: NOW - 1000 }) });
    const tx = await verify('t1');
    expect(tx.status).toBe(4);
    expect(isActive(tx, NOW)).toBe(true);
  });

  it('billing retry is inactive', async () => {
    const { verify } = setup({ Production: 200 }, payload(), { status: 3, decoded: payload({ expiresDate: NOW - 1000 }) });
    expect(isActive(await verify('t1'), NOW)).toBe(false);
  });

  it('expired is inactive', async () => {
    const { verify } = setup({ Production: 200 }, payload(), { status: 2, decoded: payload({ expiresDate: NOW - 1000 }) });
    expect(isActive(await verify('t1'), NOW)).toBe(false);
  });

  it('status 5 (revoked) is revoked even without a revocationDate', async () => {
    const tx = await setup({ Production: 200 }, payload(), { status: 5 }).verify('t1');
    expect(tx.revoked).toBe(true);
    expect(isActive(tx, NOW)).toBe(false);
  });

  it('revocationDate on the latest transaction marks it revoked', async () => {
    const tx = await setup({ Production: 200 }, payload(), { status: 1, decoded: payload({ revocationDate: 5 }) }).verify('t1');
    expect(tx.revoked).toBe(true);
  });

  it('picks the entry for this originalTransactionId, not the first one', async () => {
    const decodedOther = payload({ originalTransactionId: 'other', expiresDate: NOW + 1 });
    const decodedMine = payload({ expiresDate: NOW + 5000 });
    const lookup: AppleLookup = async () => ({ status: 200, signedTransactionInfo: 'signed' });
    const decode = vi.fn<AppleDecode>(async (_e, signed) =>
      signed === 'latest-other' ? decodedOther : signed === 'latest-mine' ? decodedMine : payload());
    const statuses: AppleStatuses = async () => ({ status: 200, items: [
      { status: 2, originalTransactionId: 'other', signedTransactionInfo: 'latest-other' },
      { status: 1, originalTransactionId: 'o1', signedTransactionInfo: 'latest-mine' },
    ] });
    const tx = await makeVerifier({ lookup, decode, statuses, bundleId: BUNDLE })('t1');
    expect(tx).toMatchObject({ status: 1, expiresAt: NOW + 5000 });
  });

  it('status call throwing is apple-unavailable', async () => {
    const v = makeVerifier({
      lookup: async () => ({ status: 200, signedTransactionInfo: 's' }), decode: async () => payload(),
      statuses: async () => { throw new Error('network'); }, bundleId: BUNDLE,
    });
    expect(await code(v('t1'))).toBe('apple-unavailable');
  });

  it.each([404, 429, 500])('status call HTTP %i is apple-unavailable', async (http) => {
    expect(await code(setup({ Production: 200 }, payload(), { http }).verify('t1'))).toBe('apple-unavailable');
  });

  it('no lastTransactions entry for this purchase is apple-unavailable', async () => {
    const items = [{ status: 1, originalTransactionId: 'someone-else', signedTransactionInfo: 'latest-x' }];
    expect(await code(setup({ Production: 200 }, payload(), { items }).verify('t1'))).toBe('apple-unavailable');
    expect(await code(setup({ Production: 200 }, payload(), { items: [] }).verify('t1'))).toBe('apple-unavailable');
  });

  it('entry without status or signedTransactionInfo is apple-unavailable', async () => {
    expect(await code(setup({ Production: 200 }, payload(), { items: [{ originalTransactionId: 'o1', signedTransactionInfo: 'latest-x' }] }).verify('t1'))).toBe('apple-unavailable');
    expect(await code(setup({ Production: 200 }, payload(), { items: [{ status: 1, originalTransactionId: 'o1' }] }).verify('t1'))).toBe('apple-unavailable');
  });

  it('latest transaction failing to decode is apple-unavailable', async () => {
    const decode = vi.fn<AppleDecode>(async (_e, signed) => {
      if (signed.startsWith('latest-')) throw new VerifyFailure('not-found');
      return payload();
    });
    const v = makeVerifier({
      lookup: async () => ({ status: 200, signedTransactionInfo: 'signed' }), decode, statuses: statusFake(), bundleId: BUNDLE,
    });
    expect(await code(v('t1'))).toBe('apple-unavailable');
  });
});

describe('makeVerifier decode failures', () => {
  const withDecode = (decode: AppleDecode, statuses: Record<string, number>) =>
    makeVerifier({
      lookup: async (env) => (statuses[env] === 200 ? { status: 200, signedTransactionInfo: 's' } : { status: statuses[env] }),
      decode, statuses: statusFake(), bundleId: BUNDLE,
    });
  it('propagates a VerifyFailure thrown by decode', async () => {
    const v = withDecode(async () => { throw new VerifyFailure('bad-bundle'); }, { Production: 200 });
    expect(await code(v('t1'))).toBe('bad-bundle');
  });
  it('decode not-found falls through to sandbox', async () => {
    const decode = vi.fn<AppleDecode>(async (env) => {
      if (env === 'Production') throw new VerifyFailure('not-found');
      return payload();
    });
    const tx = await withDecode(decode, { Production: 200, Sandbox: 200 })('t1');
    expect(tx.environment).toBe('Sandbox');
  });
  it('decode not-found in both ends in not-found', async () => {
    const v = withDecode(async () => { throw new VerifyFailure('not-found'); }, { Production: 200, Sandbox: 200 });
    expect(await code(v('t1'))).toBe('not-found');
  });
  it('other decode errors are apple-unavailable', async () => {
    const v = withDecode(async () => { throw new Error('boom'); }, { Production: 200 });
    expect(await code(v('t1'))).toBe('apple-unavailable');
  });
});

describe('makeVerifier tiers (Phase 4): the current product is the latest transaction\'s', () => {
  const P = 'com.ibrahim1774.aibarber.';

  it('sent hosting.monthly, latest store.monthly → productId store.monthly with its purchase date', async () => {
    const latest = payload({ productId: `${P}store.monthly`, transactionId: 't9', purchaseDate: 1_900_000_000_000 });
    const { verify } = setup({ Production: 200 }, payload({ productId: `${P}hosting.monthly`, purchaseDate: 1_800_000_000_000 }), { decoded: latest });
    const tx = await verify('t1');
    expect(tx.productId).toBe(`${P}store.monthly`);
    expect(tx.productPurchasedAt).toBe(1_900_000_000_000);
    expect(tx.transactionId).toBe('t1');
  });

  it('a latest product outside the list is bad-product', async () => {
    const { verify } = setup({ Production: 200 }, payload(), { decoded: payload({ productId: 'com.x.other' }) });
    expect(await code(verify('t1'))).toBe('bad-product');
  });

  it.each(['bookings.monthly', 'bookings.yearly', 'store.monthly', 'store.yearly', 'hosting.yearly'])(
    'a %s purchase (sent and latest) verifies', async (suffix) => {
      const d = payload({ productId: P + suffix, purchaseDate: 1_700_000_000_000 });
      const tx = await setup({ Production: 200 }, d).verify('t1');
      expect(tx.productId).toBe(P + suffix);
      expect(tx.productPurchasedAt).toBe(1_700_000_000_000);
    });

  it('a latest transaction without a purchase date gives productPurchasedAt null', async () => {
    expect((await setup({ Production: 200 }).verify('t1')).productPurchasedAt).toBeNull();
  });
});

describe('toDecodedTransaction (the default decoders)', () => {
  it('reads purchaseDate and isUpgraded from the signed payload', () => {
    const d = toDecodedTransaction({
      bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: 'o1', transactionId: 't1',
      expiresDate: 5, revocationDate: 6, purchaseDate: 4, isUpgraded: true, extra: 'ignored',
    } as any);
    expect(d).toEqual({
      bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: 'o1', transactionId: 't1',
      expiresDate: 5, revocationDate: 6, purchaseDate: 4, isUpgraded: true,
    });
  });

  it('isUpgraded is false unless Apple says true', () => {
    expect(toDecodedTransaction({ bundleId: BUNDLE } as any).isUpgraded).toBe(false);
  });
});

describe('defaultVerifier', () => {
  it('throws apple-unavailable when env is missing', async () => {
    vi.stubEnv('APPLE_IAP_KEY_ID', '');
    const { defaultVerifier } = await import('../../lib/ios/appleVerify.js');
    try { defaultVerifier(); expect.unreachable(); } catch (e) { expect((e as VerifyFailure).code).toBe('apple-unavailable'); }
  });
});

describe('isActive', () => {
  const base: VerifiedTx = {
    originalTransactionId: 'o', transactionId: 't', productId: PRODUCT,
    environment: 'Production', expiresAt: 2000, revoked: false,
  };
  it('revoked is inactive', () => expect(isActive({ ...base, revoked: true }, 1000)).toBe(false));
  it('past expiry is inactive', () => expect(isActive({ ...base, expiresAt: 500 }, 1000)).toBe(false));
  it('future expiry is active', () => expect(isActive(base, 1000)).toBe(true));
  it('null expiry is active', () => expect(isActive({ ...base, expiresAt: null }, 1000)).toBe(true));
  it('status 1 (Active) is active even if the clock says expired', () => expect(isActive({ ...base, expiresAt: 500, status: 1 }, 1000)).toBe(true));
  it('status 4 (grace period) is active past expiry', () => expect(isActive({ ...base, expiresAt: 500, status: 4 }, 1000)).toBe(true));
  it.each([2, 3, 5])('status %i is inactive even with a future expiry', (status) =>
    expect(isActive({ ...base, expiresAt: 5000, status }, 1000)).toBe(false));
  it('revoked wins over status 1', () => expect(isActive({ ...base, status: 1, revoked: true }, 1000)).toBe(false));
});
