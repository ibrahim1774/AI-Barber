// Real dependencies for lib/admin/sites.ts: Supabase (service role), GCS, Vercel (via
// publishSite). Used by api/admin/sites.ts and scripts/admin-sites.mjs only — never
// shipped to the browser.
//
// Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// GCP_SERVICE_ACCOUNT_JSON (or GCS_CREDENTIALS), GCS_BUCKET_NAME, VERCEL_TOKEN.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { bucket, publishSite, readPendingSite, renderPending, slugify, writePendingSite, type PendingSite } from '../publishSite.js';
import type { PurchaseRow } from '../ios/purchases.js';
import type { AdminSitesDeps, HistoryEntry, RepublishRun, SiteStore } from './sites.js';

const HISTORY = 'pending-sites-history';
const RUNS = 'admin-republish-runs';

/** Same stored content (ignoring nothing: a history copy is the whole pending object). */
export function sameContent(a: PendingSite, b: PendingSite): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Newest first: by version, then by the "-<ms>" suffix (a later duplicate first). */
export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const suffix = (id: string) => Number(id.split('-')[1] || 0);
  return [...entries].sort((a, b) => b.version - a.version || suffix(b.id) - suffix(a.id));
}

export function adminSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false } });
}

const json = (data: unknown) => JSON.stringify(data);
const noStore = { cacheControl: 'private, max-age=0, no-store' };

async function readJson(path: string): Promise<any | null> {
  const file = bucket().file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  try {
    return JSON.parse(buf.toString('utf-8'));
  } catch {
    return null;
  }
}

/** GCS-backed store: pending-sites/ (as publish writes it), history copies and run progress. */
export function gcsSiteStore(): SiteStore {
  return {
    readPending: readPendingSite,
    writePending: writePendingSite,

    async writeHistory(slug, version, p) {
      const safe = slugify(slug);
      const save = (id: string) =>
        bucket().file(`${HISTORY}/${safe}/${id}.json`).save(json({ siteId: safe, savedAt: Date.now(), data: p }), {
          contentType: 'application/json',
          // Write-once: a history copy is never overwritten.
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { ...noStore, metadata: { version: String(version), editedBy: p.editedBy || '', editedAt: p.editedAt || '' } },
        });
      const id = String(version);
      try {
        await save(id);
        return id;
      } catch (e: any) {
        if (e?.code !== 412) throw e;
      }
      // That version number is already kept. Same content (a retried edit): reuse it.
      // Different content (the version number repeated): keep this one under its own key.
      const existing = ((await readJson(`${HISTORY}/${safe}/${id}.json`)) || {}).data as PendingSite | undefined;
      if (existing && sameContent(existing, p)) return id;
      const unique = `${version}-${Date.now()}`;
      await save(unique);
      return unique;
    },

    async readHistory(slug, id) {
      if (!/^\d+(-\d+)?$/.test(id)) return null;
      return ((await readJson(`${HISTORY}/${slugify(slug)}/${id}.json`)) || {}).data || null;
    },

    async listHistory(slug) {
      const [files] = await bucket().getFiles({ prefix: `${HISTORY}/${slugify(slug)}/` });
      const out: HistoryEntry[] = [];
      for (const f of files) {
        const m = /\/((\d+)(?:-\d+)?)\.json$/.exec(f.name);
        if (!m) continue;
        const meta = (f.metadata?.metadata || {}) as Record<string, string>;
        out.push({
          id: m[1],
          version: Number(m[2]),
          editedBy: meta.editedBy === 'admin' || meta.editedBy === 'owner' ? meta.editedBy : null,
          editedAt: meta.editedAt || null,
        });
      }
      return sortHistory(out);
    },

    async readRun(runId) {
      return (await readJson(`${RUNS}/${runId}.json`)) as RepublishRun | null;
    },

    async writeRun(runId, run) {
      await bucket().file(`${RUNS}/${runId}.json`).save(json(run), { contentType: 'application/json', metadata: noStore });
    },
  };
}

export function liveAdminDeps(): AdminSitesDeps {
  let sb: SupabaseClient | undefined;
  const db = () => (sb ??= adminSupabase());
  const store = gcsSiteStore();
  return {
    async listBound() {
      const PAGE = 1000;
      const all: PurchaseRow[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db().from('ios_purchases').select('*').not('site_slug', 'is', null)
          .order('site_slug', { ascending: true }).range(from, from + PAGE - 1);
        if (error) throw new Error(`ios_purchases list failed: ${error.message}`);
        all.push(...((data || []) as PurchaseRow[]));
        if (!data || data.length < PAGE) return all;
      }
    },

    async findBySlug(slug) {
      const { data, error } = await db().from('ios_purchases').select('*').eq('site_slug', slugify(slug)).maybeSingle();
      if (error) throw new Error(`ios_purchases findBySlug failed: ${error.message}`);
      return (data as PurchaseRow) ?? null;
    },

    async emailsByUserId(ids) {
      const map = new Map<string, string>();
      if (ids && ids.length <= 20) {
        await Promise.all(ids.map(async (id) => {
          const { data } = await db().auth.admin.getUserById(id);
          if (data?.user?.email) map.set(id, data.user.email.toLowerCase());
        }));
        return map;
      }
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw new Error(`auth listUsers failed: ${error.message}`);
        for (const u of data.users) if (u.email) map.set(u.id, u.email.toLowerCase());
        if (data.users.length < 200) break;
      }
      return map;
    },

    store,
    publish: (slug, opts) => publishSite(slug, opts),
    render: (p) => renderPending(p),

    async audit(e) {
      const { error } = await db().from('ab_events').insert({ kind: 'admin_site_edit', payload: { ...e, at: new Date().toISOString() } });
      if (error) throw new Error(error.message);
    },

    now: () => Date.now(),
    takedownSandbox: process.env.IOS_TAKEDOWN_SANDBOX === '1',
  };
}

