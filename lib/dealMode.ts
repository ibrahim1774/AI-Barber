// Marketing deal-mode detection.
//
// `/5` and `/free-barber` both land on the $5/mo special pricing
// flow; `/7` is the $7/mo variant. Everything else about the app
// stays identical to the homepage — same generator, same generated
// site, same deploy flow — only the Stripe plan changes:
//   /5, /free-barber → $5/month, no yearly toggle, hard-locked
//   /7               → $7/month, no yearly toggle, hard-locked
//   home             → $9/month or $72/year (toggle)
//
// The catch-all rewrite in vercel.json already routes these to the
// SPA, so no extra rewrite entry is required.

export type DealPlan = 'five' | 'seven';

export const FIVE_DEAL_PATH = '/5';
// `/free-barber` is a marketing alias that shares the $5/mo flow.
// Treated as a five-deal path everywhere so plan + pricing label +
// locked-toggle behavior all match `/5` automatically.
export const FREE_BARBER_PATH = '/free-barber';
export const SEVEN_DEAL_PATH = '/7';

export function isFiveDealPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return (
    p === FIVE_DEAL_PATH ||
    p === `${FIVE_DEAL_PATH}/` ||
    p === FREE_BARBER_PATH ||
    p === `${FREE_BARBER_PATH}/`
  );
}

// Specifically matches /free-barber so marketing copy (headline,
// CTAs) can emphasize "free" on that single URL without affecting
// /5. Pricing / plan behavior is still driven by isFiveDealPath
// (which matches both) — this helper only gates copy.
export function isFreeBarberPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === FREE_BARBER_PATH || p === `${FREE_BARBER_PATH}/`;
}

export function isSevenDealPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === SEVEN_DEAL_PATH || p === `${SEVEN_DEAL_PATH}/`;
}

// /import (or legacy /booksy) lands on a single-URL generator. User
// pastes any supported booking-platform link (Booksy, Fresha, StyleSeat,
// Square Appointments, Vagaro) → we scrape shop name, address,
// services, photos, reviews → LUXE renderer paints the pre-filled site.
export const IMPORT_PATHS = ['/import', '/booksy'];
export function isImportPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return IMPORT_PATHS.some((base) => p === base || p === `${base}/`);
}
// Back-compat alias — keep until all callsites migrate.
export const BOOKSY_PATH = '/booksy';
export const isBooksyPath = isImportPath;
