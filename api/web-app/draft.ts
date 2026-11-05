import { accountRow, digest, draftPath, modeOf, publishedBinding, readDraft, reliabilityOn } from '../../lib/webApp/reliability.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, sbRest, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';
import { MAX_BODY_BYTES, hasDataUrl, jsonBytes, validSiteData } from '../../lib/ios/siteShape.js';
import { seoProblem, seoSanitize } from '../../lib/render/seoText.js';

/** Simple per-user, per-instance cap on draft writes (autosave is debounced well below this). */
export const DRAFT_WRITES_PER_MINUTE = 120;
const writeStore = memoryStore();

/**
 * Largest draft PUT body (serialized bytes). Real drafts are a few KB (the biggest saved so far is about 5 KB: images are uploaded
 * and referenced by URL, data: images are refused), so 1 MB leaves a huge margin while keeping a runaway client out of the table.
 * Above it: 413 draft_too_large. (The 3 MB MAX_BODY_BYTES stays the limit for publish and the phone app.)
 */
export const MAX_DRAFT_BYTES = 1024 * 1024;

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppCheckoutOn() || !reliabilityOn()) return res.status(404).json({ error: 'not_found' });
  if (!['GET', 'PUT'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const user = await callerFrom(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'PUT' && !(await writeStore.hit(`draft-put:${user.id}`, DRAFT_WRITES_PER_MINUTE, 60_000, Date.now()))) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (req.method === 'PUT' && jsonBytes(req.body) > MAX_DRAFT_BYTES) return res.status(413).json({ error: 'draft_too_large', maxBytes: MAX_DRAFT_BYTES });
    const previous = await readDraft(user.id);
    if (req.method === 'GET') return res.status(200).json({ draft: previous ? accountRow(previous) : null });
    const { id, site_data, expectedRevision } = req.body ?? {};
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES || !validSiteData(site_data) || hasDataUrl(site_data)) {
      return res.status(400).json({ error: 'invalid_draft' });
    }
    // An over-long or hostile SEO title / description (copy keys `seo.*`) is refused here, so it is never stored (Phase 1 step 4).
    // Only a structural problem (copy is not an object) is refused. An invalid value is DROPPED from what is stored and listed in
    // `seoProblems` (page, field, reason), so one bad title never blocks the autosave of the rest of the draft.
    const seo = seoProblem(site_data);
    if (seo) return res.status(400).json({ error: 'invalid_draft', detail: seo });
    const { siteData: cleaned, problems: seoProblems } = seoSanitize(site_data);
    // Deployment URLs are server-owned. The browser cannot turn an arbitrary URL into a published account site.
    const content = { ...cleaned, source: 'web-app' };
    if (previous && previous.draft_id === id && digest(previous.site_data) === digest(content)) return res.status(200).json({ draft: accountRow(previous), seoProblems });
    if ((previous?.revision ?? 0) !== expectedRevision) {
      return res.status(409).json({ error: 'draft_changed', draft: previous ? accountRow(previous) : null });
    }
    const row = { user_id: user.id, environment: modeOf(), draft_id: id, site_data: content, revision: expectedRevision + 1,
      updated_at: new Date().toISOString(), deployed_url: previous?.deployed_url ?? null };
    let written: any[];
    if (previous) written = await sbRest(`${draftPath(user.id)}&revision=eq.${expectedRevision}`, { method: 'PATCH', body: row, prefer: 'return=representation' });
    else {
      // The first server draft of an account that already has a live web site (published before drafts existed) inherits that binding.
      // A failed lookup must never block saving: the draft is then simply created unbound, as before.
      const live = await publishedBinding(user.id).catch((e: any) => { console.error('[web draft] binding lookup failed:', e?.message || e); return null; });
      if (live) { (row as any).deployed_url = live.deployedUrl; (row as any).published_binding = live.binding; }
      written = await sbRest('web_app_drafts?on_conflict=user_id,environment', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=representation' });
    }
    if (!written?.length) { const current = await readDraft(user.id); return res.status(409).json({ error: 'draft_changed', draft: current ? accountRow(current) : null }); }
    return res.status(200).json({ draft: accountRow(written[0]), seoProblems });
  } catch (e: any) {
    console.error('[web draft]', e?.message);
    return res.status(503).json({ error: 'save_unavailable' });
  }
}
