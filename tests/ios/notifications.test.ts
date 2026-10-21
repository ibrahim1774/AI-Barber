import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/notifications.js', async (orig) => {
  const actual = await orig<typeof import('../../lib/ios/notifications.js')>();
  return { ...actual, liveNotificationDeps: vi.fn(() => ({})) , handleAppleNotification: vi.fn(async () => ({ status: 200, body: { ok: true } })) };
});

import { handleAppleNotification as realHandle } from '../../lib/ios/notifications.js';
import handler from '../../api/ios/apple-notification.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';

// The mock above wraps the module; get the real function for unit tests.
const { handleAppleNotification, liveNotificationDeps } = await vi.importActual<typeof import('../../lib/ios/notifications.js')>('../../lib/ios/notifications.js');

const BUNDLE = 'com.ibrahim1774.aibarber';
const NOW = 1_800_000_000_000;

function deps(over: any = {}) {
  const repo = { applyNotification: vi.fn(async () => {}) } as any;
  return {
    repo,
    bundleId: BUNDLE,
    now: () => NOW,
    decodeNotification: vi.fn(async () => ({
      notificationType: 'DID_RENEW',
      data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' },
    })),
    decodeTransaction: vi.fn(async () => ({
      bundleId: BUNDLE, productId: 'com.ibrahim1774.aibarber.hosting.monthly',
      originalTransactionId: 'otid1', transactionId: 't2', expiresDate: NOW + 1000,
    })),
    ...over,
  };
}

