import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/admin/sites.js', () => ({
  findSites: vi.fn(async () => [{ slug: 'fade-lab' }]),
  getSite: vi.fn(async (slug: string) => (slug === 'fade-lab' ? { ok: true, site: { slug } } : { ok: false, error: 'not-found' })),
  updateSite: vi.fn(async (slug: string) => ({ ok: true, slug, version: 4 })),
  republish: vi.fn(async (slug: string) => ({ ok: true, slug })),
  rollback: vi.fn(async (slug: string) => ({ ok: false, slug, error: 'no-history' })),
  republishAll: vi.fn(async (i: any) => ({ dryRun: i.dryRun, results: [], skipped: [], remaining: 0, done: true })),
}));
vi.mock('../../lib/admin/live.js', () => ({ adminSupabase: vi.fn(), liveAdminDeps: vi.fn(() => ({})) }));

import { makeAdminSitesHandler } from '../../api/admin/sites.js';
import { checkAdmin, ADMIN_EMAIL } from '../../lib/admin/auth.js';
import { findSites, getSite, updateSite, republish, republishAll, rollback } from '../../lib/admin/sites.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const ADMIN = { authorization: 'Bearer good' };
function handler(over: Partial<Parameters<typeof makeAdminSitesHandler>[0]> = {}) {
  return makeAdminSitesHandler({
    emailOf: () => async (t: string) => (t === 'good' ? ADMIN_EMAIL : t === 'other' ? 'someone@else.com' : null),
    core: () => ({}) as any,
    reads: memoryStore(),
    writes: memoryStore(),
    now: () => 1_000,
    configured: () => true,
    ...over,
  });
}
const call = async (h: any, req: any) => { const r = res(); await h({ query: {}, headers: ADMIN, ...req }, r); return r; };

beforeEach(() => vi.clearAllMocks());

describe('checkAdmin (shared with /api/admin-overview)', () => {
  const emailOf = async (t: string) => (t === 'good' ? ADMIN_EMAIL : null);
  it('no token → 401 Sign in required; wrong user or bad token → 403 Not authorized', async () => {
    expect(await checkAdmin(undefined, emailOf)).toEqual({ ok: false, status: 401, error: 'Sign in required' });
    expect(await checkAdmin('Bearer ', emailOf)).toEqual({ ok: false, status: 401, error: 'Sign in required' });
    expect(await checkAdmin('Bearer nope', emailOf)).toEqual({ ok: false, status: 403, error: 'Not authorized' });
    expect(await checkAdmin('Bearer x', async () => { throw new Error('net'); })).toEqual({ ok: false, status: 403, error: 'Not authorized' });
    expect(await checkAdmin('Bearer good', emailOf)).toEqual({ ok: true, email: ADMIN_EMAIL });
  });
});

