// Backfill of the address table (migration 038) from what exists today. Idempotent: run it again each time ONE_SITE_GUARD is switched on.
// Logic only, over injected readers and writers, so it is unit-tested against fakes. scripts/one-account-backfill.ts is the thin runner
// (dry run unless --apply). It never overwrites a row: an existing row is left alone and, when it differs, listed. ONE exception: an Apple row whose purchase now belongs to someone else
// (a Move made while ONE_SITE_GUARD was off does not carry the row) is stale: it is removed and the new owner's row is inserted (re-derived from ios_purchases).
//   - web_app_sites with published_at not null  -> holder 'web'   (environment 'live' stores as Production, 'test' as Sandbox)
//   - ios_purchases with user_id and site_slug  -> holder 'apple' (the purchase's own environment)
// Written for each (account, environment) with exactly one address on exactly one side. NOT written, only listed:
//   mixed          the account holds both a web and an Apple address (rule R1)
//   multiple-web   the account has two or more different published web slugs in one environment
//   multiple-apple the account has two or more different Apple slugs in one environment (two Apple IDs)
//   slug-held      the slug is already held by another account's row
//   differs        the account already has a row with another slug or holder
//   user-gone      the account no longer exists (web_app_sites keeps its rows after an account delete and has no foreign key; account_sites.user_id does). Skipped, and its slug is NOT claimed.
import { kindEnvOf, type KindEnv } from './kind.js';
import type { Holder } from './sites.js';

export interface WebSiteSource { user_id: string; slug: string; environment: 'live' | 'test'; published_at: string | null }
export interface AppleSource { user_id: string | null; site_slug: string | null; environment: string | null; published_at?: string | null }
export interface ExistingRow { user_id: string; environment: KindEnv; slug: string; holder: Holder }

export interface BackfillRow { user_id: string; environment: KindEnv; slug: string; holder: Holder; published_once: boolean }
export type ListedReason = 'mixed' | 'multiple-web' | 'multiple-apple' | 'slug-held' | 'differs' | 'user-gone';
export interface Listed { user_id: string; environment: KindEnv; reason: ListedReason; slugs: string[] }
export interface BackfillPlan { toInsert: BackfillRow[]; /** Stale Apple rows (the purchase moved to another account while the guard was off), removed before the insert. */ toDelete: ExistingRow[]; alreadyThere: number; listed: Listed[] }

const key = (u: string, e: string) => `${u}|${e}`;

