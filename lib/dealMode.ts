// Marketing entry-path detection.
//
// Active paths:
//   /free-barber  → $7/month + $67/year toggle, plan 'monthly-free'
//   /booksy       → $5/month + $48/year toggle, plan 'monthly-booksy'
//   home          → $9/month + $86/year toggle (plan 'monthly')
//
// The /5 and /7 deal subpages were retired — those URLs now fall
// through to the homepage flow via the catch-all SPA rewrite.

// `/free-barber` is a $7/mo entry path with the yearly toggle visible.
// Pricing wiring lives in PrePaymentBanner via isFreeBarberPath().
export const FREE_BARBER_PATH = '/free-barber';

// Specifically matches /free-barber so the headline can emphasize
// "free" and PrePaymentBanner can route to the 'monthly-free'
// plan slug.
export function isFreeBarberPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === FREE_BARBER_PATH || p === `${FREE_BARBER_PATH}/`;
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
