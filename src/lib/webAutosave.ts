import { Platform } from 'react-native';
import { IOS_PREFS, onSiteAdopted, pullSiteFromAccount, syncIfSignedIn } from '@/lib/account';
import { merge3 } from '@/lib/mergeSite';
import { publishPayload } from '@/lib/publish';
import { keepRemoved } from '@/lib/sections/gallery';
import * as siteStore from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';
import Storage from 'expo-sqlite/kv-store';

// A browser can lose its local storage (cleared, private mode, Safari's 7-day rule) and a second device never sees
// edits that only live in one browser. So on the web every edit is copied to the signed-in account a moment after it
// is made (the phone app keeps its draft locally for good and copies it only on publish / sign-out).
//  - 1.5 s after the last edit: the draft is pushed (syncIfSignedIn: the same push the publish and sign-out use, which
//    also records what the account has). If another device wrote to the account since this one last synced, the two
//    copies are merged field by field first (mergeSite.ts), so edits made at the same moment on two devices both stay.
//  - tab hidden or closed: pushed at once, best effort.
//  - tab visible again / focused: a newer copy written by another device is adopted (pullSiteFromAccount only adopts
//    when this browser has no unsynced edits).
const DELAY_MS = 1500;
const BASE_KEY = 'webBase.v1';

type Base = { draftId: string; data: unknown };
const readBase = async (): Promise<Base | null> => { try { return JSON.parse((await Storage.getItem(BASE_KEY)) ?? 'null'); } catch { return null; } };
const writeBase = (b: Base) => Storage.setItem(BASE_KEY, JSON.stringify(b)).catch(() => {});
/** The row's site data the way this device holds it: without the app's own markers. */
const clean = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object') return raw;
  const { source: _s, editedAt: _e, [IOS_PREFS]: _p, ...rest } = raw as Record<string, unknown>;
  return rest;
};

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pushing: Promise<void> | null = null;
  const unsynced = (r: siteStore.SiteRecord) => r.accountSyncedAt === undefined || r.accountSyncedAt < r.updatedAt;

  const run = async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    let local = await siteStore.loadSite();
    if (!uid || !local || !unsynced(local)) return;
    // Another device wrote since this one last synced: fold its edits in before pushing ours over them.
    const base = await readBase();
    if (base && base.draftId === local.draftId) {
      const { data: row } = await supabase.from('sites').select('site_data, updated_at').eq('id', local.draftId).eq('user_id', uid).maybeSingle();
      const rowAt = Date.parse((row as { updated_at?: string } | null)?.updated_at ?? '');
      if (row && !Number.isNaN(rowAt) && rowAt > (local.accountRowAt ?? 0)) {
        const merged = merge3(base.data, publishPayload(local.data), clean((row as { site_data: unknown }).site_data));
        if (JSON.stringify(merged) !== JSON.stringify(publishPayload(local.data))) {
          const cur = await siteStore.loadSite();
          if (cur && cur.draftId === local.draftId) {
            await siteStore.saveSite({ ...cur, data: keepRemoved(cur.data, merged as typeof cur.data), updatedAt: Date.now() });
            local = (await siteStore.loadSite()) ?? local;
          }
        }
      }
    }
    await syncIfSignedIn(local);
    // What the account holds now: the base the next merge starts from.
    await writeBase({ draftId: local.draftId, data: publishPayload(local.data) });
  };
  const push = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    // One push at a time; an edit made meanwhile is unsynced again and schedules the next one.
    pushing = (pushing ?? Promise.resolve()).then(run).catch((e) => console.warn('[autosave] failed:', e)).finally(() => { pushing = null; });
  };

  siteStore.onSiteSaved((r) => {
    if (!unsynced(r)) return; // a stamp write after a push: nothing new to send (also stops a save loop)
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, DELAY_MS);
  });
  // A copy adopted from the account (sign-in, another device's edit) is what the account holds: the merge base.
  onSiteAdopted((s) => { void writeBase({ draftId: s.draftId, data: publishPayload(s.data) }); });

  const pull = async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (uid) await pullSiteFromAccount(uid);
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') push(); else void pull(); });
  window.addEventListener('pagehide', push);
  window.addEventListener('focus', () => { void pull(); });
}
