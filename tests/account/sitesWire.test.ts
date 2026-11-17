// liveSitesDeps over a faked fetch: the PostgREST behaviour the table logic relies on.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveSitesDeps, takeAddress } from '../../lib/account/sites.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const UID = '11111111-1111-4111-8111-111111111111';

function table(seed: any[] = []) {
  const rows = seed.map((r) => ({ ...r }));
  const calls: { url: string; method: string; prefer: string; body?: any }[] = [];
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const method = init?.method ?? 'GET'; const prefer = init?.headers?.Prefer ?? '';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, prefer, body });
    const json = (d: any, status = 200) => new Response(JSON.stringify(d), { status });
    if (method === 'POST') {
      if (rows.some((r) => r.slug === body.slug)) return json({ code: '23505' }, 409); // unique(slug)
      if (rows.some((r) => r.user_id === body.user_id && r.environment === body.environment)) return json([]); // ignore-duplicates on the primary key: nothing returned
      rows.push(body); return json([body], 201);
    }
    if (method === 'GET') {
      const u = new URL(url); const q = (k: string) => u.searchParams.get(k)?.replace(/^eq\./, '');
      return json(rows.filter((r) => (!q('user_id') || r.user_id === q('user_id')) && (!q('environment') || r.environment === q('environment')) && (!q('slug') || r.slug === q('slug'))));
    }
    return json(null, 200);
  }));
  return { rows, calls };
}

describe('liveSitesDeps wire behaviour', () => {
  it('insert: ignore-duplicates returns [] on a primary-key conflict (false) and 409 on a slug conflict (throws status 409)', async () => {
    const t = table([{ user_id: UID, environment: 'Production', slug: 'mine', holder: 'web', published_once: false }]);
    const d = liveSitesDeps();
    expect(await d.insert({ user_id: UID, environment: 'Production', slug: 'another', holder: 'web' })).toBe(false); // same (user, env)
    await expect(d.insert({ user_id: 'u2', environment: 'Production', slug: 'mine', holder: 'web' })).rejects.toMatchObject({ status: 409 });
    expect(await d.insert({ user_id: 'u2', environment: 'Production', slug: 'free', holder: 'apple' })).toBe(true);
    expect(t.calls.filter((c) => c.method === 'POST').every((c) => c.prefer === 'resolution=ignore-duplicates,return=representation' && c.url.includes('on_conflict=user_id,environment'))).toBe(true);
  });
  it('takeAddress over the wire: a slug held by another account is refused with no existing row; the same row is ok', async () => {
    table([{ user_id: 'other', environment: 'Production', slug: 'taken', holder: 'web', published_once: true }]);
    const d = liveSitesDeps();
    expect(await takeAddress(UID, 'Production', 'taken', 'web', d)).toEqual({ status: 'refused', existing: null });
    expect(await takeAddress(UID, 'Production', 'new', 'web', d)).toMatchObject({ status: 'ok', created: true });
    expect(await takeAddress(UID, 'Production', 'new', 'web', d)).toMatchObject({ status: 'ok', created: false });
  });
  it('held() and the guarded writes build the exact filters (unpublished only, exact slug, holder web without a slug)', async () => {
    const t = table([{ user_id: UID, environment: 'Production', slug: 's', holder: 'web', published_once: false }]);
    const d = liveSitesDeps();
    expect(await d.held('s')).toBe(true);
    expect(await d.held('nope')).toBe(false);
    await d.release(UID, 'Production');
    await d.release(UID, 'Production', 's');
    await d.markPublishedOnce(UID, 'Production', 's');
    const w = t.calls.filter((c) => c.method !== 'GET' && c.method !== 'POST').map((c) => `${c.method} ${decodeURIComponent(c.url.split('/rest/v1/')[1])}`);
    expect(w).toEqual([
      `DELETE account_sites?user_id=eq.${UID}&environment=eq.Production&published_once=eq.false&holder=eq.web`,
      `DELETE account_sites?user_id=eq.${UID}&environment=eq.Production&published_once=eq.false&slug=eq.s`,
      `PATCH account_sites?user_id=eq.${UID}&environment=eq.Production&slug=eq.s&published_once=eq.false`,
    ]);
  });
});
