// In-memory fake of the address table (lib/account/sites.ts SitesDeps), with the real table's two uniqueness rules:
// primary key (user_id, environment) and unique slug.
import type { AddressRow, SitesDeps } from '../../../lib/account/sites.js';
import type { KindEnv } from '../../../lib/account/kind.js';

export function fakeSites(seed: AddressRow[] = [], opts: { missing?: boolean; failGet?: boolean; failWrites?: boolean; webPublished?: string[]; boundSlugs?: string[] } = {}) {
  const rows: AddressRow[] = seed.map((r) => ({ taken_at: new Date(0).toISOString(), ...r }));
  const calls: string[] = [];
  const state = { ...opts };
  const guard = (name: string) => {
    calls.push(name);
    if (state.missing) throw Object.assign(new Error('supabase 404'), { status: 404 });
    if (state.failGet && name === 'get') throw Object.assign(new Error('supabase 500'), { status: 500 });
    if (state.failWrites && name !== 'get') throw Object.assign(new Error('supabase 500'), { status: 500 });
  };
  const deps: SitesDeps = {
    async get(uid, env) { guard('get'); return rows.find((r) => r.user_id === uid && r.environment === env) ?? null; },
    async insert(row) {
      guard('insert');
      if (rows.some((r) => r.slug === row.slug)) throw Object.assign(new Error('supabase 409'), { status: 409 });
      if (rows.some((r) => r.user_id === row.user_id && r.environment === row.environment)) return false;
      rows.push({ ...row, published_once: false, taken_at: new Date().toISOString() });
      return true;
    },
    async markPublishedOnce(uid, env, slug) { guard('mark'); for (const r of rows) if (r.user_id === uid && r.environment === env && r.slug === slug) r.published_once = true; },
    async release(uid, env, slug) {
      guard('release');
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.user_id === uid && r.environment === env && !r.published_once && (slug ? r.slug === slug : r.holder === 'web')) rows.splice(i, 1);
      }
    },
    async touch(uid, env, slug) { guard('touch'); for (const r of rows) if (r.user_id === uid && r.environment === env && r.slug === slug && !r.published_once) r.taken_at = new Date().toISOString(); },
    async held(slug) { guard('held'); return rows.some((r) => r.slug === slug); },
    async cleanup(beforeIso, env) {
      guard('cleanup');
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.published_once || (r.taken_at ?? '') >= beforeIso || (env && r.environment !== env)) continue;
        if (r.holder === 'web' && (state.webPublished ?? []).includes(r.slug)) { r.published_once = true; continue; }
        if (r.holder === 'apple' && (state.boundSlugs ?? []).includes(r.slug)) continue;
        rows.splice(i, 1); n++;
      }
      return n;
    },
    async move(from, to, slug) {
      guard('move');
      const r = rows.find((x) => x.user_id === from && x.slug === slug && x.holder === 'apple');
      if (!r) return;
      if (rows.some((x) => x.user_id === to && x.environment === r.environment)) throw Object.assign(new Error('supabase 409'), { status: 409 });
      r.user_id = to;
    },
  };
  return { deps, rows, calls, state, row: (uid: string, env: KindEnv) => rows.find((r) => r.user_id === uid && r.environment === env) };
}
