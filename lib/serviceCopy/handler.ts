// POST /api/web-app/service-copy  { titleKey: string, draftId?: string }
// Writes the dedicated page text for ONE service the library has no guide for, once, on an explicit request from the signed-in owner.
// Answers: 200 { status: 'generated' | 'cached' | 'exists' | 'not_generated', titleKey, copy? }, 202 { status: 'in_progress' },
// 4xx for a request that cannot be served, 429 { error: 'rate_limited', scope }, 503 { error: 'ai_unavailable' }.
// Never a body that carries a message, a stack, a prompt or a secret. The server never writes site data: the editor commits `copy`.
import { memoryStore, supabaseRateStore, type RateLimitStore } from '../bookings/rateLimit.js';
import { hasPagesV2, isWebCreated } from '../pagesV2.js';
import { serviceTextOn, svcTitleKey } from '../render/guides.js';
import { callerFrom, webAppCheckoutOn, webAppCors } from '../webApp/webAppServer.js';
import { readDraft, reliabilityOn, type Draft } from '../webApp/reliability.js';
import { serviceFacts } from './facts.js';
import { generateServiceCopy, type GenerateDeps } from './generate.js';
import { liveModelClient, type ModelClient } from './model.js';
import { tableCopyStore, type CopyStore } from './store.js';

export const REQUESTS_PER_MINUTE = 20;

export interface HandlerDeps {
  enabled: () => boolean;
  caller: (authorization: unknown) => Promise<{ id: string } | null>;
  draft: (userId: string) => Promise<Draft | null>;
  model: () => ModelClient;
  store: CopyStore;
  limits: RateLimitStore;
  requests: RateLimitStore;
  now: () => number;
  log: (line: string) => void;
}

export const serviceCopyEnabled = (): boolean => process.env.SERVICE_COPY_AI === '1' && webAppCheckoutOn() && reliabilityOn();

export function liveDeps(): HandlerDeps {
  return {
    enabled: serviceCopyEnabled,
    caller: (a) => callerFrom(a),
    draft: readDraft,
    model: () => liveModelClient(),
    store: tableCopyStore,
    limits: supabaseRateStore(),
    requests: memoryStore(),
    now: Date.now,
    log: (l) => console.log(l),
  };
}

export function makeHandler(deps: HandlerDeps) {
  return async function handler(req: any, res: any) {
    if (webAppCors(req, res)) return;
    if (!deps.enabled()) return res.status(404).json({ error: 'not_found' });
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    res.setHeader('Cache-Control', 'no-store');
    try {
      const user = await deps.caller(req.headers?.authorization);
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      if (!(await deps.requests.hit(`svccopy-req:${user.id}`, REQUESTS_PER_MINUTE, 60_000, deps.now()))) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'rate_limited', scope: 'requests' }); }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const titleKey = typeof body.titleKey === 'string' ? body.titleKey : '';
      if (!titleKey || titleKey.length > 100 || titleKey !== svcTitleKey(titleKey)) return res.status(400).json({ error: 'invalid_request' });
      if (body.draftId !== undefined && typeof body.draftId !== 'string') return res.status(400).json({ error: 'invalid_request' });

      // The site is the caller's own stored draft, found by the verified user id. The request names no site.
      const draft = await deps.draft(user.id);
      if (!draft) return res.status(404).json({ error: 'no_site' });
      if (body.draftId !== undefined && body.draftId !== draft.draft_id) return res.status(409).json({ error: 'draft_changed' });
      if (draft.suspended) return res.status(403).json({ error: 'not_available' });
      const site = draft.site_data;
      if (!site || typeof site !== 'object' || !hasPagesV2(site) || !isWebCreated(site) || !serviceTextOn(site)) return res.status(403).json({ error: 'not_available' });

      // Text that already exists (the model's or the barber's own) is never written again.
      const stored = site.extraPages?.svcCopy;
      if (stored && typeof stored === 'object' && !Array.isArray(stored) && Object.prototype.hasOwnProperty.call(stored, titleKey)) return res.status(200).json({ status: 'exists', titleKey });

      const f = serviceFacts(site, titleKey);
      if ('reason' in f) return res.status(f.reason === 'no_such_service' ? 404 : 422).json({ error: f.reason });

      const gen: GenerateDeps = { model: deps.model(), store: deps.store, limits: deps.limits, now: deps.now, log: deps.log };
      const out = await generateServiceCopy(gen, { userId: user.id, draftId: draft.draft_id }, site, f);
      switch (out.status) {
        case 'generated': case 'cached': return res.status(200).json({ status: out.status, titleKey, copy: out.copy });
        case 'not_generated': return res.status(200).json({ status: 'not_generated', titleKey });
        case 'in_progress': res.setHeader('Retry-After', '5'); return res.status(202).json({ status: 'in_progress', titleKey });
        case 'rate_limited': res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'rate_limited', scope: out.scope });
        default: return res.status(503).json({ error: 'ai_unavailable' });
      }
    } catch (e: any) {
      deps.log(`[service-copy] request failed: ${e?.name || 'error'}`);
      return res.status(503).json({ error: 'ai_unavailable' });
    }
  };
}
