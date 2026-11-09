import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAdmin, supabaseEmailOf, type EmailOfToken } from '../../lib/admin/auth.js';
import { adminSupabase } from '../../lib/admin/live.js';
import { isResetRateLimit } from '../../lib/admin/customersView.js';
import { buildCustomerRows, isDegraded, type CustomerRow, type SourceStatus } from '../../lib/admin/customers.js';
import { loadCustomerSources } from '../../lib/admin/customersLive.js';
import { APP_ORIGIN } from '../../lib/webApp/webAppServer.js';
import { memoryStore, supabaseRateStore, withFallback, type RateLimitStore } from '../../lib/bookings/rateLimit.js';

/*
 * /api/admin/customers — the owner's customer lookup (lib/admin/customers.ts).
 *
 * Auth: Authorization: Bearer <Supabase access token> of ADMIN_EMAIL (lib/admin/auth.ts).
 *
 * GET  [?refresh=1]             → { ok, generatedAt, rows: CustomerRow[], sources, degraded }   60 s cache
 *                               degraded = any source 'error' or 'partial' (rows may be missing)
 * POST { action:'send-reset', userId } → { ok, sentTo }  Supabase password-reset email for a main-project
 *                                        account; the link returns to the web app's /app/reset-password.
 *
 * The payload is built field by field (no password, portal password, token or key is ever read into a row).
 */

export const config = { maxDuration: 60 };

const READ_LIMIT = 30;
const WRITE_LIMIT = 10;
const WINDOW_MS = 60_000;
const CACHE_MS = 60_000;

export interface CustomersPayload { rows: CustomerRow[]; sources: SourceStatus }

export type SendResetResult =
  | { ok: true; to: string }
  | { ok: false; error: 'not-found' | 'no-email' | 'rate-limited' | 'failed' };

export interface AdminCustomersHandlerDeps {
  emailOf(): EmailOfToken;
  load(): Promise<CustomersPayload>;
  sendReset(userId: string): Promise<SendResetResult>;
  reads: RateLimitStore;
  writes: RateLimitStore;
  now(): number;
  configured(): boolean;
  log?(msg: string): void;
}

const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** a***@d***.com: enough to recognise the address in a log, not enough to use it. */
export function maskEmail(e: string): string {
  const [l, d = ''] = e.split('@');
  const dot = d.lastIndexOf('.');
  return `${l.slice(0, 1)}***@${d.slice(0, 1)}***${dot > 0 ? d.slice(dot) : ''}`;
}

export function makeAdminCustomersHandler(d: AdminCustomersHandlerDeps) {
  let cache: { at: number; payload: CustomersPayload } | null = null;
  let inflight: Promise<{ at: number; payload: CustomersPayload }> | null = null;
  const log = d.log ?? ((m: string) => console.log(m));

  async function current(force: boolean) {
    const t = d.now();
    if (!force && cache && t - cache.at < CACHE_MS) return cache;
    if (!inflight) {
      inflight = d.load().then((payload) => (cache = { at: d.now(), payload })).finally(() => { inflight = null; });
    }
    return inflight;
  }

  return async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    if (!d.configured()) return res.status(500).json({ ok: false, error: 'Server missing configuration' });

    const auth = await checkAdmin(req.headers?.authorization, d.emailOf());
    if (!auth.ok) return res.status(auth.status!).json({ ok: false, error: auth.error });

    const kind = req.method === 'GET' ? 'read' : 'write';
    const allowed = await (kind === 'read' ? d.reads : d.writes)
      .hit(`admin-customers:${kind}:${auth.email}`, kind === 'read' ? READ_LIMIT : WRITE_LIMIT, WINDOW_MS, d.now());
    if (!allowed) return res.status(429).json({ ok: false, error: 'rate-limited' });

    try {
      if (req.method === 'GET') {
        const refresh = String(one(req.query?.refresh) ?? '') === '1';
        const c = await current(refresh);
        return res.status(200).json({ ok: true, generatedAt: c.at, rows: c.payload.rows, sources: c.payload.sources, degraded: isDegraded(c.payload.sources) });
      }

      let body: any = req.body;
      try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = null; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false, error: 'bad-request', detail: 'JSON body required' });
      if (body.action !== 'send-reset') return res.status(400).json({ ok: false, error: 'bad-request', detail: 'unknown action' });
      const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
      if (!UUID.test(userId)) return res.status(400).json({ ok: false, error: 'bad-request', detail: 'userId required' });

      const r = await d.sendReset(userId);
      if ('error' in r) {
        log(`[admin/customers] send-reset ${userId.slice(0, 8)} by admin: ${r.error}`);
        return res.status(r.error === 'failed' ? 502 : r.error === 'not-found' ? 404 : r.error === 'rate-limited' ? 429 : 409).json({ ok: false, error: r.error });
      }
      log(`[admin/customers] send-reset ${userId.slice(0, 8)} -> ${maskEmail((r as { to: string }).to)}`);
      return res.status(200).json({ ok: true, sentTo: maskEmail((r as { to: string }).to) });
    } catch (e: any) {
      console.error('[admin/customers] handler error:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'exception' });
    }
  };
}

async function liveLoad(): Promise<CustomersPayload> {
  const src = await loadCustomerSources();
  return { rows: await buildCustomerRows(src), sources: src.status };
}

async function liveSendReset(userId: string): Promise<SendResetResult> {
  const sb = adminSupabase();
  const { data, error } = await sb.auth.admin.getUserById(userId);
  if (error || !data?.user) return { ok: false, error: 'not-found' };
  const email = data.user.email;
  if (!email) return { ok: false, error: 'no-email' };
  const { error: e2 } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${APP_ORIGIN()}/app/reset-password` });
  if (e2) return { ok: false, error: isResetRateLimit(e2) ? 'rate-limited' : 'failed' };
  return { ok: true, to: email };
}

const writes = withFallback(supabaseRateStore(() => adminSupabase()));
const reads = memoryStore();

export default makeAdminCustomersHandler({
  emailOf: () => supabaseEmailOf(adminSupabase()),
  load: liveLoad,
  sendReset: liveSendReset,
  reads,
  writes,
  now: () => Date.now(),
  configured: () => !!((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
});
