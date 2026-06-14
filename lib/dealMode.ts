// Marketing entry-path detection.
//
// Active paths:
//   /free-barber  → $7/month + $67/year toggle, plan 'monthly-free'
//   /booksy       → $7/month + $67/year toggle, plan 'monthly-booksy'
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

// `/primebarber` = standalone SaaS landing page for the full Prime
// Barber custom-website platform ($29/mo with a 7-day free trial). Unlike
// the other entry paths, this one is NOT a site generator — it's a
// marketing page that opens an embedded Stripe checkout. After
// payment the visitor is forwarded to the Google Form so we can
// collect their build requirements (same form the legacy custom-
// design upsell uses).
export const PRIMEBARBER_PATH = '/primebarber';
export function isPrimeBarberPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === PRIMEBARBER_PATH || p === `${PRIMEBARBER_PATH}/`;
}

// `/recover` = standalone page for customers who paid + got the
// "Publishing Failed" screen but whose site actually deployed to
// Vercel. Lets them enter their email or Stripe session ID, look up
// the GCS pending-site backup, and sign up to claim the deployed
// site into their dashboard.
export const RECOVER_PATH = '/recover';
export function isRecoverPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === RECOVER_PATH || p === `${RECOVER_PATH}/`;
}

// `/generatebarbershop` — fast-conversion funnel. Single-input hero
// for shop name, accelerator below for Booksy/Fresha/Square/Vagaro/
// StyleSeat link. See docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md
export const GENERATE_BARBERSHOP_PATH = '/generatebarbershop';

export function isGenerateBarbershopPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === GENERATE_BARBERSHOP_PATH || p === `${GENERATE_BARBERSHOP_PATH}/`;
}
