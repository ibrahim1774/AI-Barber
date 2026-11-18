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
import { kindEnvOf, type KindEnv } from './kind.js';
import type { Holder } from './sites.js';

export interface WebSiteSource { user_id: string; slug: string; environment: 'live' | 'test'; published_at: string | null }
export interface AppleSource { user_id: string | null; site_slug: string | null; environment: string | null; published_at?: string | null }
export interface ExistingRow { user_id: string; environment: KindEnv; slug: string; holder: Holder }

export interface BackfillRow { user_id: string; environment: KindEnv; slug: string; holder: Holder; published_once: boolean }
export type ListedReason = 'mixed' | 'multiple-web' | 'multiple-apple' | 'slug-held' | 'differs';
export interface Listed { user_id: string; environment: KindEnv; reason: ListedReason; slugs: string[] }
export interface BackfillPlan { toInsert: BackfillRow[]; /** Stale Apple rows (the purchase moved to another account while the guard was off), removed before the insert. */ toDelete: ExistingRow[]; alreadyThere: number; listed: Listed[] }

const key = (u: string, e: string) => `${u}|${e}`;

/** Pure: what to insert and what to list. */
export function planBackfill(web: WebSiteSource[], apple: AppleSource[], existing: ExistingRow[]): BackfillPlan {
  const groups = new Map<string, { uid: string; env: KindEnv; web: Set<string>; apple: Map<string, boolean> }>();
  const g = (uid: string, env: KindEnv) => {
    const k = key(uid, env);
    let v = groups.get(k);
    if (!v) { v = { uid, env, web: new Set(), apple: new Map() }; groups.set(k, v); }
    return v;
  };
  for (const w of web) if (w.published_at && w.user_id && w.slug) g(w.user_id, kindEnvOf(w.environment)).web.add(w.slug);
  for (const a of apple) {
    if (!a.user_id || !a.site_slug || (a.environment !== 'Production' && a.environment !== 'Sandbox')) continue;
    const v = g(a.user_id, a.environment);
    v.apple.set(a.site_slug, (v.apple.get(a.site_slug) ?? false) || !!a.published_at);
  }
  const byAccount = new Map(existing.map((r) => [key(r.user_id, r.environment), r]));
  const heldSlugs = new Map(existing.map((r) => [r.slug, r.user_id]));
  const out: BackfillPlan = { toInsert: [], toDelete: [], alreadyThere: 0, listed: [] };
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
    const owner = heldSlugs.get(slug) ?? claimedSlugs.get(slug);
    if (owner && owner !== v.uid) {
      const stale = existing.find((r) => r.slug === slug && r.user_id === owner);
      // The holder's Apple row is stale when its own purchases no longer include this slug (the purchase moved to this account).
      if (stale && stale.holder === 'apple' && stale.environment === v.env && holder === 'apple' && !groups.get(key(owner, stale.environment))?.apple.has(slug)) {
        out.toDelete.push(stale); heldSlugs.delete(slug);
      } else { list('slug-held', [slug]); continue; }
    }
    claimedSlugs.set(slug, v.uid);
    out.toInsert.push({ user_id: v.uid, environment: v.env, slug, holder, published_once: holder === 'web' ? true : !!v.apple.get(slug) });
  }
  return out;
}

export interface BackfillDeps {
  webSites(): Promise<WebSiteSource[]>;
  apple(): Promise<AppleSource[]>;
  existing(): Promise<ExistingRow[]>;
  /** Remove a stale Apple row (only while it is still that holder's row for that slug). */
  remove(row: ExistingRow): Promise<void>;
  /** Insert-ignore on the primary key; true when inserted. */
  insert(row: BackfillRow): Promise<boolean>;
}

export interface BackfillResult { plan: BackfillPlan; inserted: number; removed: number; applied: boolean }

/** Plan, and with `apply` insert. A row another run inserted meanwhile (insert returns false) is not counted. Throws on a read error; stops on a write error. */
export async function runBackfill(deps: BackfillDeps, opts: { apply: boolean }): Promise<BackfillResult> {
  const [web, apple, existing] = await Promise.all([deps.webSites(), deps.apple(), deps.existing()]);
  const plan = planBackfill(web, apple, existing);
  let inserted = 0;
  let removed = 0;
  if (opts.apply) {
    for (const row of plan.toDelete) { await deps.remove(row); removed++; }
    for (const row of plan.toInsert) if (await deps.insert(row)) inserted++;
  }
  return { plan, inserted, removed, applied: opts.apply };
}

/** Live readers and writer (service role). Pages through each table so a large table is read whole. */
export async function liveBackfillDeps(): Promise<BackfillDeps> {
  const { sbRest } = await import('../webApp/webAppServer.js');
  const all = async (path: string, order: string): Promise<any[]> => {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = ((await sbRest(`${path}&order=${order}.asc&limit=1000&offset=${offset}`)) ?? []) as any[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  };
  return {
    webSites: () => all('web_app_sites?published_at=not.is.null&select=user_id,slug,environment,published_at', 'slug'),
    apple: () => all('ios_purchases?user_id=not.is.null&site_slug=not.is.null&select=user_id,site_slug,environment,published_at', 'site_slug'),
    existing: () => all('account_sites?select=user_id,environment,slug,holder', 'slug'),
    async remove(row) {
      await sbRest(`account_sites?user_id=eq.${encodeURIComponent(row.user_id)}&environment=eq.${row.environment}&slug=eq.${encodeURIComponent(row.slug)}&holder=eq.apple`, { method: 'DELETE' });
    },
    async insert(row) {
      const got = await sbRest('account_sites?on_conflict=user_id,environment', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: row });
      return Array.isArray(got) && got.length > 0;
    },
  };
}
