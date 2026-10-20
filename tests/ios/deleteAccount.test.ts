import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/deleteAccount.js', async (orig) => {
  const actual: any = await orig();
  return { ...actual, liveDeleteDeps: vi.fn(() => ({})) };
});

import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import handler from '../../api/ios/delete-account.js';

function mkDeps(over: any = {}) {
  const calls: string[] = [];
  return {
    calls,
    getUser: vi.fn(async (_jwt: string) => ({ id: 'u1' })),
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
