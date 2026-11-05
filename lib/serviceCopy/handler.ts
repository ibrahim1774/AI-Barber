// DORMANT (Ibrahim, 2026-11-05): the web editor no longer calls this endpoint. Page text for a service the library has no pattern for is automatic
// (guides.ts familyFor, closed vocabulary, no model); modes 'write' and 'approve' answer 404 unless SERVICE_COPY_WRITE_MODE=1 (flags.ts), and the
// classifier mode is redundant under that rule. Keep SERVICE_COPY_AI off.
// POST /api/web-app/service-copy  { titleKey: string, draftId?: string, mode?: 'classify' | 'write' | 'approve' }
// For ONE service the library has no guide for, on an explicit request from the signed-in owner with an active paid web plan:
//   mode 'classify' (default, MODE A)  the model only classifies the title into a library guide family: 200 { status: 'family', family }
//                                      (the page then prints the library's own reviewed wording) or { status: 'not_generated' } (none / any failure).
//                                      Nothing a model wrote is ever returned or rendered.
//   mode 'write'    (MODE B)           free-form text. DEFAULT: a PROPOSAL, 200 { status: 'proposal', copy } - never rendered or indexed until the
//                                      barber approves it. With SERVICE_COPY_AUTO_PUBLISH=1 the answer is 'generated' / 'cached' with copy.approval 'auto'.
//   mode 'approve'                     "Looks right": flips the stored proposal to owner-approved and returns { status: 'approved', copy } for the editor to commit.
// Other answers: 200 { status: 'exists' | 'not_generated' }, 202 { status: 'in_progress' }, 402 no plan, 4xx for a request that cannot be served,
// 429 { error: 'rate_limited', scope }, 503 { error: 'ai_unavailable' }.
// Never a body that carries a message, a stack, a prompt or a secret. The server never writes site data: the editor commits `copy`.
import { memoryStore, supabaseRateStore, type RateLimitStore } from '../bookings/rateLimit.js';
import { hasPagesV2, isWebCreated } from '../pagesV2.js';
import { sbRest } from '../webApp/webAppServer.js';
import { serviceTextOn, svcTitleKey } from '../render/guides.js';
import { callerFrom, webAppCheckoutOn, webAppCors } from '../webApp/webAppServer.js';
import { modeOf, readDraft, reliabilityOn, type Draft } from '../webApp/reliability.js';
import { serviceFacts } from './facts.js';
import { approveProposal, classifyServiceFamily, generateServiceCopy, type GenerateDeps } from './generate.js';
import { serviceCopyAutoPublish, serviceCopyWriteMode } from './flags.js';
import { signingSecret } from './approval.js';
import { isEntitledStatus } from '../webApp/stripeCore.js';
import { liveModelClient, type ModelClient } from './model.js';
import { tableCopyStore, type CopyStore } from './store.js';

// Review 6c NIT 7: an App Store subscriber gets 402 here while publish answers 403 app-store-account. Those sites are not web-created, so this is unreachable in practice.
export const REQUESTS_PER_MINUTE = 20;

