// Marketing deal-mode detection.
//
// The `/5` URL is a $5/mo special pricing landing page. Everything else
// about the app stays identical to the homepage — same generator, same
// generated site, same deploy flow — only the Stripe plan changes:
// $5/month, no yearly toggle.
//
// The catch-all rewrite in vercel.json already routes `/5` to the SPA,
// so no extra rewrite entry is required.

export type DealPlan = 'five';

export const FIVE_DEAL_PATH = '/5';

export function isFiveDealPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === FIVE_DEAL_PATH || p === `${FIVE_DEAL_PATH}/`;
}
