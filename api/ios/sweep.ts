// Cron: the iOS sweep (lib/ios/sweep.ts). Publishes paid iOS purchases whose
// publish never finished, restores taken-down sites whose subscription is
// active again, and takes down sites whose subscription has lapsed. Apple's
// live status decides every takedown and restore.
// Independent of the Stripe sweeper (api/publish-sweeper.ts) so neither can
// starve the other of time or be skipped by the other's failure.
import { authorized } from '../../lib/cronAuth.js';
import { publishSite, readPendingSite, writePendingSite } from '../../lib/publishSite.js';
import { deployRenderedSite } from '../../lib/deploySite.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { offlineHtml } from '../../lib/ios/offlinePage.js';
import { lazyDefaultVerifier } from '../../lib/ios/appleVerify.js';
import { makeStripPending, sweepIos } from '../../lib/ios/sweep.js';
import { runDomainSweep } from '../../lib/ios/domainLive.js';

/**
 * Custom domains (lib/ios/domainFlow.ts) run after the site passes and only START steps until
 * this long after the handler began, so one slow step (a republish, ~150 s) still ends inside
 * the 300 s budget. A domain failure never fails or delays the site sweep's result.
 */
const DOMAIN_START_CUTOFF_MS = 140_000;

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  const started = Date.now();
  try {
    const summary = await sweepIos({
      repo: supabasePurchases(),
      publish: (slug, opts) => publishSite(slug, opts),
      deployOffline: async (slug) => {
        await deployRenderedSite({ siteId: slug, html: offlineHtml() });
      },
      // App Review's sandbox site must never vanish; flipped on for our own device tests.
      takedownSandbox: process.env.IOS_TAKEDOWN_SANDBOX === '1',
      // Apple is asked before every takedown and restore (lib/ios/sweep.ts).
      verify: lazyDefaultVerifier(),
      // A restore drops Book/Shop links the current plan doesn't cover (Phase 4 tiers).
      stripPending: makeStripPending({ readPending: readPendingSite, writePending: writePendingSite }),
    });
    const domains = await runDomainSweep(started + DOMAIN_START_CUTOFF_MS);
    return res.status(200).json({ ok: true, ...summary, domains });
  } catch (err: any) {
    console.error('[Sweeper:iOS] threw:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'iOS sweep failed' });
  }
}