describe('handleAppleNotification', () => {
  it('records renewal expiry', async () => {
    const d = deps();
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(200);
    expect(d.decodeTransaction).toHaveBeenCalledWith('Production', 'tx');
    expect(d.repo.applyNotification).toHaveBeenCalledWith({
      otid: 'otid1', productId: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production',
      expiresAt: NOW + 1000, revokedAt: null, type: 'DID_RENEW',
    });
  });

  it('records refund as revoked', async () => {
    const d = deps({
      decodeNotification: vi.fn(async () => ({ notificationType: 'REFUND', data: { environment: 'Sandbox', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
    });
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(200);
    expect(d.repo.applyNotification.mock.calls[0][0]).toMatchObject({ environment: 'Sandbox', revokedAt: NOW, type: 'REFUND' });
  });

  it('uses revocationDate when present', async () => {
    const d = deps({
      decodeTransaction: vi.fn(async () => ({ bundleId: BUNDLE, productId: 'p', originalTransactionId: 'o', transactionId: 't', revocationDate: 555 })),
    });
    await handleAppleNotification('jws', d);
    expect(d.repo.applyNotification.mock.calls[0][0]).toMatchObject({ revokedAt: 555, expiresAt: null });
  });

  it('treats REVOKE as revoked', async () => {
    const d = deps({
      decodeNotification: vi.fn(async () => ({ notificationType: 'REVOKE', data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
    });
    await handleAppleNotification('jws', d);
    expect(d.repo.applyNotification.mock.calls[0][0].revokedAt).toBe(NOW);
  });

  it('ignores other bundle ids', async () => {
    const d = deps({
      decodeNotification: vi.fn(async () => ({ notificationType: 'DID_RENEW', data: { environment: 'Production', bundleId: 'com.other', signedTransactionInfo: 'tx' } })),
    });
    const r = await handleAppleNotification('jws', d);
    expect(r).toEqual({ status: 200, body: { ignored: 'bundle' } });
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
  });

  it('bad signature → 400', async () => {
    const d = deps({ decodeNotification: vi.fn(async () => { throw new Error('bad sig'); }) });
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(400);
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
  });

  it('ignores Xcode environment', async () => {
    const d = deps({
      decodeNotification: vi.fn(async () => ({ notificationType: 'DID_RENEW', data: { environment: 'Xcode', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
    });
    const r = await handleAppleNotification('jws', d);
    expect(r).toEqual({ status: 200, body: { ignored: 'environment' } });
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
  });

  it('ignores TEST notification without signedTransactionInfo', async () => {
    const d = deps({ decodeNotification: vi.fn(async () => ({ notificationType: 'TEST', data: { environment: 'Sandbox', bundleId: BUNDLE } })) });
    const r = await handleAppleNotification('jws', d);
    expect(r).toEqual({ status: 200, body: { ignored: 'no-transaction' } });
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
  });

  it('bad signature is logged with console.error (still 400)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ decodeNotification: vi.fn(async () => { throw new Error('bad sig'); }) });
    expect((await handleAppleNotification('jws', d)).status).toBe(400);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('bad transaction is logged with console.error (still 400)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ decodeTransaction: vi.fn(async () => { throw new Error('bad tx'); }) });
    expect(await handleAppleNotification('jws', d)).toEqual({ status: 400, body: { error: 'bad-transaction' } });
    expect(err).toHaveBeenCalled();
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('no configured bundle id → console.error + 500 (Apple retries), nothing decoded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ bundleId: '' });
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(500);
    expect(err).toHaveBeenCalled();
    expect(d.decodeNotification).not.toHaveBeenCalled();
    expect(d.repo.applyNotification).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('liveNotificationDeps with APPLE_BUNDLE_ID unset → 500, not ignored', async () => {
    vi.stubEnv('APPLE_BUNDLE_ID', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await handleAppleNotification('jws', liveNotificationDeps());
    expect(r.status).toBe(500);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    vi.unstubAllEnvs();
  });

  it('REFUND_REVERSED clears revoked_at', async () => {
    const d = deps({
      decodeNotification: vi.fn(async () => ({ notificationType: 'REFUND_REVERSED', data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
      decodeTransaction: vi.fn(async () => ({
        bundleId: BUNDLE, productId: 'p', originalTransactionId: 'o', transactionId: 't', expiresDate: NOW + 1000, revocationDate: 555,
      })),
    });
    expect((await handleAppleNotification('jws', d)).status).toBe(200);
    expect(d.repo.applyNotification.mock.calls[0][0]).toMatchObject({
      otid: 'o', revokedAt: null, clearRevoked: true, type: 'REFUND_REVERSED', expiresAt: NOW + 1000,
    });
  });

  it('other notifications do not clear revoked_at', async () => {
    const d = deps();
    await handleAppleNotification('jws', d);
    expect(d.repo.applyNotification.mock.calls[0][0].clearRevoked).toBeUndefined();
  });

  describe('resubscribe after a refund clears a stale revocation', () => {
    const notif = (type: string, tx: Record<string, unknown>) => deps({
      decodeNotification: vi.fn(async () => ({ notificationType: type, data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
      decodeTransaction: vi.fn(async () => ({ bundleId: BUNDLE, productId: 'p', originalTransactionId: 'o', transactionId: 't', ...tx })),
    });

    it('SUBSCRIBED / DID_RENEW with an unrevoked tx pass its purchaseDate as clearRevokedBefore', async () => {
      for (const type of ['SUBSCRIBED', 'DID_RENEW']) {
        const d = notif(type, { purchaseDate: NOW - 10, expiresDate: NOW + 1000 });
        await handleAppleNotification('jws', d);
        expect(d.repo.applyNotification.mock.calls[0][0]).toMatchObject({ type, clearRevokedBefore: NOW - 10, revokedAt: null });
        expect(d.repo.applyNotification.mock.calls[0][0].clearRevoked).toBeUndefined();
      }
    });

    it('never for a revoked tx, a refund, other types, or without a purchaseDate', async () => {
      for (const [type, tx] of [
        ['DID_RENEW', { purchaseDate: NOW, revocationDate: NOW + 1 }],
        ['REFUND', { purchaseDate: NOW }],
        ['DID_CHANGE_RENEWAL_STATUS', { purchaseDate: NOW }],
        ['SUBSCRIBED', {}],
      ] as const) {
        const d = notif(type, tx);
        await handleAppleNotification('jws', d);
        expect(d.repo.applyNotification.mock.calls[0][0].clearRevokedBefore).toBeUndefined();
      }
    });

    it('REFUND_REVERSED keeps using clearRevoked', async () => {
      const d = notif('REFUND_REVERSED', { purchaseDate: NOW, revocationDate: 555 });
      await handleAppleNotification('jws', d);
      expect(d.repo.applyNotification.mock.calls[0][0]).toMatchObject({ clearRevoked: true, revokedAt: null });
      expect(d.repo.applyNotification.mock.calls[0][0].clearRevokedBefore).toBeUndefined();
    });
  });

  describe('tiers (Phase 4): upgrades and downgrades in the one subscription group', () => {
    const P = 'com.ibrahim1774.aibarber.';
    const T0 = NOW - 10 * 86_400_000;

    /** The real supabasePurchases over a fake client holding one stored row; captures the upsert payload. */
    function realRepo(storedRow: Record<string, unknown> | null) {
      const writes: Record<string, unknown>[] = [];
      const chain: any = {
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: storedRow, error: null }).then(res),
      };
      for (const m of ['select', 'eq', 'lt', 'maybeSingle', 'update']) chain[m] = () => chain;
      chain.upsert = (payload: Record<string, unknown>) => { writes.push(payload); return chain; };
      return { repo: supabasePurchases({ from: () => chain } as any), writes };
    }
    const stored = (product: string, at: number) =>
      ({ expires_at: new Date(at + 30 * 86_400_000).toISOString(), product_id: product, product_purchased_at: new Date(at).toISOString() });
    const notif = (type: string, subtype: string | undefined, tx: Record<string, unknown>, repo: any) => deps({
      repo,
      decodeNotification: vi.fn(async () => ({ notificationType: type, subtype, data: { environment: 'Production', bundleId: BUNDLE, signedTransactionInfo: 'tx' } })),
      decodeTransaction: vi.fn(async () => ({ bundleId: BUNDLE, originalTransactionId: 'o', transactionId: 't', ...tx })),
    });

    it('passes purchaseDate and isUpgraded through to the repo', async () => {
      const d = notif('DID_RENEW', undefined, { productId: `${P}store.monthly`, purchaseDate: T0, isUpgraded: true, revocationDate: T0 + 1 }, { applyNotification: vi.fn(async () => {}) });
      await handleAppleNotification('jws', d);
      expect(d.repo.applyNotification.mock.calls[0][0]).toMatchObject({ purchasedAt: T0, isUpgraded: true, revokedAt: null });
    });

    it('DID_CHANGE_RENEWAL_PREF / UPGRADE carrying the new store.monthly transaction → the product becomes store', async () => {
      const { repo, writes } = realRepo(stored(`${P}hosting.monthly`, T0));
      const d = notif('DID_CHANGE_RENEWAL_PREF', 'UPGRADE', { productId: `${P}store.monthly`, purchaseDate: NOW - 1000, expiresDate: NOW + 30 * 86_400_000 }, repo);
      expect((await handleAppleNotification('jws', d)).status).toBe(200);
      expect(writes[0]).toMatchObject({ product_id: `${P}store.monthly`, product_purchased_at: new Date(NOW - 1000).toISOString() });
    });

    it('DID_CHANGE_RENEWAL_PREF / DOWNGRADE (its transaction is still the current, higher product) → unchanged', async () => {
      const { repo, writes } = realRepo(stored(`${P}store.monthly`, T0));
      const d = notif('DID_CHANGE_RENEWAL_PREF', 'DOWNGRADE', { productId: `${P}store.monthly`, purchaseDate: T0, expiresDate: T0 + 30 * 86_400_000 }, repo);
      expect((await handleAppleNotification('jws', d)).status).toBe(200);
      expect(writes[0].product_id).toBe(`${P}store.monthly`);
    });

    it('DID_RENEW onto the lower product at the next renewal → downgraded', async () => {
      const { repo, writes } = realRepo(stored(`${P}store.monthly`, T0));
      const d = notif('DID_RENEW', undefined, { productId: `${P}hosting.monthly`, purchaseDate: T0 + 30 * 86_400_000, expiresDate: T0 + 60 * 86_400_000 }, repo);
      await handleAppleNotification('jws', d);
      expect(writes[0].product_id).toBe(`${P}hosting.monthly`);
    });

    it('an upgraded-away transaction with a revocationDate → not revoked, product not written', async () => {
      const { repo, writes } = realRepo(stored(`${P}store.monthly`, NOW - 1000));
      const d = notif('REFUND', undefined, {
        productId: `${P}hosting.monthly`, purchaseDate: NOW - 500, revocationDate: NOW - 1000, isUpgraded: true,
      }, repo);
      expect((await handleAppleNotification('jws', d)).status).toBe(200);
      expect(Object.keys(writes[0])).not.toContain('revoked_at');
      expect(writes[0].product_id).toBe(`${P}store.monthly`);
      expect(Object.keys(writes[0])).not.toContain('product_purchased_at');
    });

    it('a real revocation (not upgraded) still revokes', async () => {
      const { repo, writes } = realRepo(stored(`${P}store.monthly`, T0));
      const d = notif('REFUND', undefined, { productId: `${P}store.monthly`, purchaseDate: T0, revocationDate: NOW - 5 }, repo);
      await handleAppleNotification('jws', d);
      expect(writes[0].revoked_at).toBe(new Date(NOW - 5).toISOString());
    });
  });

  it('repo throws → 500', async () => {
    const d = deps();
    d.repo.applyNotification.mockRejectedValue(new Error('db down'));
    const r = await handleAppleNotification('jws', d);
    expect(r.status).toBe(500);
  });
});

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

describe('api/ios/apple-notification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('OPTIONS → 200 with CORS', async () => {
    const r = res();
    await handler({ method: 'OPTIONS' } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,POST');
    expect(realHandle).not.toHaveBeenCalled();
  });

  it('GET → 405', async () => {
    const r = res();
    await handler({ method: 'GET' } as any, r);
    expect(r.statusCode).toBe(405);
  });

  it('malformed JSON → 400', async () => {
    const req = Object.defineProperty({ method: 'POST' }, 'body', { get() { throw new Error('Invalid JSON'); } });
    const r = res();
    await handler(req as any, r);
    expect(r.statusCode).toBe(400);
    expect(realHandle).not.toHaveBeenCalled();
  });

  it('missing signedPayload → 400', async () => {
    const r = res();
    await handler({ method: 'POST', body: {} } as any, r);
    expect(r.statusCode).toBe(400);
    expect(realHandle).not.toHaveBeenCalled();
  });

  it('valid body delegates and returns its status/body', async () => {
    const r = res();
    await handler({ method: 'POST', body: { signedPayload: 'abc' } } as any, r);
    expect(realHandle).toHaveBeenCalledWith('abc', expect.anything());
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });
});
