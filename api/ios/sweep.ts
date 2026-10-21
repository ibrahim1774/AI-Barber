// Cron: the iOS sweep (lib/ios/sweep.ts). Publishes paid iOS purchases whose
// publish never finished, restores taken-down sites whose subscription is
// active again, and takes down sites whose subscription has lapsed. Apple's
// live status decides every takedown and restore.
// Independent of the Stripe sweeper (api/publish-sweeper.ts) so neither can
// starve the other of time or be skipped by the other's failure.
import { authorized } from '../../lib/cronAuth.js';
import { publishSite } from '../../lib/publishSite.js';
import { deployRenderedSite } from '../../lib/deploySite.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { offlineHtml } from '../../lib/ios/offlinePage.js';
import { lazyDefaultVerifier } from '../../lib/ios/appleVerify.js';
import { sweepIos } from '../../lib/ios/sweep.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  try {
    const summary = await sweepIos({
      repo: supabasePurchases(),
      publish: (slug, opts) => publishSite(slug, opts),
      deployOffline: async (slug) => {
        await deployRenderedSite({ siteId: slug, html: offlineHtml() });
      },
      // Apple is asked before every takedown and restore (lib/ios/sweep.ts).
      verify: lazyDefaultVerifier(),
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error('[Sweeper:iOS] threw:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'iOS sweep failed' });
  }
}
