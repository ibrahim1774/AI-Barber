import { Platform } from 'react-native';
import { pullSiteFromAccount, syncIfSignedIn } from '@/lib/account';
import * as siteStore from '@/lib/siteStore';
import { supabase } from '@/lib/supabase';

// A browser can lose its local storage (cleared, private mode, Safari's 7-day rule) and a second device never sees
// edits that only live in one browser. So on the web every edit is copied to the signed-in account a moment after it
// is made (the phone app keeps its draft locally for good and copies it only on publish / sign-out).
//  - 1.5 s after the last edit: the draft is pushed (syncIfSignedIn: the same push the publish and sign-out use, which
//    also records what the account has, so a newer copy from another device is never overwritten blindly).
//  - tab hidden or closed: pushed at once, best effort.
//  - tab visible again / focused: a newer copy written by another device is adopted (pullSiteFromAccount only adopts
//    when this browser has no unsynced edits).
const DELAY_MS = 1500;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsynced = (r: siteStore.SiteRecord) => r.accountSyncedAt === undefined || r.accountSyncedAt < r.updatedAt;
  const push = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    const local = await siteStore.loadSite();
    if (local && unsynced(local)) await syncIfSignedIn(local);
  };
  siteStore.onSiteSaved((r) => {
    if (!unsynced(r)) return; // a stamp write after a push: nothing new to send (also stops a save loop)
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void push(); }, DELAY_MS);
  });
  const pull = async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (uid) await pullSiteFromAccount(uid);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void push(); else void pull();
  });
  window.addEventListener('pagehide', () => { void push(); });
  window.addEventListener('focus', () => { void pull(); });
}