/** Pure: what to insert and what to list. */
export function planBackfill(web: WebSiteSource[], apple: AppleSource[], existing: ExistingRow[], liveUsers?: ReadonlySet<string>): BackfillPlan {
  // `liveUsers` undefined = not told (unit tests of the other rules): nobody is skipped. The runner always passes it.
  const gone = new Map<string, { uid: string; env: KindEnv; slugs: Set<string> }>();
  const alive = (uid: string, env: KindEnv, slug: string) => {
    if (!liveUsers || liveUsers.has(uid)) return true;
    const k = key(uid, env);
    const v = gone.get(k) ?? { uid, env, slugs: new Set<string>() };
    v.slugs.add(slug); gone.set(k, v);
    return false;
  };
  const groups = new Map<string, { uid: string; env: KindEnv; web: Set<string>; apple: Map<string, boolean> }>();
  const g = (uid: string, env: KindEnv) => {
    const k = key(uid, env);
    let v = groups.get(k);
    if (!v) { v = { uid, env, web: new Set(), apple: new Map() }; groups.set(k, v); }
    return v;
  };
  for (const w of web) if (w.published_at && w.user_id && w.slug && alive(w.user_id, kindEnvOf(w.environment), w.slug)) g(w.user_id, kindEnvOf(w.environment)).web.add(w.slug);
  for (const a of apple) {
    if (!a.user_id || !a.site_slug || (a.environment !== 'Production' && a.environment !== 'Sandbox')) continue;
    if (!alive(a.user_id, a.environment, a.site_slug)) continue;
    const v = g(a.user_id, a.environment);
    v.apple.set(a.site_slug, (v.apple.get(a.site_slug) ?? false) || !!a.published_at);
  }
  // A stale Apple row: its holder's own purchases no longer include the slug, and another account's purchase does (the purchase moved while the guard was off). It is removed, and the
  // loop below treats it as absent (so its old owner is not listed as `differs`, and the new owner is not listed as `slug-held`).
  const stale = existing.filter((r) => r.holder === 'apple' && !groups.get(key(r.user_id, r.environment))?.apple.has(r.slug)
    && [...groups.values()].some((o) => o.uid !== r.user_id && o.env === r.environment && o.apple.has(r.slug)));
  const live = existing.filter((r) => !stale.includes(r));
  const byAccount = new Map(live.map((r) => [key(r.user_id, r.environment), r]));
  const heldSlugs = new Map(live.map((r) => [r.slug, r.user_id]));
  const out: BackfillPlan = { toInsert: [], toDelete: stale, alreadyThere: 0, listed: [] };
  const claimedSlugs = new Map<string, string>();
  for (const v of [...groups.values()].sort((a, b) => (key(a.uid, a.env) < key(b.uid, b.env) ? -1 : 1))) {
    const list = (reason: ListedReason, slugs: string[]) => out.listed.push({ user_id: v.uid, environment: v.env, reason, slugs });
    if (v.web.size && v.apple.size) { list('mixed', [...v.web, ...v.apple.keys()]); continue; }
    if (v.web.size > 1) { list('multiple-web', [...v.web]); continue; }
    if (v.apple.size > 1) { list('multiple-apple', [...v.apple.keys()]); continue; }
    const holder: Holder = v.web.size ? 'web' : 'apple';
    const slug = v.web.size ? [...v.web][0] : [...v.apple.keys()][0];
    const have = byAccount.get(key(v.uid, v.env));
    if (have) {
      if (have.slug === slug && have.holder === holder) out.alreadyThere++;
      else list('differs', [have.slug, slug]);
      continue;
    }
    // account_sites.slug is unique across BOTH environments, so a slug already held or claimed by anyone, the same account in the other environment included, is listed (Production sorts first and keeps it).
    if (heldSlugs.has(slug) || claimedSlugs.has(slug)) { list('slug-held', [slug]); continue; }
    claimedSlugs.set(slug, v.uid);
    out.toInsert.push({ user_id: v.uid, environment: v.env, slug, holder, published_once: holder === 'web' ? true : !!v.apple.get(slug) });
  }
  // Gone accounts are listed (never inserted, never counted as holding or claiming a slug, never a reason to remove a living account's stale row).
  for (const v of [...gone.values()].sort((a, b) => (key(a.uid, a.env) < key(b.uid, b.env) ? -1 : 1))) out.listed.push({ user_id: v.uid, environment: v.env, reason: 'user-gone', slugs: [...v.slugs] });
  return out;
}

export interface BackfillDeps {
  webSites(): Promise<WebSiteSource[]>;
  apple(): Promise<AppleSource[]>;
  existing(): Promise<ExistingRow[]>;
  /** Remove a stale Apple row. Re-reads ios_purchases first and skips (false) when the holder still owns the purchase. True when removed. */
  remove(row: ExistingRow): Promise<boolean>;
  /** Insert-ignore on the primary key; true when inserted. */
  insert(row: BackfillRow): Promise<boolean | 'user-gone' | 'slug-held'>;
  /** Ids of the accounts that exist (auth.users), read once. Optional: without it nobody is skipped at plan time (the insert's own check still applies). */
  users?(): Promise<Set<string>>;
}

export interface BackfillResult { plan: BackfillPlan; inserted: number; removed: number; applied: boolean; /** Rows the database refused at insert time (account deleted meanwhile, or slug taken): listed, the run went on. */ insertSkipped: Listed[] }

/** Plan, and with `apply` insert. A row another run inserted meanwhile (insert returns false) is not counted. Throws on a read error; stops on a write error, except a refusal the insert reports as user-gone / slug-held (listed, run continues). */
export async function runBackfill(deps: BackfillDeps, opts: { apply: boolean }): Promise<BackfillResult> {
  const [web, apple, existing, users] = await Promise.all([deps.webSites(), deps.apple(), deps.existing(), deps.users ? deps.users() : Promise.resolve(undefined)]);
  const plan = planBackfill(web, apple, existing, users);
  const insertSkipped: Listed[] = [];
  let inserted = 0;
  let removed = 0;
  if (opts.apply) {
    for (const row of plan.toDelete) if (await deps.remove(row)) removed++;
    for (const row of plan.toInsert) {
      const got = await deps.insert(row);
      if (got === 'user-gone' || got === 'slug-held') insertSkipped.push({ user_id: row.user_id, environment: row.environment, reason: got, slugs: [row.slug] });
      else if (got) inserted++;
    }
  }
  return { plan, inserted, removed, applied: opts.apply, insertSkipped };
}

