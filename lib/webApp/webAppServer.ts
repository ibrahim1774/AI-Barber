// Server plumbing shared by the web-app endpoints: Stripe REST, Supabase REST (service role), caller auth.
const STRIPE_API_VERSION = '2024-06-20';
const SB = () => ({ url: process.env.SUPABASE_URL as string, key: process.env.SUPABASE_SERVICE_ROLE_KEY as string });

export async function stripeCall(path: string, body: Record<string, string> | null, method = 'POST', opts: { idempotencyKey?: string } = {}): Promise<any> {
  const key = process.env.STRIPE_WEBAPP_SECRET_KEY;
  if (!key) throw new Error('STRIPE_WEBAPP_SECRET_KEY missing');
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': STRIPE_API_VERSION, ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}) },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `stripe ${r.status}`), { status: r.status, code: j?.error?.code as string | undefined, type: j?.error?.type as string | undefined, param: j?.error?.param as string | undefined });
  return j;
}

export async function sbRest(path: string, init: { method?: string; body?: unknown; prefer?: string; timeoutMs?: number } = {}): Promise<any> {
  const { url, key } = SB();
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.prefer ? { Prefer: init.prefer } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    ...(init.timeoutMs ? { signal: AbortSignal.timeout(init.timeoutMs) } : {}),
  });
  if (!r.ok) {
    // Additive: PostgREST's error body (Postgres `code`, `details`) rides on the error for callers that care; the message and `status` are unchanged.
    let pg: any = null;
    try { pg = JSON.parse(await r.text()); } catch { /* no body */ }
    throw Object.assign(new Error(`supabase ${r.status}`), { status: r.status }, pg && typeof pg === 'object' ? { code: typeof pg.code === 'string' ? pg.code : undefined, pgDetails: [pg.message, pg.details].filter((x: unknown) => typeof x === 'string').join(' ') } : {});
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** The signed-in caller from `Authorization: Bearer <supabase jwt>`, verified by Supabase itself. */
export class AuthUnavailableError extends Error {
  status = 503;
  constructor(why: string) { super(`auth service unavailable: ${why}`); this.name = 'AuthUnavailableError'; }
}
export const isAuthUnavailable = (e: unknown): e is AuthUnavailableError => e instanceof AuthUnavailableError;
/** In a handler's catch: an auth outage (AUTH_OUTAGE_503 only) answers 503 temporarily-unavailable, never 401. True when it answered. */
export function authOutage(res: any, e: unknown): boolean {
  if (!isAuthUnavailable(e)) return false;
  res.status(503).json({ error: 'temporarily-unavailable' });
  return true;
}
/** AUTH_OUTAGE_503=1 (default off): "auth could not be asked" is told apart from "this token is invalid". */
export const authOutage503On = () => process.env.AUTH_OUTAGE_503 === '1';

export async function callerFrom(authorization: unknown): Promise<{ id: string; email: string | null } | null> {
  const m = typeof authorization === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(authorization) : null;
  if (!m) return null;
  const { url, key } = SB();
  const outage = authOutage503On();
  let r: Response;
  try { r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${m[1]}` } }); }
  catch (e: any) { if (outage) throw new AuthUnavailableError(e?.message || 'network'); throw e; }
  // The auth service said the token is not valid (401/403): signed out, today's 401. Anything else it could not answer (5xx, 429, other 4xx) is an outage.
  if (!r.ok) {
    if (outage && !(r.status === 401 || r.status === 403)) throw new AuthUnavailableError(`status ${r.status}`);
    return null;
  }
  const u: any = await r.json().catch(() => null);
  return u?.id ? { id: u.id, email: u.email ?? null } : null;
}

export async function readRawBody(req: any): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

export const webAppCheckoutOn = () => process.env.WEB_APP_CHECKOUT === '1';
/** Gate for every web-entitlement code path (publish, lapse job, webhook slug handling). Off = old behaviour. */
export const webAppEntitlementsOn = () => process.env.WEB_APP_ENTITLEMENTS === '1';
export const APP_ORIGIN = () => process.env.WEB_APP_ORIGIN || 'https://www.primebarber.org';

/** The web-app origins: ours, plus the staging host. */
export function webAppOriginAllowed(origin: unknown): origin is string {
  if (typeof origin !== 'string' || !origin) return false;
  return new Set([APP_ORIGIN(), 'https://www.aibarber.org', 'https://aibarber.org', 'https://www.primebarber.org', 'https://primebarber.org', 'https://prime-barber-app.vercel.app']).has(origin);
}

/** CORS for the web-app endpoints: only our own app origins (staging serves the app from another host). True when the request was a preflight and is already answered. */
export function webAppCors(req: any, res: any): boolean {
  const origin = String(req.headers?.origin ?? '');
  if (webAppOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
