// Cron: the custom-domain sweep (lib/ios/domainFlow.ts sweepDomains), on its own 300 s budget,
// independent of the site sweep (/api/ios/sweep): payer-confirmed detaches, resumes, re-attaches,
// payer refresh + Vercel auto-renew (read live), and the post-DNS republish. Steps only START in
// the first 140 s, so one slow step (a republish, ~150 s) still ends inside the budget.
import { authorized } from '../../lib/cronAuth.js';
import { runDomainSweep } from '../../lib/ios/domainLive.js';

export const config = { maxDuration: 300 };
const START_CUTOFF_MS = 140_000;

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });
  const summary = await runDomainSweep(Date.now() + START_CUTOFF_MS);
  return res.status('error' in summary ? 500 : 200).json('error' in summary ? summary : { ok: true, ...summary });
}
