import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkAdmin, supabaseEmailOf, type EmailOfToken } from '../../lib/admin/auth.js';
import { adminSupabase, liveAdminDeps } from '../../lib/admin/live.js';
import {
  domainBuyRelease, domainTransferred, findSites, listAccountDomains, getSite, republish, republishAll, rollback, updateSite, type AdminSitesDeps,
} from '../../lib/admin/sites.js';
import { memoryStore, supabaseRateStore, withFallback, type RateLimitStore } from '../../lib/bookings/rateLimit.js';

/*
 * /api/admin/sites — owner-only edits of app customers' sites (lib/admin/sites.ts).
 *
 * Auth: Authorization: Bearer <Supabase access token> of ADMIN_EMAIL (lib/admin/auth.ts,
 * shared with /api/admin-overview). The service role never leaves the server.
 *
 * GET  ?q=<text>             → { ok, sites: SiteRow[] }        (shop name, slug, email, URL, transaction id)
 * GET  ?slug=<slug>          → { ok, site: SiteDetail }        (siteData with real image URLs, version, history)
 * GET  ?vercelDomains=1      → { ok, domains }                 READ-ONLY: every domain in our Vercel account, auto-renew, expiry, tracked?
 * POST { action, ... }:
 *   update       { slug, patch? | set?, note?, expectedVersion? }
 *   replace      { slug, siteData, note?, expectedVersion? }
 *   republish    { slug }
 *   republish-all{ dryRun = true, runId?, limit? }   call again with the same runId until done
 *   rollback     { slug, version: "4" | "4-1729…" (history id), expectedVersion? }
 *   domain-transferred { slug }   the custom domain was transferred by hand in Vercel; the
 *                                 domain lifecycle (lib/ios/domainFlow.ts) stops touching it
 *   domain-buy-release { slug, to: 'retry' | 'abandon' }   a buy whose outcome stayed unknown,
 *                                 after checking Vercel by hand
 */

const READ_LIMIT = 120;
const WRITE_LIMIT = 30;
const WINDOW_MS = 60_000;

const STATUS: Record<string, number> = {
  'not-found': 404, 'no-copy': 404, 'no-history': 404, 'bad-request': 400, conflict: 409, 'site-offline': 409,
  'invalid-copy': 422, 'history-failed': 503, 'publish-failed': 502, exception: 500,
};

export interface AdminSitesHandlerDeps {
  emailOf(): EmailOfToken;
  core(): AdminSitesDeps;
  reads: RateLimitStore;
  writes: RateLimitStore;
  now(): number;
  configured(): boolean;
}

function parseBody(req: VercelRequest): any {
  let body: any = req.body; // @vercel/node parses lazily and throws on malformed JSON
  if (typeof body === 'string') body = JSON.parse(body);
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export function makeAdminSitesHandler(d: AdminSitesHandlerDeps) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
    if (!d.configured()) return res.status(500).json({ ok: false, error: 'Server missing configuration' });

    const auth = await checkAdmin(req.headers?.authorization, d.emailOf());
    if (!auth.ok) return res.status(auth.status!).json({ ok: false, error: auth.error });

    const kind = req.method === 'GET' ? 'read' : 'write';
    const allowed = await (kind === 'read' ? d.reads : d.writes)
      .hit(`admin-sites:${kind}:${auth.email}`, kind === 'read' ? READ_LIMIT : WRITE_LIMIT, WINDOW_MS, d.now());
    if (!allowed) return res.status(429).json({ ok: false, error: 'rate-limited' });

    try {
      const core = d.core();
      if (req.method === 'GET') {
        if (str(one(req.query?.vercelDomains))) {
          const r = await listAccountDomains(core);
          return res.status(r.ok ? 200 : 500).json(r);
        }
        const slug = str(one(req.query?.slug));
        if (slug) {
          const r = await getSite(slug, core);
          return r.ok ? res.status(200).json({ ok: true, site: r.site }) : res.status(404).json({ ok: false, error: r.error });
        }
        const sites = await findSites(str(one(req.query?.q)), core);
        return res.status(200).json({ ok: true, sites });
      }

      let body: any;
      try {
        body = parseBody(req);
      } catch {
        body = null;
      }
      if (!body) return res.status(400).json({ ok: false, error: 'bad-request', detail: 'JSON body required' });
      const by = auth.email;
      const slug = str(body.slug);
      const needSlug = () => res.status(400).json({ ok: false, error: 'bad-request', detail: 'slug required' });
      const expectedVersion = Number.isInteger(body.expectedVersion) ? body.expectedVersion : undefined;
      const note = typeof body.note === 'string' ? body.note : undefined;

      let r: any;
      switch (body.action) {
        case 'update':
          if (!slug) return needSlug();
          r = await updateSite(slug, { patch: body.patch, set: body.set, note, expectedVersion, by }, core);
          break;
        case 'replace':
          if (!slug) return needSlug();
          r = await updateSite(slug, { replace: body.siteData ?? null, note, expectedVersion, by }, core);
          break;
        case 'republish':
          if (!slug) return needSlug();
          r = await republish(slug, core, by);
          break;
        case 'rollback':
          if (!slug) return needSlug();
          r = await rollback(slug, String(body.version ?? ''), core, { by, expectedVersion });
          break;
        case 'domain-transferred':
          if (!slug) return needSlug();
          r = await domainTransferred(slug, core, by);
          break;
        case 'domain-buy-release':
          if (!slug) return needSlug();
          r = await domainBuyRelease(slug, body.to, core, by);
          break;
        case 'republish-all': {
          const dryRun = body.dryRun !== false;
          if (!dryRun && !/^[a-zA-Z0-9_-]{1,80}$/.test(str(body.runId))) {
            return res.status(400).json({ ok: false, error: 'bad-request', detail: 'runId required for a real run' });
          }
          if (body.limit !== undefined && !(Number.isInteger(body.limit) && body.limit > 0)) {
            return res.status(400).json({ ok: false, error: 'bad-request', detail: 'limit must be a positive whole number' });
          }
          const limit = body.limit;
          const out = await republishAll({ dryRun, runId: str(body.runId) || undefined, limit, by }, core);
          return res.status(200).json({ ok: true, ...out });
        }
        default:
          return res.status(400).json({ ok: false, error: 'bad-request', detail: 'unknown action' });
      }
      return res.status(r.ok ? 200 : STATUS[r.error] || 500).json(r);
    } catch (e: any) {
      console.error('[admin/sites] handler error:', e?.message || e);
      return res.status(500).json({ ok: false, error: 'exception', detail: e?.message || String(e) });
    }
  };
}

const writes = withFallback(supabaseRateStore(() => adminSupabase()));
const reads = memoryStore();

export default makeAdminSitesHandler({
  emailOf: () => supabaseEmailOf(adminSupabase()),
  core: liveAdminDeps,
  reads,
  writes,
  now: () => Date.now(),
  configured: () =>
    !!((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
});
