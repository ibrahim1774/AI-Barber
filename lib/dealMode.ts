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

// `/booking` = generic version of /booksy. Same single-URL generator and
// scrape pipeline, but platform-neutral copy ("paste your Booksy / Fresha
// / Square / Vagaro / StyleSeat link"). Pricing is its own: $10/mo +
// $59/yr (plans 'monthly-booking' / 'yearly-booking'), wired in
// PrePaymentBanner via isBookingPath().
export const BOOKING_PATH = '/booking';
export function isBookingPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === BOOKING_PATH || p === `${BOOKING_PATH}/`;
}

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

// `/generate` — "Customize Your Barbershop Site" subpage. A barber
// site is generated and shown immediately, then a centered overlay
// asks "Do you have a booking link?" (Yes → paste any booking link;
// No → barbershop name + service area + phone). Pricing is its own
// $10/mo + $59/yr toggle (plans 'monthly-generate' / 'yearly-generate').
// Matches ONLY /generate — /generatebarbershop is a separate path
// handled above via isGenerateBarbershopPath().
export const GENERATE_PATH = '/generate';
export function isGeneratePath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === GENERATE_PATH || p === `${GENERATE_PATH}/`;
}

// `/barber-generate` — the /booksy experience with the form-first
// "paste your link" gate removed. A barber site is seeded and shown
// immediately (like /generate), and the SAME Booksy-flavored customize
// overlay (booking-link field + Design 1/2 switcher + color picker)
// sits over it. Pricing/analytics reuse the Booksy plan slugs
// ($10/mo · $49/yr, 'monthly-booksy'/'yearly-booksy') via booksyMode in
// PrePaymentBanner — an "exact duplicate of /booksy" minus the front form.
// Kept OUT of IMPORT_PATHS so isBooksyPath() stays false here (it drives
// the form-first /booksy route in App.tsx); pricing is inherited surgically.
export const BARBER_GENERATE_PATH = '/barber-generate';
export function isBarberGeneratePath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === BARBER_GENERATE_PATH || p === `${BARBER_GENERATE_PATH}/`;
}

// `/edit` — the Client Sites portal. Login for owners of the hand-built
// static client sites (Vercel "Client Sites" team): they edit text/images
// on their pages and publish. Completely separate system from the barber
// site generator — its own `client_sites` table + `client-sites` storage
// bucket; shares only Supabase auth and the app shell.
export const CLIENT_EDIT_PATH = '/edit';
export function isClientEditPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === CLIENT_EDIT_PATH || p === `${CLIENT_EDIT_PATH}/`;
}

// `/onboard` — operator page that sets up a Client Site portal from the
// browser: pulls the live Vercel files + creates the client login via
// /api/client-site-onboard. Open like /admin-generate; the API guards
// shared-auth accounts server-side.
export const ONBOARD_PATH = '/onboard';
export function isOnboardPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === ONBOARD_PATH || p === `${ONBOARD_PATH}/`;
}

// `/admin-generate` — operator-only white-glove flow for customers who
// paid off-platform (Cash App, Venmo, in person, etc.) but can't or
// won't navigate the funnel themselves. Builds a site, creates the
// customer's Supabase account, publishes, attaches. No payment.
// The route is intentionally OPEN — no password gate. Add one if abuse
// shows up.
export const ADMIN_GENERATE_PATH = '/admin-generate';
export function isAdminGeneratePath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === ADMIN_GENERATE_PATH || p === `${ADMIN_GENERATE_PATH}/`;
}

// `/own-brand` — standalone static demo barbershop site. Shows what a
// fully branded shop site looks like (booking calendar, product store,
// reviews, FAQ, Google Maps) using the same Euphoria visual shell the
// /booksy flow generates. No generator/auth/editor machinery — it's a
// plain marketing landing whose single CTA points at the homepage so
// the visitor can launch their own branded site.
export const OWN_BRAND_PATH = '/own-brand';
export function isOwnBrandPath(pathname?: string): boolean {
  const p = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return p === OWN_BRAND_PATH || p === `${OWN_BRAND_PATH}/`;
}
