import { supabase } from '@/lib/supabase';

/** Refresh the session when its access token expires within this long. */
export const REFRESH_WITHIN_MS = 60_000;

/**
 * The signed-in user's Supabase access token for `Authorization: Bearer …` (the server links purchases
 * and owner actions to the account only from a verified bearer). Refreshed first when it is about to
 * expire. Null when signed out, or when it has expired and could not be refreshed (the request then
 * goes without it rather than with a token the server would refuse). Never throws.
 */
export async function accessToken(now: number = Date.now()): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const s = data.session as { access_token?: string; expires_at?: number } | null;
    if (!s?.access_token) return null;
    const expiresAt = typeof s.expires_at === 'number' ? s.expires_at * 1000 : null;
    if (expiresAt == null || expiresAt - now > REFRESH_WITHIN_MS) return s.access_token;
    try {
      const r = await supabase.auth.refreshSession();
      const fresh = (r?.data?.session as { access_token?: string } | null)?.access_token;
      if (fresh) return fresh;
    } catch {
      // fall through
    }
    return expiresAt > now ? s.access_token : null;
  } catch {
    return null;
  }
}
