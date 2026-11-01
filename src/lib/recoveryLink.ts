// Web only: what the password-reset email's link puts in the address when it returns to /app/reset-password.
// The project uses the implicit flow (tokens in the #fragment); a PKCE-style ?code= and Supabase's error form
// (#error=access_denied&error_code=otp_expired) are understood too. Pure, so it is unit-tested.
export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; code: string }
  | { kind: 'none' };

export function parseRecoveryUrl(hash: string, search: string): RecoveryLink {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const get = (k: string) => h.get(k) ?? q.get(k);
  const err = get('error') ?? get('error_code');
  if (err) return { kind: 'error', code: get('error_code') ?? err };
  const access = h.get('access_token');
  const refresh = h.get('refresh_token');
  if (access && refresh && (h.get('type') ?? 'recovery') === 'recovery') return { kind: 'tokens', accessToken: access, refreshToken: refresh };
  const code = q.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'none' };
}

export const LINK_EXPIRED_MESSAGE = 'This link has expired or was already used. Request a new code.';
