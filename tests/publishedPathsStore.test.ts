// The live paths store against a stubbed Supabase REST: timeouts are passed on, a missing column reads as "no record", other failures throw,
// a first write only lands on a null column, and a write that matches no row says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { livePathsStore, PATHS_STORE_TIMEOUT_MS } from '../lib/publishedPathsStore';

const rec = { v: 1 as const, paths: ['/', '/services/'], redirects: [] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const res = (status: number, body: unknown = '') => ({ ok: status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

describe('livePathsStore', () => {
  it('reads the record and bounds the call with a timeout signal', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(res(200, [{ published_paths: rec }]));
    expect(await livePathsStore.read('s')).toEqual(rec);
    expect(spy).toHaveBeenCalledWith(PATHS_STORE_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it('a hung fetch is aborted by the signal and reads as a failure, not as "no record"', async () => {
    const ctrl = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(ctrl.signal);
    fetchMock.mockImplementation((_u: string, init: any) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))));
    const p = livePathsStore.read('s');
    ctrl.abort();
    await expect(p).rejects.toThrow('aborted');
  });
  it('a 400 (column missing, migration 027 not applied) reads as no record; 5xx and network errors throw', async () => {
    fetchMock.mockResolvedValueOnce(res(400, { code: '42703' }));
    expect(await livePathsStore.read('s')).toBeNull();
    fetchMock.mockResolvedValueOnce(res(503));
    await expect(livePathsStore.read('s')).rejects.toThrow('503');
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(livePathsStore.read('s')).rejects.toThrow('network');
  });
  it('an unknown version or garbage reads as null, a missing row as null', async () => {
    fetchMock.mockResolvedValueOnce(res(200, [{ published_paths: { v: 2, paths: [], redirects: [] } }]));
    expect(await livePathsStore.read('s')).toBeNull();
    fetchMock.mockResolvedValueOnce(res(200, []));
    expect(await livePathsStore.read('s')).toBeNull();
  });
  it('a first write only matches a null column; a write after a read is not guarded; both are bounded', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(res(200, [{ slug: 's' }]));
    expect(await livePathsStore.write('s', rec, null)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('published_paths=is.null');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(await livePathsStore.write('s', rec, rec)).toBe(true);
    expect(fetchMock.mock.calls[1][0]).not.toContain('is.null');
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('a write that matches no row resolves false; a failure throws', async () => {
    fetchMock.mockResolvedValueOnce(res(200, []));
    expect(await livePathsStore.write('s', rec, null)).toBe(false);
    fetchMock.mockResolvedValueOnce(res(500));
    await expect(livePathsStore.write('s', rec, rec)).rejects.toThrow('500');
  });
});
