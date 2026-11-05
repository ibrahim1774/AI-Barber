// The generate-once cache and claim: public.ab_service_copy (migration 028, additive, NOT applied by the build agent).
//   one row per (user, draft, title key). state 'pending' = a call is in flight (a lease: claimed_at); 'done' = the text, kept for good.
// Everything here may throw StoreError. The caller treats ANY StoreError as "the AI is not available" and makes no model call, so
// before migration 028 is applied (PostgREST answers 404/400 for the missing table) the feature is inert.
import type { GuideId } from '../render/copyLibrary.js';
import type { SvcCopyEntry } from '../render/svcCopy.js';
import { sbRest } from '../webApp/webAppServer.js';

export class StoreError extends Error { constructor() { super('store_unavailable'); } }

export const LEASE_MS = 90_000;
export const STORE_TIMEOUT_MS = 5000;

/** `kind` 'write' (default) = the Mode B text/proposal row; 'family' = the Mode A classifier choice row (title_key is stored as `family:<titleKey>`). */
export interface CopyKey { userId: string; draftId: string; titleKey: string; kind?: 'write' | 'family' }
/** What a family row holds (never text). */
export interface FamilyChoice { v: 1; family: GuideId }
export interface CopyRow {
  state: 'pending' | 'done'; factsHash: string; claimToken: string | null; claimedAt: number; copy: SvcCopyEntry | FamilyChoice | null;
  /** write rows: null = a PROPOSAL (never renders); 'owner' = the barber tapped "Looks right"; 'auto' = written while SERVICE_COPY_AUTO_PUBLISH was on. */
  approval: 'owner' | 'auto' | null;
}
export const isFamilyChoice = (c: unknown): c is FamilyChoice => !!c && typeof c === 'object' && (c as FamilyChoice).v === 1 && typeof (c as FamilyChoice).family === 'string' && Object.keys(c as object).length === 2;
export const isTextEntry = (c: unknown): c is SvcCopyEntry => !!c && typeof c === 'object' && !('family' in (c as object));
const rowKey = (k: CopyKey): string => (k.kind === 'family' ? `family:${k.titleKey}` : k.titleKey);

export interface CopyStore {
  get(k: CopyKey): Promise<CopyRow | null>;
  /** Creates a pending row. False when a row already exists (someone else is first). */
  claim(k: CopyKey, token: string, factsHash: string, now: number): Promise<boolean>;
  /** Takes over a pending row whose lease ran out. False when it is not stale (or gone). */
  takeover(k: CopyKey, token: string, factsHash: string, now: number): Promise<boolean>;
  /** pending -> done, only for the holder of the claim. False when the claim was lost. */
  finish(k: CopyKey, token: string, copy: SvcCopyEntry | FamilyChoice, meta: { tokensIn: number; tokensOut: number; approval?: 'auto' | null }): Promise<boolean>;
  /** Owner approval of a finished write row (a proposal, or text written under the auto flag -> owner-approved). False when there is no finished row or it is already owner-approved. */
  approve(k: CopyKey): Promise<boolean>;
  /** Removes a pending row held by `token` (a failed or refused attempt leaves nothing behind). */
  release(k: CopyKey, token: string): Promise<void>;
  /** Removes the row whatever its state (a stale cache, a removed service). */
  remove(k: CopyKey): Promise<void>;
  /** Removes every row of the draft whose title key is in `titleKeys`. */
  removeMany(userId: string, draftId: string, titleKeys: readonly string[]): Promise<void>;
}

const enc = encodeURIComponent;
const where = (k: CopyKey) => `user_id=eq.${enc(k.userId)}&draft_id=eq.${enc(k.draftId)}&title_key=eq.${enc(rowKey(k))}`;
const T = 'ab_service_copy';

async function call<R>(f: () => Promise<R>): Promise<R> {
  try { return await f(); } catch { throw new StoreError(); }
}

