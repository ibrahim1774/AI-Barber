// Marketing deal-mode detection.
//
// The `/5` URL is a $5/mo special pricing landing page; `/7` is the
// $7/mo variant. Everything else about the app stays identical to the
// homepage — same generator, same generated site, same deploy flow —
// only the Stripe plan changes:
//   /5 → $5/month, no yearly toggle, hard-locked
//   /7 → $7/month, no yearly toggle, hard-locked
//   home → $10/month or $72/year (toggle)
//
// The catch-all rewrite in vercel.json already routes `/5` and `/7` to
// the SPA, so no extra rewrite entry is required.

export type DealPlan = 'five' | 'seven';

export const FIVE_DEAL_PATH = '/5';
export const SEVEN_DEAL_PATH = '/7';

export function isFiveDealPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === FIVE_DEAL_PATH || p === `${FIVE_DEAL_PATH}/`;
}

export function isSevenDealPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === SEVEN_DEAL_PATH || p === `${SEVEN_DEAL_PATH}/`;
}
