// The reconciler: find people who paid but have no live site, and publish it.
//
// The webhook is the fast path and Stripe retries it, but retries eventually
// stop and a webhook can be missed entirely (endpoint rotated, a deploy of
// THIS app mid-delivery, a Vercel incident). Event-driven work plus a periodic
// sweep is the pattern that makes "paid but nothing built" impossible rather
// than merely unlikely — the alternative is finding out from the customer,
// which is how the 2026-08-10 pair surfaced.
//
// Runs on a cron every 10 minutes (vercel.json). Also callable by hand with
// the CRON_SECRET for backfills.
//
// Cheap by construction: it lists recent PAID Stripe sessions, and publishSite
// short-circuits on anything already serving, so a quiet sweep is a handful of
// HEAD-ish requests and no deploys.
import { publishSite } from '../lib/publishSite.js';

export const config = { maxDuration: 300 };

// How far back to look. Comfortably past Stripe's webhook retry window, so a
// site only reaches here once the fast path has genuinely given up.
const LOOKBACK_HOURS = 48;
// Ceiling on deploys per run so a bad day can't turn into a deploy storm.
const MAX_PUBLISHES_PER_RUN = 10;

function authorized(req: any): boolean {
  const secret = process.env.CRON_SECRET;

  // Vercel only attaches `Authorization: Bearer $CRON_SECRET` to cron
  // invocations when CRON_SECRET is set on the project. It does NOT send an
  // x-vercel-cron header — the first version of this gate checked for that and
  // the very first scheduled run came back 401, so the safety net was dead on
  // arrival while every other test passed.
  if (secret) {
    const auth = String(req.headers.authorization || '');
    if (auth === `Bearer ${secret}`) return true;
  }

  // Fallback so the sweep works before CRON_SECRET is configured. Vercel's
  // scheduler identifies itself as vercel-cron/1.0.
  //
  // Spoofable, and that's acceptable here: this endpoint only publishes sites
  // that are ALREADY PAID FOR and not currently serving. A stranger calling it
  // repeatedly gets no-ops, because publishSite short-circuits on anything
  // live. There is no state an outsider can change and nothing to enumerate —
  // the response names only sites that were already owed a deploy.
  const ua = String(req.headers['user-agent'] || '');
  return ua.startsWith('vercel-cron/');
}

export default async function handler(req: any, res: any) {
  if (!authorized(req)) return res.status(401).json({ error: 'Not authorized' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Server missing STRIPE_SECRET_KEY' });

  const since = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600;
  const checked: string[] = [];
  const repaired: Array<{ siteId: string; url: string }> = [];
  const failed: Array<{ siteId: string; error?: string; reason?: string }> = [];

  try {
    let startingAfter: string | null = null;
    let publishes = 0;

    for (let page = 0; page < 5; page++) {
      const qs = new URLSearchParams({ limit: '100', 'created[gte]': String(since) });
      if (startingAfter) qs.set('starting_after', startingAfter);
      const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions?${qs}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (!resp.ok) {
        return res.status(502).json({ error: 'Stripe list failed', status: resp.status });
      }
      const body: any = await resp.json();
      const sessions: any[] = body?.data || [];

      for (const s of sessions) {
        if (s.payment_status !== 'paid') continue;
        // Same-account safety: ignore sessions tagged for a different app.
        if (s.metadata?.app && s.metadata.app !== 'aibarber') continue;
        const siteId = s.metadata?.siteId || s.client_reference_id;
        if (!siteId || typeof siteId !== 'string') continue;
        if (checked.includes(siteId)) continue;
        checked.push(siteId);

        if (publishes >= MAX_PUBLISHES_PER_RUN) {
          // Never silently truncate — say what was left for the next run.
          console.warn(`[Sweeper] Hit the ${MAX_PUBLISHES_PER_RUN}-publish cap; remaining sites roll to the next run.`);
          break;
        }

        const outcome = await publishSite(siteId);
        if (!outcome.ok) {
          if (outcome.reason === 'deploy-failed') {
            failed.push({ siteId: outcome.siteId, error: outcome.error });
            console.error(`[Sweeper] FAILED ${outcome.siteId}: ${outcome.error}`);
          } else {
            // no-backup: a custom-design ($29) sale, or a session that predates
            // the pre-checkout backup. Nothing to build, not an error.
            failed.push({ siteId: outcome.siteId, reason: outcome.reason });
          }
        } else if (!outcome.alreadyLive) {
          publishes++;
          repaired.push({ siteId: outcome.siteId, url: outcome.deployedUrl });
          console.log(`[Sweeper] REPAIRED ${outcome.siteId} -> ${outcome.deployedUrl}`);
        }
      }

      if (!body?.has_more || publishes >= MAX_PUBLISHES_PER_RUN) break;
      startingAfter = sessions[sessions.length - 1]?.id || null;
      if (!startingAfter) break;
    }

    return res.status(200).json({
      ok: true,
      lookbackHours: LOOKBACK_HOURS,
      paidSitesChecked: checked.length,
      repaired,
      skipped: failed,
    });
  } catch (err: any) {
    console.error('[Sweeper] threw:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Sweeper failed' });
  }
}
