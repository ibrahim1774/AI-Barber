import { describe, it, expect, vi } from 'vitest';
import { appStoreStateFrom, appStoreStateOf, type IosPurchaseRow } from '../../lib/webApp/appStoreGuard.js';
import { webProductId } from '../../lib/webApp/publishFlow.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const day = 86400_000;
const p = (over: Partial<IosPurchaseRow> = {}): IosPurchaseRow => ({
  original_transaction_id: 'otid1', product_id: webProductId('website', 'month'), environment: 'Production',
  expires_at: new Date(NOW + 10 * day).toISOString(), revoked_at: null, taken_down_at: null, site_slug: null, published_at: null, ...over,
});

describe('appStoreStateFrom', () => {
  it('an active Production purchase is active in live mode', () => {
    expect(appStoreStateFrom(null, null, [p()], 'live', NOW)).toBe('active');
  });
  it('a Sandbox purchase is ignored in live mode but counts in test mode', () => {
    expect(appStoreStateFrom(null, null, [p({ environment: 'Sandbox' })], 'live', NOW)).toBeNull();
    expect(appStoreStateFrom(null, null, [p({ environment: 'Sandbox' })], 'test', NOW)).toBe('active');
  });
  it('revoked or taken-down purchases are not active', () => {
    expect(appStoreStateFrom(null, null, [p({ revoked_at: '2026-10-01T00:00:00Z' })], 'live', NOW)).toBeNull();
    expect(appStoreStateFrom(null, null, [p({ taken_down_at: '2026-10-01T00:00:00Z' })], 'live', NOW)).toBeNull();
  });
  it('a shop linked to an expired purchase is linked; to a live one, active', () => {
    const expired = p({ expires_at: new Date(NOW - 30 * day).toISOString() });
    expect(appStoreStateFrom({ ios_otid: 'otid1' }, expired, [], 'live', NOW)).toBe('linked');
    expect(appStoreStateFrom({ ios_otid: 'otid1' }, p(), [], 'live', NOW)).toBe('active');
  });
  it('a linked Sandbox purchase does not block in live mode', () => {
    expect(appStoreStateFrom({ ios_otid: 'o' }, p({ environment: 'Sandbox', expires_at: new Date(NOW - 30 * day).toISOString() }), [], 'live', NOW)).toBeNull();
  });
  it('no shop and no purchases is null; a shop without ios_otid is null', () => {
    expect(appStoreStateFrom(null, null, [], 'live', NOW)).toBeNull();
    expect(appStoreStateFrom({ ios_otid: null }, null, [], 'live', NOW)).toBeNull();
  });
});

describe('appStoreStateOf', () => {
  it('only issues GET reads and decides from them', async () => {
    const rest = vi.fn(async (path: string, init?: any) => {
      expect(init?.method ?? 'GET').toBe('GET');
      if (path.startsWith('ab_shops')) return [{ ios_otid: 'otid1' }];
      if (path.includes('original_transaction_id=eq.')) return [p({ expires_at: new Date(NOW - 30 * day).toISOString() })];
      return [];
    });
    expect(await appStoreStateOf('u1', 'live', NOW, rest as any)).toBe('linked');
    expect(rest).toHaveBeenCalledTimes(3);
  });
  it('propagates a lookup error', async () => {
    await expect(appStoreStateOf('u1', 'live', NOW, (async () => { throw new Error('supabase 500'); }) as any)).rejects.toThrow();
  });
});
