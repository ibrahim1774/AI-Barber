import { sameDraft } from './webDraftEngine';
import { emitSiteAdopted } from './siteEvents';
import { pendingWebAssets } from './webAssets';
import { webDraftsEnabled } from './webReliability';
import { pullSiteFromAccount } from './account';
import { flushWebAutosave as legacyFlush } from './webAutosaveLegacy.web';
import { ensureWebDraftSaved, currentWebSaveState, resetWebSaveState } from './webAccount.web';
import { loadSite, onSiteSaved } from './siteStore';
import { supabase } from './supabase';
import { clearResume } from './webResume';
import type { SavedDraft } from './webDraftEngine';

let timer: ReturnType<typeof setTimeout> | null = null;
let retry = 0;
function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void push(); }, ms);
}
async function push() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) return;
  const local = await loadSite();
  if (!local || local.ownerUserId && local.ownerUserId !== uid) return;
  try { await ensureWebDraftSaved(); retry = 0; }
  catch {
    if (currentWebSaveState().kind !== 'conflict') schedule(Math.min(30_000, 2000 * 2 ** Math.min(retry++, 4)));
  }
}
/** Strict acknowledgement. A timeout preserves the draft and blocks checkout; it never means saved. */
export async function flushWebAutosave(capMs = 12_000): Promise<SavedDraft> {
  if (!webDraftsEnabled()) { await legacyFlush(capMs); return undefined as unknown as SavedDraft; }
  if (pendingWebAssets()) throw new Error('Your photo is still uploading. Wait for it to finish, then continue.');
  if (timer) { clearTimeout(timer); timer = null; }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      ensureWebDraftSaved(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Your latest changes are still saving. Please retry in a moment.')), capMs); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}
async function refreshFromAccount() {
  await push();
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (uid) await pullSiteFromAccount(uid);
}
if (webDraftsEnabled() && typeof window !== 'undefined' && typeof document !== 'undefined') {
  onSiteSaved(s => { if ((s.accountSyncedAt ?? -1) < s.updatedAt) schedule(1000); });
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') { clearResume(); resetWebSaveState(); if (timer) clearTimeout(timer); }
    else schedule(0);
  });
  window.addEventListener('storage', event => {
    if (event.key !== 'abapp:site.v1' || !event.newValue) return;
    void (async () => {
      try {
        const next = JSON.parse(event.newValue!);
        const previous = event.oldValue ? JSON.parse(event.oldValue) : null;
        if (sameDraft(previous?.data, next.data) && sameDraft(previous?.inputs, next.inputs)) return;
        const uid = (await supabase.auth.getSession()).data.session?.user.id;
        const current = await loadSite();
        if (uid && next.ownerUserId === uid && sameDraft(current, next)) emitSiteAdopted(next);
      } catch { /* An unreadable other-tab event never replaces the editor. */ }
    })();
  });
  window.addEventListener('online', () => { retry = 0; void push(); });
  window.addEventListener('focus', () => { void refreshFromAccount(); });
  window.addEventListener('pagehide', () => { void push(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void push(); else void refreshFromAccount(); });
}
