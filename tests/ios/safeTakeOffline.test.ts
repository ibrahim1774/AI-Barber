import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { takeSiteOffline } from '../../lib/ios/takeOffline.js';
import { purgeOffline, purge, removeSite } from '../../lib/ios/removeSite.js';
import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import { sweepIos } from '../../lib/ios/sweep.js';

const row = (over: any = {}) => ({
  original_transaction_id: 'orig-A', product_id: 'p', environment: 'Production', site_slug: 'fade-lab', user_id: 'u1',
  expires_at: null, revoked_at: null, last_notification: null, published_at: 'x', taken_down_at: null, lapse_checked_at: null, removed_at: null, ...over,
});

function mk() {
  const calls: string[] = [];
  return {
    calls,
    now: () => 1,
    verify: vi.fn(async () => ({ originalTransactionId: 'orig-A', transactionId: 't', productId: 'p', environment: 'Production', expiresAt: 0, revoked: false }) as any),
    repo: { get: vi.fn(async () => row()) },
    markRemoved: vi.fn(async (o: string) => { calls.push(`removed:${o}`); }),
    markTakenDown: vi.fn(async (o: string) => { calls.push(`stamp:${o}`); }),
    deployOffline: vi.fn(async (s: string) => { calls.push(`offline:${s}`); }),
    releaseDomains: vi.fn(async (s: string) => { calls.push(`domain:${s}`); }),
    clearSiteBase: vi.fn(async (s: string) => { calls.push(`base:${s}`); }),
    deleteContent: vi.fn(async (s: string) => { calls.push(`content:${s}`); }),
    userOf: vi.fn(async () => ({ id: 'u1' })),
    deleteAccountRows: vi.fn(async (u: string, s: string) => { calls.push(`rows:${u}:${s}`); }),
  };
}

describe('SAFE_TAKE_OFFLINE (iOS take-offline)', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('switch on: marks removed and taken down, deploys offline, releases the domain, clears the address, deletes no content', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    const d = mk();
    const r = await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer tok' });
    expect(r.status).toBe(200);
    expect(d.calls).toEqual(['removed:orig-A', 'stamp:orig-A', 'offline:fade-lab', 'domain:fade-lab', 'base:fade-lab', 'rows:u1:fade-lab']);
    expect(d.deleteContent).not.toHaveBeenCalled();
  });

  it('switch on: the address is cleared only after the domain is released (a failed release clears nothing)', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    const d = mk();
    d.releaseDomains.mockRejectedValueOnce(new Error('vercel'));
    const r = await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer tok' });
    expect(r.status).toBe(500);
    expect(d.clearSiteBase).not.toHaveBeenCalled();
  });

  it('switch off (unset): today\'s calls in today\'s order, no address clearing', async () => {
    const d = mk();
    const r = await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer tok' });
    expect(r.status).toBe(200);
    expect(d.calls).toEqual(['removed:orig-A', 'stamp:orig-A', 'offline:fade-lab', 'domain:fade-lab', 'content:fade-lab', 'rows:u1:fade-lab']);
    expect(d.clearSiteBase).not.toHaveBeenCalled();
  });

  it('switch set to something other than 1: still off', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', 'true');
    const d = mk();
    await takeSiteOffline({ transactionId: 't' }, d, { authorization: 'Bearer tok' });
    expect(d.deleteContent).toHaveBeenCalledWith('fade-lab');
  });

  it('purgeOffline works without a clearSiteBase dep and never deletes', async () => {
    const calls: string[] = [];
    await purgeOffline(row(), { releaseDomains: async (s) => { calls.push(s); } });
    expect(calls).toEqual(['fade-lab']);
  });

  it('full purge and removeSite still call deleteContent (account delete path)', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    const d = mk();
    await purge(row(), d);
    await removeSite(row(), d);
    expect(d.deleteContent).toHaveBeenCalledTimes(2);
    expect(d.clearSiteBase).not.toHaveBeenCalled();
  });

  it('iOS account delete with the switch on still purges (deleteContent via purge)', async () => {
    vi.stubEnv('SAFE_TAKE_OFFLINE', '1');
    const d = mk();
    const r = await deleteAccount('Bearer jwt', {
      getUser: async () => ({ id: 'u1' }),
      listSites: async () => [row()] as any,
      takeDown: async () => {},
      purge: (s: any) => purge(s, d),
      deleteSites: async () => {},
      deleteUser: async () => {},
    } as any);
    expect(r.status).toBe(200);
    expect(d.deleteContent).toHaveBeenCalledWith('fade-lab');
  });
});

describe('the sweep never brings a removed site back (the stored copy is kept)', () => {
  it('a removed row is not published, restored or re-linked, whatever the repo returns', async () => {
    const removed = row({ removed_at: 5, published_at: null, taken_down_at: 5 });
    const repo: any = {
      unpublishedBound: vi.fn(async () => [removed]),
      restoreCandidates: vi.fn(async () => [removed]),
      takedownCandidates: vi.fn(async () => []),
      markPublished: vi.fn(), markTakenDown: vi.fn(), clearTakenDown: vi.fn(), upsertVerified: vi.fn(), markLapseChecked: vi.fn(),
    };
    const publish = vi.fn();
    const deployOffline = vi.fn();
    const verify = vi.fn(async () => { throw new Error('should not verify'); });
    const out = await sweepIos({ repo, publish, deployOffline, verify } as any);
    expect(publish).not.toHaveBeenCalled();
    expect(repo.markPublished).not.toHaveBeenCalled();
    expect(out.published).toEqual([]);
    expect(out.restored).toEqual([]);
  });
});
