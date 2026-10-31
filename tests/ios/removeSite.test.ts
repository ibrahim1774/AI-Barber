import { describe, it, expect, vi } from 'vitest';
import { removeSite, takeDown, purge } from '../../lib/ios/removeSite.js';
import { ourObjectPath } from '../../lib/ios/removeSiteLive.js';

const site = { original_transaction_id: 't1', site_slug: 'fade-lab', environment: 'Production' as const, published_at: '2026-10-01' };

function mk(over: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    now: () => 1000,
    markRemoved: vi.fn(async (o: string, at: number) => { calls.push(`removed:${o}:${at}`); }),
    markTakenDown: vi.fn(async (o: string, at: number) => { calls.push(`stamp:${o}:${at}`); }),
    deployOffline: vi.fn(async (s: string) => { calls.push(`offline:${s}`); }),
    releaseDomains: vi.fn(async (s: string) => { calls.push(`domain:${s}`); }),
    deleteContent: vi.fn(async (s: string) => { calls.push(`content:${s}`); }),
    ...over,
  };
}

describe('removeSite', () => {
  it('order: removed mark, stamp, offline page, release domain, delete content', async () => {
    const d = mk();
    await removeSite(site, d);
    expect(d.calls).toEqual(['removed:t1:1000', 'stamp:t1:1000', 'offline:fade-lab', 'domain:fade-lab', 'content:fade-lab']);
  });

  it('a failed takedown stops everything after it (nothing deleted)', async () => {
    const d = mk({ deployOffline: vi.fn(async () => { throw new Error('vercel down'); }) });
    await expect(removeSite(site, d)).rejects.toThrow('vercel down');
    expect(d.releaseDomains).not.toHaveBeenCalled();
    expect(d.deleteContent).not.toHaveBeenCalled();
  });

  it('a failed domain release does not delete content (retry finishes it)', async () => {
    const d = mk({ releaseDomains: vi.fn(async () => { throw new Error('vercel'); }) });
    await expect(removeSite(site, d)).rejects.toThrow();
    expect(d.deleteContent).not.toHaveBeenCalled();
  });

  it('is idempotent: a second run does the same calls and succeeds', async () => {
    const d = mk();
    await removeSite(site, d);
    await removeSite(site, d);
    expect(d.deleteContent).toHaveBeenCalledTimes(2);
  });

  it('a never-published site is stamped but no offline deploy is made (it would create a project)', async () => {
    const d = mk();
    await takeDown({ ...site, published_at: null }, d);
    expect(d.markTakenDown).toHaveBeenCalled();
    expect(d.deployOffline).not.toHaveBeenCalled();
  });

  it('a purchase with no slug does nothing', async () => {
    const d = mk();
    await takeDown({ ...site, site_slug: null }, d);
    await purge({ ...site, site_slug: null }, d);
    expect(d.calls).toEqual([]);
  });
});

describe('ourObjectPath (which photos get deleted)', () => {
  const b = 'ab-bucket';
  it('accepts our bucket urls', () => {
    expect(ourObjectPath('https://storage.googleapis.com/ab-bucket/fade-lab/hero-1.jpg', b)).toBe('fade-lab/hero-1.jpg');
  });
  it('never touches foreign hosts, other buckets, traversal or the server JSON', () => {
    expect(ourObjectPath('https://example.com/ab-bucket/x.jpg', b)).toBeNull();
    expect(ourObjectPath('https://storage.googleapis.com/other/x.jpg', b)).toBeNull();
    expect(ourObjectPath('https://storage.googleapis.com/ab-bucket/../x.jpg', b)).toBeNull();
    expect(ourObjectPath('https://storage.googleapis.com/ab-bucket/pending-sites/other-site.json', b)).toBeNull();
    expect(ourObjectPath(undefined, b)).toBeNull();
  });
});
