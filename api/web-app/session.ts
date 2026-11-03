// "Stay signed in" for the web app. Safari (ITP) and the Instagram/Facebook in-app browsers wipe script-written
// storage after ~7 days without a visit, which signs the user out. The refresh token is therefore also kept in an
// HttpOnly cookie set by this server (ITP's 7-day cap applies to script-written cookies only).
//   POST   Bearer <access token> + {refresh_token}: verify, rotate once server-side, store the NEW token in the
//          cookie and return the new session (the client adopts it: a rotated-away token is revoked).
//   GET    cookie -> fresh session {access_token, refresh_token}; cookie re-set with the rotated token.
//   DELETE clear the cookie.
// The cookie is scoped to this path, so it is never sent to any other endpoint. Tokens are never logged.
import { clientIp, memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, webAppCheckoutOn, webAppCors, webAppOriginAllowed } from '../../lib/webApp/webAppServer.js';

export const COOKIE = 'pb_rt';
export const COOKIE_PATH = '/api/web-app/session';
export const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // 400 days, the most browsers allow
export const SESSION_PER_MINUTE = 30;
const limiter = memoryStore();

// Non-HttpOnly hint so the client only asks for a restore when there is something to restore.
export const HINT = 'pb_has';
export const hintFor = () => `${HINT}=1; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
export const clearHint = () => `${HINT}=; Secure; SameSite=Lax; Path=/; Max-Age=0`;
const attrs = `HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}`;
export const cookieFor = (token: string) => `${COOKIE}=${encodeURIComponent(token)}; ${attrs}; Max-Age=${COOKIE_MAX_AGE}`;
export const clearCookie = () => `${COOKIE}=; ${attrs}; Max-Age=0`;

function cookieOf(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || null; } catch { return null; }
    }
  }
  return null;
}

type Refreshed = { ok: true; session: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number; userId: string | null } } | { ok: false; definitive: boolean; limited?: boolean };

/** Exchanges a refresh token at Supabase. `definitive` is true when Supabase rejected the token (4xx), false for outages. */
async function refresh(refreshToken: string): Promise<Refreshed> {
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!anon) return { ok: false, definitive: false }; // misconfigured: 502, and never a reason to clear the cookie
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) return { ok: false, definitive: r.status >= 400 && r.status < 500 && r.status !== 429, limited: r.status === 429 };
    const j: any = await r.json().catch(() => null);
    if (!j?.access_token || !j?.refresh_token) return { ok: false, definitive: false };
    return { ok: true, session: { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in, expires_at: j.expires_at, userId: j.user?.id ?? null } };
  } catch {
    return { ok: false, definitive: false };
  }
}

const publicSession = (s: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number }) =>
  ({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: s.expires_at });

export default async function handler(req: any, res: any) {
  const origin = req.headers?.origin;
  if (webAppOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-PB-Session');
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!webAppCheckoutOn()) return res.status(404).json({ error: 'not_found' });
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  // CSRF guard: an Origin, when sent, must be ours; state-changing calls must send one.
  if (origin !== undefined && !webAppOriginAllowed(origin)) return res.status(403).json({ error: 'forbidden_origin' });
  if (req.method !== 'GET' && !webAppOriginAllowed(origin)) return res.status(403).json({ error: 'forbidden_origin' });
  if (!(await limiter.hit(`session:${clientIp(req.headers)}`, SESSION_PER_MINUTE, 60_000, Date.now()))) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited' });
  }

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', [clearCookie(), clearHint()]);
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      // Restore rotates the token, so a top-level link, popup or <img> from another site must not trigger it:
      // it needs a custom header (forces a CORS preflight, which only our origins pass) and must not be a navigation.
      const site = req.headers?.['sec-fetch-site'];
      if (req.headers?.['x-pb-session'] !== '1' || req.headers?.['sec-fetch-mode'] === 'navigate' ||
        (site !== undefined && site !== 'same-origin' && site !== 'same-site')) {
        return res.status(403).json({ error: 'forbidden_request' });
      }
      const token = cookieOf(req.headers?.cookie);
      if (!token) return res.status(401).json({ error: 'no_session' });
      const out = await refresh(token);
      if (!out.ok) {
        if (out.limited) { res.setHeader('Retry-After', '30'); return res.status(503).json({ error: 'rate_limited_upstream' }); }
        if (!out.definitive) return res.status(502).json({ error: 'upstream' }); // keep the cookie through an outage
        res.setHeader('Set-Cookie', [clearCookie(), clearHint()]);
        return res.status(401).json({ error: 'no_session' });
      }
      res.setHeader('Set-Cookie', [cookieFor(out.session.refresh_token), hintFor()]);
      return res.status(200).json(publicSession(out.session));
    }

    // POST
    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return null; } })() : req.body;
    const given = body?.refresh_token;
    if (typeof given !== 'string' || !given || given.length > 4096) return res.status(400).json({ error: 'invalid_request' });
    const caller = await callerFrom(req.headers.authorization);
    if (!caller) return res.status(401).json({ error: 'unauthorized' });
    const out = await refresh(given);
    if (!out.ok && out.limited) { res.setHeader('Retry-After', '30'); return res.status(503).json({ error: 'rate_limited_upstream' }); }
    if (!out.ok) return res.status(out.definitive ? 401 : 502).json({ error: out.definitive ? 'invalid_refresh_token' : 'upstream' });
    // The refresh token must belong to the user the access token was issued to.
    if (out.session.userId !== caller.id) return res.status(401).json({ error: 'token_mismatch' });
    res.setHeader('Set-Cookie', [cookieFor(out.session.refresh_token), hintFor()]);
    return res.status(200).json(publicSession(out.session));
  } catch {
    return res.status(502).json({ error: 'session_failed' });
  }
}
