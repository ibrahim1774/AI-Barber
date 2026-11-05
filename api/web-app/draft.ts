import { accountRow, digest, draftPath, modeOf, publishedBinding, readDraft, reliabilityOn } from '../../lib/webApp/reliability.js';
import { memoryStore } from '../../lib/bookings/rateLimit.js';
import { callerFrom, sbRest, webAppCheckoutOn, webAppCors } from '../../lib/webApp/webAppServer.js';
import { MAX_BODY_BYTES, hasDataUrl, jsonBytes, validSiteData } from '../../lib/ios/siteShape.js';
import { seoProblem, seoSanitize } from '../../lib/render/seoText.js';
import { guideCopySanitize } from '../../lib/render/guidePages.js';
import { serviceKeys, svcCopySanitize } from '../../lib/serviceCopy/prune.js';
import { serviceCopyAutoPublish } from '../../lib/serviceCopy/flags.js';
import { draftRef, signingSecret, siteRef } from '../../lib/serviceCopy/approval.js';
import { serviceCopyEnabled } from '../../lib/serviceCopy/handler.js';
import { tableCopyStore } from '../../lib/serviceCopy/store.js';

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
    // An over-long or hostile SEO title / description (copy keys `seo.*`) is never stored (Phase 1 step 4).
    // Only a structural problem (copy is not an object) is refused. An invalid value is DROPPED from what is stored and listed in
    // `seoProblems` (page, field, reason), so one bad title never blocks the autosave of the rest of the draft.
    const seo = seoProblem(site_data);
    if (seo) return res.status(400).json({ error: 'invalid_draft', detail: seo });
    // The guide pages' own texts (copy keys `guides.*`, Step 8) are cleaned the same way and reported in the same list (page `guide:<id>`).
    const { siteData: seoClean, problems: seoOnly } = seoSanitize(site_data);
    const { siteData: cleaned, problems: guideProblems } = guideCopySanitize(seoClean);
    const seoProblems = [...seoOnly, ...guideProblems];
    // Deployment URLs are server-owned. The browser cannot turn an arbitrary URL into a published account site.
    // AI service text (extraPages.svcCopy) and family choices (svcFamily) stay tied to real services: an entry of a removed or renamed service, or one that is not the stored shape, is dropped; so is model text with no owner approval.
    // Model text must be approved to THIS account and bound to THIS draft (an id the client names, but the signature covers it) or to this
    // account's own live site (a published site loaded back into the editor). The live slug is looked up only when there is text to check;
    // a failed lookup keeps the draft ref alone (text bound to the live site then drops until the next save).
    const hasModelText = (cleaned as any)?.extraPages?.svcCopy && typeof (cleaned as any).extraPages.svcCopy === 'object' && Object.keys((cleaned as any).extraPages.svcCopy).length > 0;
    const liveForText = hasModelText ? await publishedBinding(user.id).catch(() => null) : null;
    const { siteData: pruned } = svcCopySanitize(cleaned, { autoPublish: serviceCopyAutoPublish(), secret: signingSecret(), userId: user.id, refs: [draftRef(id), ...(liveForText ? [siteRef(liveForText.binding.slug)] : [])] });
    const content = { ...pruned, source: 'web-app' };
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
    // A removed service also retires its cached AI text, so it can never come back for a later service with the same key (best effort; the cache re-checks its facts too).
    if (written?.length && previous && serviceCopyEnabled()) {
      const now = serviceKeys(content);
      const gone = Array.from(serviceKeys(previous.site_data)).filter((k) => !now.has(k));
      if (gone.length) await tableCopyStore.removeMany(user.id, id, gone).catch((e: any) => console.error('[web draft] ai cache cleanup failed:', e?.message || e));
    }
    if (!written?.length) { const current = await readDraft(user.id); return res.status(409).json({ error: 'draft_changed', draft: current ? accountRow(current) : null }); }
    return res.status(200).json({ draft: accountRow(written[0]), seoProblems });
  } catch (e: any) {
    console.error('[web draft]', e?.message);
    return res.status(503).json({ error: 'save_unavailable' });
  }
}
