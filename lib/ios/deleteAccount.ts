import { createClient } from '@supabase/supabase-js';
import { liveRemoveDeps } from './removeSiteLive.js';

// In-app account deletion (App Store guideline 5.1.1(v)).
// Only the bearer token decides whose data is deleted. Order matters:
//   1. every site the account owns is taken down (offline page, taken_down_at); if ANY takedown
//      fails nothing else is deleted and the call answers 500 (the app keeps the account and can retry);
//   2. then each site's custom domain is released and its stored copy + photos are deleted;
//   3. then the legacy sites rows and the auth user. users_profile cascades from auth.users and
//      ios_purchases.user_id is ON DELETE SET NULL (the purchase row survives, so the slug stays
//      reserved and the subscription keeps working in Apple's eyes).
// Every step is idempotent, so a retry after a partial failure finishes the job. The lapse sweep
// cannot bring a deleted site back: its restore path needs the stored copy, which step 2 deletes.
import { purge, takeDown, type RemovableSite } from './removeSite.js';

export interface DeleteAccountDeps {
  getUser(jwt: string): Promise<{ id: string } | null>;
  /** Every iOS purchase of this account that is bound to a site slug. */
  listSites(userId: string): Promise<RemovableSite[]>;
  takeDown(site: RemovableSite): Promise<void>;
  purge(site: RemovableSite): Promise<void>;
  deleteSites(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** True while an unfinished business move names this account as the previous owner (its data is still being moved). */
  moveInProgress?(userId: string): Promise<boolean>;
}

export async function deleteAccount(
  authorization: string | undefined,
  deps: DeleteAccountDeps,
): Promise<{ status: 200 | 401 | 409 | 500; body: object }> {
  const m = typeof authorization === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(authorization) : null;
  if (!m) return { status: 401, body: { error: 'unauthorized' } };

  let user: { id: string } | null = null;
  try {
    user = await deps.getUser(m[1]);
  } catch {
    user = null;
  }
  if (!user?.id) return { status: 401, body: { error: 'unauthorized' } };

  // The business of this account is mid-move to another account: deleting now would cascade-delete it.
  try {
    if (deps.moveInProgress && (await deps.moveInProgress(user.id))) return { status: 409, body: { error: 'move-in-progress' } };
  } catch (e: any) {
    console.error('[ios/delete-account] move check failed:', e?.message || e);
    return { status: 500, body: { error: 'delete-failed' } };
  }

  try {
    const sites = await deps.listSites(user.id);
    // 1. Take every site down first; surface failures before anything is deleted.
    const failed: string[] = [];
    for (const s of sites) {
      try {
        await deps.takeDown(s);
      } catch (e: any) {
        console.error(`[ios/delete-account] takedown failed for ${s.site_slug}:`, e?.message || e);
        failed.push(String(s.site_slug));
      }
    }
    if (failed.length) return { status: 500, body: { error: 'delete-failed' } };
    // 2. Then delete their content and release their domains.
    for (const s of sites) await deps.purge(s);
    // 3. Then the account.
    await deps.deleteSites(user.id);
    await deps.deleteUser(user.id);
  } catch (e: any) {
    console.error('[ios/delete-account] failed:', e?.message || e);
    return { status: 500, body: { error: 'delete-failed' } };
  }
  return { status: 200, body: { deleted: true } };
}

export function liveDeleteDeps(): DeleteAccountDeps {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase configuration');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const remove = liveRemoveDeps();
  return {
    async getUser(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data?.user) return null;
      return { id: data.user.id };
    },
    async listSites(userId) {
      const { data, error } = await admin
        .from('ios_purchases')
        .select('original_transaction_id, site_slug, environment, published_at')
        .eq('user_id', userId)
        .not('site_slug', 'is', null);
      if (error) throw new Error(error.message);
      return (data ?? []) as RemovableSite[];
    },
    takeDown: (site) => takeDown(site, remove),
    purge: (site) => purge(site, remove),
    async deleteSites(userId) {
      const { error } = await admin.from('sites').delete().eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    async moveInProgress(userId) {
      const { liveMoveIntents, moveInProgressFrom } = await import('./moveIntent.js');
      const { supabasePurchases } = await import('./purchases.js');
      const purchases = supabasePurchases();
      return moveInProgressFrom(userId, liveMoveIntents(), (otid) => purchases.get(otid));
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
  };
}
