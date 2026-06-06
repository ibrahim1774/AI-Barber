// Marketing deal-mode detection.
//
// `/5` and `/7` are hard-locked launch-special pricing — no yearly
// toggle. `/free-barber` and `/booksy` share the $5/mo monthly but
// keep the yearly toggle visible so a 20%-off yearly offer reads
// alongside (handled in PrePaymentBanner, not here):
//   /5            → $5/month, no yearly toggle, hard-locked
//   /7            → $7/month, no yearly toggle, hard-locked
//   /free-barber  → $5/month + $48/year toggle, plan 'monthly-free'
//   /booksy       → $5/month + $48/year toggle, plan 'monthly-booksy'
//   home          → $9/month + $86/year toggle (plan 'monthly')
//
// The catch-all rewrite in vercel.json already routes these to the
// SPA, so no extra rewrite entry is required.

export type DealPlan = 'five' | 'seven';

export const FIVE_DEAL_PATH = '/5';
// `/free-barber` is a separate $5/mo entry path that keeps the
// yearly toggle visible — NOT a hard-locked deal. Pricing wiring
// lives in PrePaymentBanner via isFreeBarberPath().
export const FREE_BARBER_PATH = '/free-barber';
export const SEVEN_DEAL_PATH = '/7';

export function isFiveDealPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === FIVE_DEAL_PATH || p === `${FIVE_DEAL_PATH}/`;
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