describe('api/admin/sites', () => {
  it('auth: 401 without a token, 403 for another user; nothing called', async () => {
    const h = handler();
    expect((await call(h, { method: 'GET', headers: {} })).statusCode).toBe(401);
    const r = await call(h, { method: 'GET', headers: { authorization: 'Bearer other' } });
    expect(r).toMatchObject({ statusCode: 403, body: { ok: false, error: 'Not authorized' } });
    expect(findSites).not.toHaveBeenCalled();
  });

  it('405 for other methods; 500 when not configured', async () => {
    expect((await call(handler(), { method: 'DELETE' })).statusCode).toBe(405);
    expect((await call(handler({ configured: () => false }), { method: 'GET' })).statusCode).toBe(500);
  });

  it('GET ?q searches, GET ?slug gets one (404 when unknown)', async () => {
    const h = handler();
    const a = await call(h, { method: 'GET', query: { q: 'fade' } });
    expect(a).toMatchObject({ statusCode: 200, body: { ok: true, sites: [{ slug: 'fade-lab' }] } });
    expect(findSites).toHaveBeenCalledWith('fade', expect.anything());
    expect((await call(h, { method: 'GET', query: { slug: 'fade-lab' } })).body).toEqual({ ok: true, site: { slug: 'fade-lab' } });
    expect((await call(h, { method: 'GET', query: { slug: 'x' } })).statusCode).toBe(404);
    expect(getSite).toHaveBeenCalledTimes(2);
  });

  it('POST actions reach the core with the admin as `by`', async () => {
    const h = handler();
    const u = await call(h, { method: 'POST', body: { action: 'update', slug: 'fade-lab', set: { phone: '1' }, note: 'n', expectedVersion: 3 } });
    expect(u).toMatchObject({ statusCode: 200, body: { ok: true, version: 4 } });
    expect(updateSite).toHaveBeenCalledWith('fade-lab', { patch: undefined, set: { phone: '1' }, note: 'n', expectedVersion: 3, by: ADMIN_EMAIL }, expect.anything());
    await call(h, { method: 'POST', body: JSON.stringify({ action: 'replace', slug: 'fade-lab', siteData: { shopName: 'X' } }) });
    expect((updateSite as any).mock.calls[1][1]).toMatchObject({ replace: { shopName: 'X' }, by: ADMIN_EMAIL });
    expect((await call(h, { method: 'POST', body: { action: 'republish', slug: 'fade-lab' } })).statusCode).toBe(200);
    expect(republish).toHaveBeenCalledWith('fade-lab', expect.anything(), ADMIN_EMAIL);
    const rb = await call(h, { method: 'POST', body: { action: 'rollback', slug: 'fade-lab', version: 2 } });
    expect(rb).toMatchObject({ statusCode: 404, body: { error: 'no-history' } });
    expect(rollback).toHaveBeenCalledWith('fade-lab', 2, expect.anything(), ADMIN_EMAIL);
  });

  it('republish-all is a dry run unless dryRun:false, and a real run needs a runId', async () => {
    const h = handler();
    const dry = await call(h, { method: 'POST', body: { action: 'republish-all' } });
    expect(dry).toMatchObject({ statusCode: 200, body: { ok: true, dryRun: true } });
    expect((await call(h, { method: 'POST', body: { action: 'republish-all', dryRun: false } })).statusCode).toBe(400);
    await call(h, { method: 'POST', body: { action: 'republish-all', dryRun: false, runId: 'ui-1', limit: 4 } });
    expect((republishAll as any).mock.calls.at(-1)[0]).toMatchObject({ dryRun: false, runId: 'ui-1', limit: 4, by: ADMIN_EMAIL });
  });

  it('bad bodies and unknown actions → 400', async () => {
    const h = handler();
    expect((await call(h, { method: 'POST', body: '{nope' })).statusCode).toBe(400);
    expect((await call(h, { method: 'POST', body: { action: 'explode' } })).statusCode).toBe(400);
    expect((await call(h, { method: 'POST', body: { action: 'update' } })).statusCode).toBe(400);
    const throwing = Object.defineProperty({ method: 'POST', query: {}, headers: ADMIN }, 'body', { get() { throw new Error('Invalid JSON'); } });
    const r = res();
    await h(throwing as any, r);
    expect(r.statusCode).toBe(400);
  });

  it('rate limited per admin: writes 30/min, reads 120/min → 429', async () => {
    const h = handler();
    for (let i = 0; i < 30; i++) expect((await call(h, { method: 'POST', body: { action: 'republish', slug: 'fade-lab' } })).statusCode).toBe(200);
    expect((await call(h, { method: 'POST', body: { action: 'republish', slug: 'fade-lab' } })).statusCode).toBe(429);
    expect((await call(h, { method: 'GET', query: { q: '' } })).statusCode).toBe(200);
  });

  it('a core exception is a 500, never a crash', async () => {
    (findSites as any).mockRejectedValueOnce(new Error('db down'));
    const r = await call(handler(), { method: 'GET', query: {} });
    expect(r).toMatchObject({ statusCode: 500, body: { ok: false, error: 'exception' } });
  });
});
