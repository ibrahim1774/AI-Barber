import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/notifications.js', async (orig) => {
  const actual = await orig<typeof import('../../lib/ios/notifications.js')>();
  return { ...actual, liveNotificationDeps: vi.fn(() => ({})) , handleAppleNotification: vi.fn(async () => ({ status: 200, body: { ok: true } })) };
});

import { handleAppleNotification as realHandle } from '../../lib/ios/notifications.js';
import handler from '../../api/ios/apple-notification.js';

// The mock above wraps the module; get the real function for unit tests.
const { handleAppleNotification } = await vi.importActual<typeof import('../../lib/ios/notifications.js')>('../../lib/ios/notifications.js');

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
