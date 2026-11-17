// Kept copies (one-account plan, lane C3; migration 040): whole-site copies set aside, 90 days, at most 50 per account.
// Logic over an injected store so it is unit-tested; api/account/kept-copy.ts is the thin handler.
import { digest } from '../webApp/reliability.js';
import { sbRest } from '../webApp/webAppServer.js';
import { jsonBytes } from '../ios/siteShape.js';
import { tableMissing } from './sites.js';

export const KEPT_CAP = 50;
export const KEPT_KINDS = ['phone-draft', 'account-copy-before-replace'] as const;
export type KeptKind = (typeof KEPT_KINDS)[number];

export interface KeptStore {
  /** True when the account already holds a copy with this digest. */
  has(uid: string, digest: string): Promise<boolean>;
  /** Delete this account's copies beyond the newest `keep`, oldest first. */
  trim(uid: string, keep: number): Promise<void>;
  /** Insert-ignore on (user_id, digest). */
  insert(row: { user_id: string; environment: string; slug: string | null; kind: KeptKind; site_data: unknown; source_version: number | null; digest: string }): Promise<void>;
  /** Delete copies with expires_at before `nowIso`; returns how many. */
  expire(nowIso: string): Promise<number>;
}

export type KeptResult =
  | { status: 200; body: { ok: true; stored: boolean } }
  | { status: 400 | 413 | 503; body: { error: string; maxBytes?: number } };

/** Largest body: the draft size limit (api/web-app/draft.ts MAX_DRAFT_BYTES, 1 MB). */
export const MAX_KEPT_BYTES = 1024 * 1024;

export async function storeKeptCopy(uid: string, environment: string, body: any, store: KeptStore = liveKeptStore()): Promise<KeptResult> {
  if (jsonBytes(body) > MAX_KEPT_BYTES) return { status: 413, body: { error: 'kept_copy_too_large', maxBytes: MAX_KEPT_BYTES } };
  const { kind, siteData, slug, sourceVersion } = body ?? {};
  if (!KEPT_KINDS.includes(kind) || !siteData || typeof siteData !== 'object' || Array.isArray(siteData)
    || (slug != null && (typeof slug !== 'string' || slug.length > 100))
    || (sourceVersion != null && !(Number.isInteger(sourceVersion) && sourceVersion >= 0 && sourceVersion < 2 ** 31))) {
    return { status: 400, body: { error: 'invalid_kept_copy' } };
  }
  const d = digest(siteData);
  try {
    if (await store.has(uid, d)) return { status: 200, body: { ok: true, stored: false } };
    await store.trim(uid, KEPT_CAP - 1); // room for the new one: at most 50 after the insert, oldest out first
    await store.insert({ user_id: uid, environment, slug: slug ?? null, kind, site_data: siteData, source_version: sourceVersion ?? null, digest: d });
    return { status: 200, body: { ok: true, stored: true } };
  } catch (e: any) {
    console.error('[kept copy]', tableMissing(e) ? 'table missing (migration 040 not applied)' : e?.status ?? e?.message);
    return { status: 503, body: { error: 'kept_copy_unavailable' } };
  }
}

const enc = encodeURIComponent;
export function liveKeptStore(): KeptStore {
  return {
    async has(uid, d) { return ((await sbRest(`site_kept_copies?user_id=eq.${enc(uid)}&digest=eq.${enc(d)}&select=id&limit=1`)) ?? []).length > 0; },
    async trim(uid, keep) {
      const old = ((await sbRest(`site_kept_copies?user_id=eq.${enc(uid)}&select=id&order=created_at.desc&offset=${keep}&limit=1000`)) ?? []) as { id: string }[];
      if (old.length) await sbRest(`site_kept_copies?id=in.(${old.map((r) => r.id).join(',')})`, { method: 'DELETE', prefer: 'return=minimal' });
    },
    async insert(row) { await sbRest('site_kept_copies?on_conflict=user_id,digest', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=minimal' }); },
    async expire(nowIso) {
      const got = await sbRest(`site_kept_copies?expires_at=lt.${enc(nowIso)}`, { method: 'DELETE', prefer: 'return=representation' });
      return Array.isArray(got) ? got.length : 0;
    },
  };
}
