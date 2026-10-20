import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  makeVerifier, isActive, VerifyFailure, IOS_PRODUCT_IDS,
  type AppleLookup, type AppleDecode, type VerifiedTx,
} from '../../lib/ios/appleVerify.js';

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const BUNDLE = 'com.ibrahim1774.aibarber';
const PRODUCT = IOS_PRODUCT_IDS[0];
const payload = (over: Record<string, unknown> = {}): Awaited<ReturnType<AppleDecode>> => ({
  bundleId: BUNDLE, productId: PRODUCT, originalTransactionId: 'o1', transactionId: 't1',
  expiresDate: 2_000_000_000_000, ...over,
});

function setup(statuses: Record<string, number>, decoded: Awaited<ReturnType<AppleDecode>> = payload()) {
  const lookup = vi.fn<AppleLookup>(async (env) => {
    const status = statuses[env];
    return status === 200 ? { status, signedTransactionInfo: `signed-${env}` } : { status };
  });
  const decode = vi.fn<AppleDecode>(async () => decoded);
  return { lookup, decode, verify: makeVerifier({ lookup, decode, bundleId: BUNDLE }) };
}
const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as VerifyFailure).code; } return null; };

describe('makeVerifier', () => {
  it('returns the production transaction', async () => {
    const { verify, lookup } = setup({ Production: 200 });
    const tx = await verify('t1');
    expect(tx).toEqual({
      originalTransactionId: 'o1', transactionId: 't1', productId: PRODUCT,
      environment: 'Production', expiresAt: 2_000_000_000_000, revoked: false,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404])('falls back to sandbox when production is %i', async (s) => {
    const { verify, decode } = setup({ Production: s, Sandbox: 200 });
    const tx = await verify('t1');
    expect(tx.environment).toBe('Sandbox');
    expect(decode).toHaveBeenCalledWith('Sandbox', 'signed-Sandbox');
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
      lookup: async () => { throw new Error('network'); }, decode: async () => payload(), bundleId: BUNDLE,
    });
    expect(await code(verify('t1'))).toBe('apple-unavailable');
  });

  it('maps revocation and missing expiry', async () => {
    const tx = await setup({ Production: 200 }, payload({ expiresDate: undefined, revocationDate: 5 })).verify('t1');
    expect(tx.revoked).toBe(true);
    expect(tx.expiresAt).toBeNull();
  });
});

describe('makeVerifier decode failures', () => {
  const withDecode = (decode: AppleDecode, statuses: Record<string, number>) =>
    makeVerifier({
      lookup: async (env) => (statuses[env] === 200 ? { status: 200, signedTransactionInfo: 's' } : { status: statuses[env] }),
      decode, bundleId: BUNDLE,
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
});
