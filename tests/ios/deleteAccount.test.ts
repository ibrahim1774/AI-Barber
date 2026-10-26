import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/deleteAccount.js', async (orig) => {
  const actual: any = await orig();
  return { ...actual, liveDeleteDeps: vi.fn(() => ({})) };
});

import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import handler from '../../api/ios/delete-account.js';

const sitesList = [
  { original_transaction_id: 't1', site_slug: 'fade-lab', environment: 'Production', published_at: 'x' },
  { original_transaction_id: 't2', site_slug: 'second-cut', environment: 'Production', published_at: 'x' },
];

function mkDeps(over: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    getUser: vi.fn(async (_jwt: string) => ({ id: 'u1' })),
    listSites: vi.fn(async (_id: string) => sitesList),
    takeDown: vi.fn(async (s: any) => { calls.push(`down:${s.site_slug}`); }),
    purge: vi.fn(async (s: any) => { calls.push(`purge:${s.site_slug}`); }),
    deleteSites: vi.fn(async (_id: string) => { calls.push('sites'); }),
    deleteUser: vi.fn(async (_id: string) => { calls.push('user'); }),
    ...over,
  };
}

describe('deleteAccount', () => {
  it('missing token → 401, nothing called', async () => {
    const d = mkDeps();
    for (const h of [undefined, '', 'Basic abc', 'Bearer ', 'Bearer']) {
      const r = await deleteAccount(h, d);
      expect(r.status).toBe(401);
    }
    expect(d.getUser).not.toHaveBeenCalled();
  });

  it('invalid token (null user) → 401, nothing deleted', async () => {
    const d = mkDeps({ getUser: vi.fn(async () => null) });
    const r = await deleteAccount('Bearer bad', d);
    expect(r.status).toBe(401);
    expect(d.deleteSites).not.toHaveBeenCalled();
    expect(d.deleteUser).not.toHaveBeenCalled();
  });

  it('getUser throws → 401, nothing deleted', async () => {
    const d = mkDeps({ getUser: vi.fn(async () => { throw new Error('x'); }) });
    const r = await deleteAccount('Bearer bad', d);
    expect(r.status).toBe(401);
    expect(d.deleteSites).not.toHaveBeenCalled();
  });

  it('deletes sites then user, using the token user id → 200', async () => {
    const d = mkDeps();
    const r = await deleteAccount('Bearer jwt123', d);
    expect(r).toEqual({ status: 200, body: { deleted: true } });
    expect(d.getUser).toHaveBeenCalledWith('jwt123');
    expect(d.deleteSites).toHaveBeenCalledWith('u1');
    expect(d.deleteUser).toHaveBeenCalledWith('u1');
    expect(d.calls).toEqual(['down:fade-lab', 'down:second-cut', 'purge:fade-lab', 'purge:second-cut', 'sites', 'user']);
  });

  it('ordering: every takedown happens before any content is purged, and both before the account is deleted', async () => {
    const d = mkDeps();
    await deleteAccount('Bearer jwt', d);
    const firstPurge = d.calls.findIndex((c: string) => c.startsWith('purge:'));
    const lastDown = d.calls.map((c: string) => c.startsWith('down:')).lastIndexOf(true);
    expect(lastDown).toBeLessThan(firstPurge);
    expect(d.calls.indexOf('user')).toBe(d.calls.length - 1);
  });

  it('a takedown fails → 500, NOTHING purged or deleted (account kept so the user can retry)', async () => {
    const d = mkDeps({ takeDown: vi.fn(async (s: any) => { if (s.site_slug === 'second-cut') throw new Error('vercel'); }) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r).toEqual({ status: 500, body: { error: 'delete-failed' } });
    expect(d.purge).not.toHaveBeenCalled();
    expect(d.deleteSites).not.toHaveBeenCalled();
    expect(d.deleteUser).not.toHaveBeenCalled();
    expect(d.takeDown).toHaveBeenCalledTimes(2); // the other site was still taken down
  });

  it('a purge fails (content or domain) → 500, account not deleted', async () => {
    const d = mkDeps({ purge: vi.fn(async () => { throw new Error('gcs'); }) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r).toEqual({ status: 500, body: { error: 'delete-failed' } });
    expect(d.deleteUser).not.toHaveBeenCalled();
  });

  it('listSites fails → 500, nothing deleted', async () => {
    const d = mkDeps({ listSites: vi.fn(async () => { throw new Error('db'); }) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r.status).toBe(500);
    expect(d.deleteUser).not.toHaveBeenCalled();
  });

  it('an account with no site still deletes', async () => {
    const d = mkDeps({ listSites: vi.fn(async () => []) });
    expect((await deleteAccount('Bearer jwt', d)).status).toBe(200);
    expect(d.calls).toEqual(['sites', 'user']);
  });

  it('deleteSites throws → 500 delete-failed, deleteUser not called', async () => {
    const d = mkDeps({ deleteSites: vi.fn(async () => { throw new Error('db'); }) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r).toEqual({ status: 500, body: { error: 'delete-failed' } });
    expect(d.deleteUser).not.toHaveBeenCalled();
  });

  it('deleteUser throws → 500 delete-failed', async () => {
    const d = mkDeps({ deleteUser: vi.fn(async () => { throw new Error('auth'); }) });
    const r = await deleteAccount('Bearer jwt', d);
    expect(r).toEqual({ status: 500, body: { error: 'delete-failed' } });
  });
});

describe('api/ios/delete-account handler', () => {
  function res() {
    const r: any = { statusCode: 0, body: undefined, headers: {} };
    r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.json = (b: unknown) => { r.body = b; return r; };
    r.end = () => r;
    return r;
  }
  beforeEach(() => vi.clearAllMocks());

  it('OPTIONS → 200', async () => {
    const r = res();
    await handler({ method: 'OPTIONS', headers: {} } as any, r);
    expect(r.statusCode).toBe(200);
  });
  it('GET → 405', async () => {
    const r = res();
    await handler({ method: 'GET', headers: {} } as any, r);
    expect(r.statusCode).toBe(405);
  });
  it('POST without Authorization → 401', async () => {
    const r = res();
    await handler({ method: 'POST', headers: {} } as any, r);
    expect(r.statusCode).toBe(401);
  });
});

describe('deleteAccount during a business move (M3)', () => {
  it('refuses with 409 move-in-progress and deletes NOTHING while an unfinished move names the account as the previous owner', async () => {
    const d = mkDeps({ moveInProgress: vi.fn(async () => true) });
    const r = await deleteAccount('Bearer j', d);
    expect(r).toEqual({ status: 409, body: { error: 'move-in-progress' } });
    expect(d.listSites).not.toHaveBeenCalled();
    expect(d.calls).toEqual([]);
  });
  it('proceeds when no move is in progress; a failing check fails closed (500, nothing deleted)', async () => {
    const ok = mkDeps({ moveInProgress: vi.fn(async () => false) });
    expect((await deleteAccount('Bearer j', ok)).status).toBe(200);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = mkDeps({ moveInProgress: vi.fn(async () => { throw new Error('db'); }) });
    expect((await deleteAccount('Bearer j', bad)).status).toBe(500);
    expect(bad.calls).toEqual([]);
  });
});
