import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_MS, runAccountMaintenance, runDaily, type MaintenanceDeps } from '../../lib/account/maintenance.js';
import { releaseGivenUpAddress } from '../../lib/webApp/publishJobs.js';
import { fakeSites } from './fakes/sites.js';

const T0 = Date.parse('2026-11-18T00:10:00Z');
const USER = '11111111-1111-4111-8111-111111111111';

function fakeClaims(o: { missing?: boolean } = {}) {
  const rows = new Map<string, number>();
  const deps: MaintenanceDeps = {
    async claim(name, nowIso, olderThanIso) {
      if (o.missing) throw Object.assign(new Error('404'), { status: 404 });
      const last = rows.get(name);
      if (last === undefined) { rows.set(name, Date.parse(nowIso)); return true; }
      if (last < Date.parse(olderThanIso)) { rows.set(name, Date.parse(nowIso)); return true; }
      return false;
    },
    async release(name) { rows.set(name, 0); },
  };
  return { deps, rows };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('runDaily', () => {
  it('runs once a day however often the 10-minute cron calls it', async () => {
    const c = fakeClaims();
    const task = vi.fn(async () => 3);
    for (let i = 0; i < 144; i++) await runDaily('t', task, T0 + i * 600_000, c.deps);
    expect(task).toHaveBeenCalledTimes(1);
    await runDaily('t', task, T0 + DAY_MS + 60_000, c.deps);
    expect(task).toHaveBeenCalledTimes(2);
  });
  it('two overlapping calls run it once', async () => {
    const c = fakeClaims();
    const task = vi.fn(async () => 1);
    await Promise.all([runDaily('t', task, T0, c.deps), runDaily('t', task, T0, c.deps)]);
    expect(task).toHaveBeenCalledTimes(1);
  });
  it('a missing table skips the task', async () => {
    const task = vi.fn(async () => 1);
    expect(await runDaily('t', task, T0, fakeClaims({ missing: true }).deps)).toEqual({ ran: false, reason: 'no-table' });
    expect(task).not.toHaveBeenCalled();
  });
  it('a failing task gives the claim back, so the next tick retries it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = fakeClaims();
    let n = 0;
    const task = vi.fn(async () => { if (n++ === 0) throw new Error('db'); return 1; });
    expect(await runDaily('t', task, T0, c.deps)).toEqual({ ran: false, reason: 'error' });
    expect(await runDaily('t', task, T0 + 600_000, c.deps)).toMatchObject({ ran: true });
  });
});

describe('runAccountMaintenance', () => {
  it('guard OFF: the address clean-up does not run and the address table is never read; only the kept-copy expiry runs', async () => {
    const c = fakeClaims();
    const f = fakeSites();
    const kept = { has: async () => false, trim: async () => {}, insert: async () => {}, expire: vi.fn(async () => 0) };
    const r = await runAccountMaintenance(T0, { mode: 'off', sites: f.deps, maintenance: c.deps, kept });
    expect(Object.keys(r!)).toEqual(['expiredKeptCopies']);
    expect(f.calls).toEqual([]);
  });
  it('alert and 1: cleans unpublished web rows older than 24 hours, once a day, and nothing else', async () => {
    const old = new Date(T0 - 25 * 3600_000).toISOString();
    const f = fakeSites([
      { user_id: USER, environment: 'Production', slug: 'stale-web', holder: 'web', published_once: false, taken_at: old },
      { user_id: '22222222-2222-4222-8222-222222222222', environment: 'Production', slug: 'bound-apple', holder: 'apple', published_once: false, taken_at: old },
    ]);
    const c = fakeClaims();
    const kept = { has: async () => false, trim: async () => {}, insert: async () => {}, expire: async () => 0 };
    const first = await runAccountMaintenance(T0, { mode: 'alert', sites: f.deps, maintenance: c.deps, kept });
    expect(first).toMatchObject({ unpublishedAddresses: { ran: true, result: 1 } });
    expect(f.rows.map((r) => r.slug)).toEqual(['bound-apple']);
    const second = await runAccountMaintenance(T0 + 600_000, { mode: 'enforce', sites: f.deps, maintenance: c.deps, kept });
    expect(second).toEqual({ unpublishedAddresses: { ran: false, reason: 'not-due' }, expiredKeptCopies: { ran: false, reason: 'not-due' } });
  });
});

describe('a publish job that gives up', () => {
  const stubSupabase = () => {
    vi.stubEnv('SUPABASE_URL', 'https://sb.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srv');
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { calls.push({ url, method: init?.method ?? 'GET' }); return new Response('', { status: 204 }); }));
    return calls;
  };
  it('releases the unpublished web address row of the job\'s account (live -> Production), only while the guard is on', async () => {
    const calls = stubSupabase();
    vi.stubEnv('ONE_SITE_GUARD', 'alert');
    await releaseGivenUpAddress({ user_id: USER, environment: 'live' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe(`https://sb.test/rest/v1/account_sites?user_id=eq.${USER}&environment=eq.Production&published_once=eq.false&holder=eq.web`);
  });
  it('guard off: no call at all', async () => {
    const calls = stubSupabase();
    vi.stubEnv('ONE_SITE_GUARD', '');
    await releaseGivenUpAddress({ user_id: USER, environment: 'test' });
    expect(calls).toHaveLength(0);
  });
  it('a failing release never throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'srv'); vi.stubEnv('ONE_SITE_GUARD', '1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(releaseGivenUpAddress({ user_id: USER, environment: 'live' })).resolves.toBeUndefined();
  });
});
