// Shared cron auth gate (originally from api/publish-sweeper.ts). Used by every cron in
// vercel.json: /api/publish-sweeper, /api/ios/sweep, /api/book/reminders.
export function authorized(req: any): boolean {
  const secret = process.env.CRON_SECRET;

  // Vercel only attaches `Authorization: Bearer $CRON_SECRET` to cron
  // invocations when CRON_SECRET is set on the project. It does NOT send an
  // x-vercel-cron header — the first version of this gate checked for that and
  // the very first scheduled run came back 401, so the safety net was dead on
  // arrival while every other test passed.
  if (secret) {
    const auth = String(req.headers.authorization || '');
    return auth === `Bearer ${secret}`;
  }

  // Fallback ONLY while CRON_SECRET is unset, so the crons work before it is
  // configured. Vercel's scheduler identifies itself as vercel-cron/1.0. The user
  // agent is spoofable, so once a secret exists it is never enough on its own:
  // the reminders cron can trigger Stripe refund retries and session expiries,
  // and with a secret set only the Bearer header (which Vercel sends) may run it.
  const ua = String(req.headers['user-agent'] || '');
  return ua.startsWith('vercel-cron/');
}
