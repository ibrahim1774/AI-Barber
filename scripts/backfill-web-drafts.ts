/** Dry-run by default. Copies only a legacy row whose URL proves ownership of an existing WEB binding.
 * Does not guess whether an unpublished source='ios' draft was created in the browser or the iPhone app. */
import { config } from 'dotenv';
import { sbRest } from '../lib/webApp/webAppServer.js';
import { validSiteData, hasDataUrl } from '../lib/ios/siteShape.js';
config({ path: '.env.local', quiet: true });
process.env.SUPABASE_URL ||= process.env.VITE_SUPABASE_URL;
const mode = process.argv.find(x => x.startsWith('--mode='))?.split('=')[1];
if (mode !== 'test' && mode !== 'live') throw new Error('Choose --mode=test or --mode=live explicitly.');
const apply = process.argv.includes('--apply');
const bindings: any[] = await sbRest(`web_app_sites?environment=eq.${mode}&removed_at=is.null&taken_down_at=is.null&published_at=not.is.null&select=user_id,slug,stripe_subscription_id`);
const counts = { existing: 0, eligible: 0, copied: 0, requiresReview: 0 };
for (const binding of bindings ?? []) {
  const own = `user_id=eq.${encodeURIComponent(binding.user_id)}`;
  if ((await sbRest(`web_app_drafts?${own}&environment=eq.${mode}&select=user_id&limit=1`))?.length) { counts.existing++; continue; }
  const deployedUrl = `https://${binding.slug}.vercel.app`;
  const row = (await sbRest(`sites?${own}&deployed_url=eq.${encodeURIComponent(deployedUrl)}&select=id,site_data,updated_at&order=updated_at.desc&limit=1`))?.[0];
  if (!row || !validSiteData(row.site_data) || hasDataUrl(row.site_data)) { counts.requiresReview++; continue; }
  counts.eligible++;
  if (apply) {
    await sbRest('web_app_drafts?on_conflict=user_id,environment', { method: 'POST', body: {
      user_id: binding.user_id, environment: mode, draft_id: String(row.id), revision: 1,
      site_data: { ...row.site_data, source: 'web-app' }, updated_at: row.updated_at, deployed_url: deployedUrl,
      published_binding: { slug: binding.slug, transactionId: 'web:' + binding.stripe_subscription_id, publishedRevision: null },
    }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    counts.copied++;
  }
}
console.log(JSON.stringify({ mode, apply, counts }));
