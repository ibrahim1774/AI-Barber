// Cron: publish paid iOS purchases whose publish never finished. Independent of
// the Stripe sweeper (api/publish-sweeper.ts) so neither can starve the other
// of time or be skipped by the other's failure.
import { authorized } from '../../lib/cronAuth.js';
import { publishSite } from '../../lib/publishSite.js';
import { supabasePurchases } from '../../lib/ios/purchases.js';
import { sweepIos } from '../../lib/ios/sweep.js';

export const config = { maxDuration: 300 };

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  try {
    const summary = await sweepIos({ repo: supabasePurchases(), publish: (slug) => publishSite(slug) });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error('[Sweeper:iOS] threw:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'iOS sweep failed' });
  }
}