/** Live readers and writer (service role). Pages through each table so a large table is read whole. */
export async function liveBackfillDeps(rest?: (path: string, init?: any) => Promise<any>, fetchImpl: typeof fetch = fetch): Promise<BackfillDeps> {
  const sbRest = rest ?? (await import('../webApp/webAppServer.js')).sbRest;
  const all = async (path: string, order: string): Promise<any[]> => {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = ((await sbRest(`${path}&order=${order}.asc&limit=1000&offset=${offset}`)) ?? []) as any[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };
  return {
    // GoTrue admin list, 1000 per page, read once: 1 request for ~100 users, N/1000 sequential requests for N users. Fails closed (a read error or an empty list throws; nothing is written).
    async users() {
      const url = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !k) throw new Error('supabase not configured');
      const ids = new Set<string>();
      let total: number | null = null;
      let emptyEnd = false;
      // Page until an EMPTY page, never a short one: a server that silently caps per_page returns short pages that are not the last.
      for (let page = 1; page <= 1000; page++) {
        const r = await fetchImpl(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: { apikey: k, Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30_000) });
        if (!r.ok) throw new Error(`auth user list ${r.status}`);
        const j: any = await r.json().catch(() => null);
        if (!Array.isArray(j?.users)) throw new Error('auth user list unreadable');
        const t = Number(r.headers?.get?.('x-total-count'));
        if (Number.isFinite(t) && r.headers?.get?.('x-total-count') !== null && t >= 0) total = t;
        if (j.users.length === 0) { emptyEnd = true; break; }
        for (const u of j.users) if (typeof u?.id === 'string') ids.add(u.id);
      }
      if (!emptyEnd) throw new Error('auth user list did not end (page limit reached)');
      if (total !== null && ids.size < total) throw new Error(`auth user list incomplete: got ${ids.size} of ${total}`);
      if (ids.size === 0) throw new Error('auth user list empty: refusing to treat every account as gone');
      return ids;
    },
    webSites: () => all('web_app_sites?published_at=not.is.null&select=user_id,slug,environment,published_at', 'slug.asc,environment'),
    apple: () => all('ios_purchases?user_id=not.is.null&site_slug=not.is.null&select=user_id,site_slug,environment,published_at', 'site_slug.asc,original_transaction_id'),
    existing: () => all('account_sites?select=user_id,environment,slug,holder', 'slug.asc,user_id.asc,environment'),
    async remove(row) {
      // Re-read the purchases right before deleting: the holder may still own this purchase (a page of the list above could have missed its row). Skip then.
      const still = (await sbRest(`ios_purchases?user_id=eq.${encodeURIComponent(row.user_id)}&site_slug=eq.${encodeURIComponent(row.slug)}&environment=eq.${row.environment}&select=original_transaction_id&limit=1`)) ?? [];
      if (Array.isArray(still) && still.length > 0) return false;
      await sbRest(`account_sites?user_id=eq.${encodeURIComponent(row.user_id)}&environment=eq.${row.environment}&slug=eq.${encodeURIComponent(row.slug)}&holder=eq.apple`, { method: 'DELETE' });
      return true;
    },
    async insert(row) {
      try {
        const got = await sbRest('account_sites?on_conflict=user_id,environment', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: row });
        return Array.isArray(got) && got.length > 0;
      } catch (e: any) {
        // 409 only: 23503 on the user (the account was deleted after the list was read, or the list was incomplete) and 23505 on the slug. Anything else stops the run.
        const text = String(e?.pgDetails ?? '');
        if (e?.status === 409 && e?.code === '23503' && /user_id|users/i.test(text)) return 'user-gone';
        if (e?.status === 409 && e?.code === '23505' && /slug/i.test(text)) return 'slug-held';
        throw e;
      }
    },
  };
}
