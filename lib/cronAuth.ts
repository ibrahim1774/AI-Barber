// Shared cron auth gate (moved verbatim from api/publish-sweeper.ts).
export function authorized(req: any): boolean {
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
