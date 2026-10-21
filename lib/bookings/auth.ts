// Owner auth for /api/shop/*: the caller's Supabase access token is verified server-side
// (auth.getUser with the service role) and the shop is looked up by owner_id = that user.
// Shop ids are never taken from the client.
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient, type BookingRepo, type ShopRow } from './repo.js';

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

export type GetUser = (jwt: string) => Promise<AuthUser | null>;

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; status: 401; body: { error: 'unauthorized' } };
export type OwnerResult =
  | { ok: true; user: AuthUser; shop: ShopRow }
  | { ok: false; status: 401 | 404; body: { error: string } };

const unauthorized = { ok: false as const, status: 401 as const, body: { error: 'unauthorized' as const } };

export function bearerToken(authorization: string | string[] | undefined): string | null {
  const h = Array.isArray(authorization) ? authorization[0] : authorization;
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(h) : null;
  return m ? m[1] : null;
}

export async function authenticate(authorization: string | string[] | undefined, getUser: GetUser): Promise<AuthResult> {
  const jwt = bearerToken(authorization);
  if (!jwt) return unauthorized;
  let user: AuthUser | null = null;
  try {
    user = await getUser(jwt);
  } catch {
    user = null;
  }
  if (!user?.id) return unauthorized;
  return { ok: true, user };
}

/** The verified caller and the one shop they own (404 'no-shop' before setup). */
export async function requireOwner(
  authorization: string | string[] | undefined,
  getUser: GetUser,
  repo: BookingRepo,
): Promise<OwnerResult> {
  const a = await authenticate(authorization, getUser);
  if (a.ok === false) return a;
  const shop = await repo.shopByOwner(a.user.id);
  if (!shop) return { ok: false, status: 404, body: { error: 'no-shop' } };
  return { ok: true, user: a.user, shop };
}

export function liveGetUser(client?: SupabaseClient): GetUser {
  let admin = client;
  return async (jwt) => {
    admin ??= serviceClient();
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return null;
    const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
    return { id: data.user.id, email: data.user.email ?? null, fullName };
  };
}