export const tableCopyStore: CopyStore = {
  get: (k) => call(async () => {
    const rows = await sbRest(`${T}?${where(k)}&select=state,facts_hash,claim_token,claimed_at,copy,approval&limit=1`, { timeoutMs: STORE_TIMEOUT_MS });
    const r = Array.isArray(rows) ? rows[0] : null;
    if (!r) return null;
    if ((r.state !== 'pending' && r.state !== 'done') || typeof r.facts_hash !== 'string') throw new Error('bad row');
    return { state: r.state, factsHash: r.facts_hash, claimToken: r.claim_token ?? null, claimedAt: Date.parse(r.claimed_at) || 0, copy: r.copy ?? null, approval: r.approval === 'owner' || r.approval === 'auto' ? r.approval : null };
  }),
  claim: (k, token, factsHash, now) => call(async () => {
    const rows = await sbRest(`${T}?on_conflict=user_id,draft_id,title_key`, {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', timeoutMs: STORE_TIMEOUT_MS,
      body: { user_id: k.userId, draft_id: k.draftId, title_key: rowKey(k), state: 'pending', claim_token: token, claimed_at: new Date(now).toISOString(), facts_hash: factsHash },
    });
    return Array.isArray(rows) && rows.length > 0;
  }),
  takeover: (k, token, factsHash, now) => call(async () => {
    const rows = await sbRest(`${T}?${where(k)}&state=eq.pending&claimed_at=lt.${enc(new Date(now - LEASE_MS).toISOString())}&select=title_key`, {
      method: 'PATCH', prefer: 'return=representation', timeoutMs: STORE_TIMEOUT_MS,
      body: { claim_token: token, claimed_at: new Date(now).toISOString(), facts_hash: factsHash },
    });
    return Array.isArray(rows) && rows.length > 0;
  }),
  finish: (k, token, copy, meta) => call(async () => {
    const rows = await sbRest(`${T}?${where(k)}&state=eq.pending&claim_token=eq.${enc(token)}&select=title_key`, {
      method: 'PATCH', prefer: 'return=representation', timeoutMs: STORE_TIMEOUT_MS,
      body: { state: 'done', copy, claim_token: null, tokens_in: meta.tokensIn, tokens_out: meta.tokensOut, finished_at: new Date().toISOString(), approval: meta.approval ?? null },
    });
    return Array.isArray(rows) && rows.length > 0;
  }),
  approve: (k) => call(async () => {
    const rows = await sbRest(`${T}?${where(k)}&state=eq.done&or=(approval.is.null,approval.eq.auto)&select=title_key`, { method: 'PATCH', prefer: 'return=representation', timeoutMs: STORE_TIMEOUT_MS, body: { approval: 'owner' } });
    return Array.isArray(rows) && rows.length > 0;
  }),
  release: (k, token) => call(async () => {
    await sbRest(`${T}?${where(k)}&state=eq.pending&claim_token=eq.${enc(token)}`, { method: 'DELETE', timeoutMs: STORE_TIMEOUT_MS });
  }),
  remove: (k) => call(async () => { await sbRest(`${T}?${where(k)}`, { method: 'DELETE', timeoutMs: STORE_TIMEOUT_MS }); }),
  removeMany: (userId, draftId, keys) => call(async () => {
    if (!keys.length) return;
    // Both rows of a service (the text/proposal and the family choice) go together.
    const list = keys.slice(0, 60).flatMap((x) => [x, `family:${x}`]).map((x) => `"${x.replace(/(["\\])/g, '\\$1')}"`).join(',');
    await sbRest(`${T}?user_id=eq.${enc(userId)}&draft_id=eq.${enc(draftId)}&title_key=in.(${enc(list)})`, { method: 'DELETE', timeoutMs: STORE_TIMEOUT_MS });
  }),
};

/** In-memory store with the same semantics (tests, and a drop-in fake). */
export function memoryCopyStore(): CopyStore & { rows: Map<string, CopyRow>; fail: boolean } {
  const rows = new Map<string, CopyRow>();
  const id = (k: CopyKey) => `${k.userId}|${k.draftId}|${rowKey(k)}`;
  const s = {
    rows, fail: false,
    async get(k: CopyKey) { if (s.fail) throw new StoreError(); const r = rows.get(id(k)); return r ? { ...r } : null; },
    async claim(k: CopyKey, token: string, factsHash: string, now: number) {
      if (s.fail) throw new StoreError();
      if (rows.has(id(k))) return false;
      rows.set(id(k), { state: 'pending', factsHash, claimToken: token, claimedAt: now, copy: null, approval: null });
      return true;
    },
    async takeover(k: CopyKey, token: string, factsHash: string, now: number) {
      if (s.fail) throw new StoreError();
      const r = rows.get(id(k));
      if (!r || r.state !== 'pending' || r.claimedAt >= now - LEASE_MS) return false;
      rows.set(id(k), { ...r, claimToken: token, claimedAt: now, factsHash });
      return true;
    },
    async finish(k: CopyKey, token: string, copy: SvcCopyEntry | FamilyChoice, meta?: { approval?: 'auto' | null }) {
      if (s.fail) throw new StoreError();
      const r = rows.get(id(k));
      if (!r || r.state !== 'pending' || r.claimToken !== token) return false;
      rows.set(id(k), { ...r, state: 'done', claimToken: null, copy, approval: meta?.approval ?? null });
      return true;
    },
    async approve(k: CopyKey) {
      if (s.fail) throw new StoreError();
      const r = rows.get(id(k));
      if (!r || r.state !== 'done' || (r.approval !== null && r.approval !== 'auto')) return false; // an 'auto' row (written while the flag was on) can be approved after the flag is turned off
      rows.set(id(k), { ...r, approval: 'owner' });
      return true;
    },
    async release(k: CopyKey, token: string) { if (s.fail) throw new StoreError(); const r = rows.get(id(k)); if (r && r.state === 'pending' && r.claimToken === token) rows.delete(id(k)); },
    async remove(k: CopyKey) { if (s.fail) throw new StoreError(); rows.delete(id(k)); },
    async removeMany(userId: string, draftId: string, keys: readonly string[]) { if (s.fail) throw new StoreError(); for (const t of keys) { rows.delete(id({ userId, draftId, titleKey: t })); rows.delete(id({ userId, draftId, titleKey: t, kind: 'family' })); } },
  };
  return s;
}
