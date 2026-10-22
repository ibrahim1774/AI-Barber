// The one owner check for /admin endpoints (api/admin-overview.ts, api/admin/sites.ts):
// Authorization: Bearer <Supabase access token>, and the token's user must be ADMIN_EMAIL.
// Hardcoded on purpose (owner asked for no env config). Everyone else gets 403 and no data.
import type { SupabaseClient } from '@supabase/supabase-js';

export const ADMIN_EMAIL = 'ibrahim3709@gmail.com';

export interface AdminCheck {
  ok: boolean;
  /** Set when ok. */
  email?: string;
  /** Set when !ok. */
  status?: 401 | 403;
  error?: string;
}

/** Email of the token's user, or null when the token is not valid. */
export type EmailOfToken = (token: string) => Promise<string | null>;

export function supabaseEmailOf(client: SupabaseClient): EmailOfToken {
  return async (token) => {
    const { data, error } = await client.auth.getUser(token);
    if (error) return null;
    return data?.user?.email?.toLowerCase() ?? null;
  };
}

export async function checkAdmin(authorization: unknown, emailOf: EmailOfToken): Promise<AdminCheck> {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const token = (typeof header === 'string' ? header : '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, error: 'Sign in required' };
  let email: string | null = null;
  try {
    email = await emailOf(token);
  } catch {
    email = null;
  }
  if (email !== ADMIN_EMAIL) return { ok: false, status: 403, error: 'Not authorized' };
  return { ok: true, email };
}