export interface HandlerDeps {
  enabled: () => boolean;
  caller: (authorization: unknown) => Promise<{ id: string } | null>;
  draft: (userId: string) => Promise<Draft | null>;
  /** An active paid web plan in the current Stripe mode (what publish requires). Throws on a failed lookup: the request then fails closed with 503. */
  entitled: (userId: string) => Promise<boolean>;
  /** SERVICE_COPY_AUTO_PUBLISH is on (read per request). */
  autoPublish: () => boolean;
  /** SERVICE_COPY_WRITE_MODE is on (read per request). OFF = modes 'write' and 'approve' answer 404 (dormant Mode B). */
  writeMode: () => boolean;
  /** The approval signing key (SERVICE_COPY_SIGNING_SECRET), read per request. Null = no approval can be issued. */
  secret: () => string | null;
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
    entitled: async (uid) => {
      const rows = await sbRest(`web_app_entitlements?user_id=eq.${encodeURIComponent(uid)}&environment=eq.${modeOf()}&status=in.(active,trialing,past_due)&select=status&order=created_at.desc&limit=1`);
      return Array.isArray(rows) && rows.length > 0 && isEntitledStatus(String(rows[0]?.status));
    },
    autoPublish: () => serviceCopyAutoPublish(),
    writeMode: () => serviceCopyWriteMode(),
    secret: () => signingSecret(),
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
    // Dormant Mode B (Ibrahim, 2026-11-05): no model writes page text. With the flag off a write or approve request is refused first of all: no auth, no store, no model.
    const asked = req.body && typeof req.body === 'object' ? req.body.mode : undefined;
    if ((asked === 'write' || asked === 'approve') && !deps.writeMode()) return res.status(404).json({ error: 'not_found' });
    // No usable signing secret: nothing can be approved and nothing would verify, so the feature is OFF (404, like the flag), with a clear line
    // in the log (never the value). Set SERVICE_COPY_SIGNING_SECRET (16+ characters) in the server env before turning SERVICE_COPY_AI on.
    if (!deps.secret()) { deps.log('[service-copy] SERVICE_COPY_SIGNING_SECRET is not set (or shorter than 16 characters): service text AI is off'); return res.status(404).json({ error: 'not_found' }); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    res.setHeader('Cache-Control', 'no-store');
    try {
      const user = await deps.caller(req.headers?.authorization);
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      if (!(await deps.requests.hit(`svccopy-req:${user.id}`, REQUESTS_PER_MINUTE, 60_000, deps.now()))) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'rate_limited', scope: 'requests' }); }
      // A paid web plan, as publish requires. A failed lookup fails closed (the catch below answers 503); no plan = 402 so the editor can offer checkout.
      if (!(await deps.entitled(user.id))) return res.status(402).json({ error: 'subscription-inactive' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const mode = body.mode === undefined ? 'classify' : body.mode;
      if (mode !== 'classify' && mode !== 'write' && mode !== 'approve') return res.status(400).json({ error: 'invalid_request' });
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

      // Text that already exists (approved model text or the barber's own) is never written again; a family already chosen is not asked for again.
      const has = (o: unknown): boolean => !!o && typeof o === 'object' && !Array.isArray(o) && Object.prototype.hasOwnProperty.call(o, titleKey);
      if (has(site.extraPages?.svcCopy) || (mode === 'classify' && has(site.extraPages?.svcFamily))) return res.status(200).json({ status: 'exists', titleKey });

      const f = serviceFacts(site, titleKey);
      if ('reason' in f) return res.status(f.reason === 'no_such_service' ? 404 : 422).json({ error: f.reason });

      const who = { userId: user.id, draftId: draft.draft_id };
      if (mode === 'approve') {
        const a = await approveProposal({ store: deps.store, log: deps.log, secret: deps.secret(), now: deps.now }, who, site, f);
        if (a.status === 'approved') return res.status(200).json({ status: 'approved', titleKey, copy: a.copy });
        if (a.status === 'unavailable') return res.status(503).json({ error: 'ai_unavailable' });
        return res.status(a.status === 'no_proposal' ? 404 : 409).json({ error: a.status });
      }
      const gen: GenerateDeps = { model: deps.model(), store: deps.store, limits: deps.limits, now: deps.now, log: deps.log, autoPublish: deps.autoPublish(), secret: deps.secret() };
      if (mode === 'classify') {
        const c = await classifyServiceFamily(gen, who, f);
        switch (c.status) {
          case 'family': return res.status(200).json({ status: 'family', titleKey, family: c.family });
          case 'not_generated': return res.status(200).json({ status: 'not_generated', titleKey });
          case 'in_progress': res.setHeader('Retry-After', '5'); return res.status(202).json({ status: 'in_progress', titleKey });
          case 'rate_limited': res.setHeader('Retry-After', '3600'); return res.status(429).json({ error: 'rate_limited', scope: c.scope });
          default: return res.status(503).json({ error: 'ai_unavailable' });
        }
      }
      const out = await generateServiceCopy(gen, who, site, f);
      switch (out.status) {
        case 'generated': case 'cached': case 'proposal': return res.status(200).json({ status: out.status, titleKey, copy: out.copy });
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
