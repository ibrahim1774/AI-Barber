import { createClient } from '@supabase/supabase-js';

// In-app account deletion (App Store guideline 5.1.1(v)).
// Only the bearer token decides whose data is deleted. Published sites stay up
// (nothing on the platform ever unpublishes). users_profile cascades from
// auth.users (ON DELETE CASCADE) and ios_purchases.user_id is ON DELETE SET NULL.

export interface DeleteAccountDeps {
  getUser(jwt: string): Promise<{ id: string } | null>;
  deleteSites(userId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export async function deleteAccount(
  authorization: string | undefined,
  deps: DeleteAccountDeps,
): Promise<{ status: 200 | 401 | 500; body: object }> {
  const m = typeof authorization === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(authorization) : null;
  if (!m) return { status: 401, body: { error: 'unauthorized' } };

  let user: { id: string } | null = null;
  try {
    user = await deps.getUser(m[1]);
  } catch {
    user = null;
  }
  if (!user?.id) return { status: 401, body: { error: 'unauthorized' } };

  try {
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
  return {
    async getUser(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data?.user) return null;
      return { id: data.user.id };
    },
    async deleteSites(userId) {
      const { error } = await admin.from('sites').delete().eq('user_id', userId);
      if (error) throw new Error(error.message);
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
  };
}
