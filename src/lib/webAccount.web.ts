import { readWebDraftBase, rememberWebDraftBase } from './webDraftBase';
import { emitSiteAdopted, onSiteAdopted } from './siteEvents';
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { supabase } from './supabase';
import * as store from './siteStore';
import { publishPayload } from './publish';
import { appPrefsField } from './account';
import { DraftConflict, DraftEngine, sameDraft, type SavedDraft } from './webDraftEngine';

const BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';
export type SaveState = { kind: 'idle' | 'saving' | 'saved' | 'retry' | 'conflict'; message?: string; conflict?: DraftConflict };
let state: SaveState = { kind: 'idle' };
const listeners = new Set<() => void>();
const set = (s: SaveState) => { state = s; listeners.forEach(f => f()); };
export const useWebSaveState = () => useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => state, () => state);
export const currentWebSaveState = () => state;
export const resetWebSaveState = () => set({ kind: 'idle' });
const owner = async () => (await supabase.auth.getSession()).data.session?.user.id ?? null;
const payload = (s: store.SiteRecord) => ({ ...publishPayload(s.data), source: 'web-app', ...appPrefsField(s.inputs) });
const transientImage = (v: any): boolean => typeof v === 'string' ? /^\s*(data|blob|file):/i.test(v)
  : Array.isArray(v) ? v.some(transientImage) : !!v && typeof v === 'object' && Object.values(v).some(transientImage);
async function request(path: string, method = 'GET', body?: unknown): Promise<any> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Sign in to save your website.');
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(`${BASE}/api/web-app/${path}`, { method, signal: ctrl.signal,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(r.status === 409 ? 'Changes arrived from another device.' : 'Your changes have not saved to your account yet. Check your connection and retry.'), { code: data.error });
    return data;
  } finally { clearTimeout(timeout); }
}
const readRows = new Map<string, SavedDraft>();
onSiteAdopted(s => {
  const uid = s.ownerUserId; const row = uid ? readRows.get(uid) : null;
  if (uid && row && row.id === s.draftId && sameDraft(payload(s), row.site_data)) {
    void rememberWebDraftBase({ owner: uid, row }).catch(() => {});
  }
});
const engine = new DraftEngine({
  owner,
  async local() {
    const uid = await owner(); const local = await store.loadSite();
    if (!local || local.ownerUserId && local.ownerUserId !== uid) return null;
    if (transientImage(local.data)) throw new Error('A photo has not finished uploading. Finish or replace that photo before continuing.');
    return { id: local.draftId, data: payload(local) };
  },
  base: readWebDraftBase,
  remember: rememberWebDraftBase,
  read: async () => (await request('draft')).draft,
  write: async (local, expectedRevision) => (await request('draft', 'PUT', { id: local.id, site_data: local.data, expectedRevision })).draft,
  async apply(expected, saved) {
    const local = await store.loadSite();
    if (!local || local.draftId !== expected.id || !sameDraft(payload(local), expected.data)) return;
    const { source: _source, iosPrefs: prefs, ...data } = saved.site_data;
    const inputs = { ...local.inputs };
    for (const k of ['bookingChoice','ownBookingUrl','ownBookingCleared','pricesReviewed','samplePricesApplied','samplePricesFilled'] as const) delete inputs[k];
    Object.assign(inputs, prefs ?? {}, { shopName: data.shopName, area: data.area, phone: data.phone });
    const next = { ...local, draftId: saved.id, data, inputs,
      ownerUserId: await owner() ?? undefined, accountSyncedAt: local.updatedAt, accountRowAt: Date.parse(saved.updated_at) };
    if (!sameDraft(next, local)) { await store.saveSite(next); }
    readRows.delete(next.ownerUserId ?? '');
    // Keep the editor's in-memory record aligned with a merged remote field. A later local edit must not replay stale fields.
    if (!sameDraft(local.data, next.data) || !sameDraft(local.inputs, next.inputs)) emitSiteAdopted(next);
  },
  async keepConflict(uid, local, remote) {
    await Storage.setItem(`webDraftConflict.v2.${uid}`, JSON.stringify({ local, remote, at: Date.now() }));
  },
});
export const invalidateWebDraftReceipt = () => engine.invalidate();
export async function ensureWebDraftSaved(): Promise<SavedDraft> {
  const uid = await owner();
  if (!uid) throw new Error('Sign in to save your website.');
  set({ kind: 'saving' });
  try { const row = await engine.save(); set({ kind: 'saved' }); return row; }
  catch (e: any) {
    set(e instanceof DraftConflict ? { kind: 'conflict', conflict: e, message: e.message } : { kind: 'retry', message: e.message });
    throw e;
  }
}
export async function readWebAccountSite(uid: string) {
  if (await owner() !== uid) throw new Error('Account changed');
  const row: SavedDraft | null = (await request('draft')).draft;
  if (await owner() !== uid) throw new Error('Account changed');
  // Remember the new baseline only once this exact row is adopted; an edit during the read keeps the old base.
  if (row) readRows.set(uid, row);
  return { data: row, error: null };
}
export async function saveWebAccountSite(_site: store.SiteRecord, uid: string): Promise<number> {
  if (await owner() !== uid) throw new Error('Account changed');
  return Date.parse((await ensureWebDraftSaved()).updated_at);
}
export async function resolveWebDraftConflict(choice: 'local' | 'remote') {
  if (!state.conflict) return;
  engine.resolve(state.conflict.remote.revision, choice);
  await ensureWebDraftSaved();
}
export async function webPublishStatus(retry = false) { return request('publish-status', retry ? 'POST' : 'GET'); }

/** Learn publication metadata without replacing edits made since the submitted revision. */
export async function adoptWebPublishedBinding(uid: string) {
  const row: SavedDraft | null = (await request('draft')).draft;
  if (!row?.webBinding?.slug || await owner() !== uid) return;
  const local = await store.loadSite();
  if (!local || local.draftId !== row.id || local.ownerUserId !== uid) return;
  const b = row.webBinding;
  const next = { ...local, slug: b.slug, transactionId: b.transactionId, deployedUrl: row.deployed_url ?? local.deployedUrl,
    ...(typeof b.serverVersion === 'number' && b.serverVersion >= (local.serverVersion ?? 0) ? { serverVersion: b.serverVersion } : {}),
    ...(b.publishedRevision === row.revision && sameDraft(payload(local), row.site_data) ? { syncedAt: local.updatedAt } : {}) };
  if (!sameDraft(next, local)) {
    await store.saveSite(next);
    const { emitSiteAdopted } = await import('./siteEvents'); emitSiteAdopted(next);
  }
}
