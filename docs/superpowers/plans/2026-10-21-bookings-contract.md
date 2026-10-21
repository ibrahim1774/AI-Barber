# Bookings (Phase 2): API contract and parallel build plan

> **For agentic workers:** this file is the shared contract for five parallel implementers. Field names, routes and status codes here are binding. If you need a change, stop and report it; don't diverge.

**Spec:** `docs/superpowers/specs/2026-10-21-bookings-store-design.md`
**Foundation (built first, reviewed):** migration `005_bookings_foundation.sql` (`ab_*` tables), `lib/bookings/slots.ts` (`freeSlots`, `freeSlotsAny`), `lib/bookings/money.ts` (`platformFeeCents`, `depositCents`, `refundOnCancel`). Branch `bookings-foundation` in `~/AI-Barber`.

## Rulings (controller, 2026-10-21)

- **Booking page URL:** `https://www.aibarber.org/book/{slug}` (path, not subdomain) for v1. Subdomain aliases can come later.
  - Separate Vite entry `book.html`, so aibarber.org's Meta/TikTok pixels never load on it.
  - Rewrite `/book/(.*)` → `/book.html`.
  - Reserved slugs: `manage`, `api`, `stripe-return`.
- **Owner CRUD (services, members, availability, time off, mark paid / done / no-show):** done by the app directly through Supabase under RLS.
- **Server endpoints:** only for public pages and for actions with side effects (money, email, push, slot rules).
- **Services, one source:** once a shop has bookings set up, `ab_services` is the source. The app's Services editor writes `ab_services` and mirrors `show_on_site` services into `WebsiteData.services` (price as `"$30"`, duration as `"30 min"`), so publishing updates the site. Before bookings are set up, it edits `WebsiteData` only (the Phase 1 behaviour).
- **Email:** nodemailer over Google Workspace SMTP, using env `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` (support@davoxa.com).
  - Missing env: log, skip, and never fail the request.
- **Push:** Expo push HTTP API (`https://exp.host/--/api/v2/push/send`). No SDK.
- **Stripe Connect:** raw `fetch` to `api.stripe.com`, as the rest of the repo does. Env `STRIPE_CONNECT_SECRET_KEY` (AI Barber account; sandbox `acct_1UT0sOB5422KX2a5` for now) and `STRIPE_CONNECT_WEBHOOK_SECRET`.
  - **Standard accounts.** Charges are made on the connected account (`Stripe-Account` header) with `application_fee_amount = platformFeeCents(amount, shop.platform_fee_bps)`.
  - **Never touch the existing Primehub Stripe keys/flows.**
- **Card holds:** a card booking is inserted as `status 'booked'`, `payment_status 'awaiting'`, with a Checkout Session expiring in 30 min.
  - `checkout.session.completed` → `paid`, or `deposit` when the amount < price.
  - `checkout.session.expired` → `cancelled`, `cancelled_by 'customer'` (frees the slot).
- **Bookings gate:** the server allows public booking when `ab_shops.bookings_enabled` is true AND the shop's linked iOS purchase is active (`ios_purchases` row via `ab_shops.ios_otid`, not revoked, `taken_down_at` null). Phase 4 narrows this to the Bookings/Store products.
  - Otherwise `GET /api/book/shop` returns `{ paused: true }` and every write returns `423 { error: 'bookings-paused' }`.

## Migration 006 (server agent S1 owns it)

`supabase/migrations/006_bookings_api.sql`:
- `ab_shops`: add `ios_otid text`, `address text`, `phone text`, `accent text`.
- `ab_appointments`: add `reminder_sent_at timestamptz`, `customer_says_paid_at timestamptz`.
- A `default` for `manage_token`: `encode(gen_random_bytes(24), 'hex')`.

## Public API (no auth; rate-limited per IP: 60 req/min reads, 10 req/min writes)

All JSON. Errors are `{ error: string }`. Times are ISO UTC. Money is integer cents.

- **`GET /api/book/shop?slug=`**
  - `200 { paused: false, shop: { slug, name, timezone, address, phone, accent, cancelCutoffMin, pay: { inShop: boolean, card: boolean, manual: { cashapp?: string, venmo?: string, zelle?: string, paypal?: string } } }, services: [{ id, name, priceCents: number|null, durationMin, description, photoUrl, depositCents }], members: [{ id, name, photoUrl, bio, serviceIds: string[] | null }] }`
  - `200 { paused: true, shop: { name } }`
  - `404 { error: 'not-found' }`
- **`GET /api/book/days?slug=&serviceId=&memberId=any|<uuid>&month=YYYY-MM`** → `200 { days: { 'YYYY-MM-DD': true }, timezone }`. A day is included only if it has at least one free slot.
- **`GET /api/book/slots?slug=&serviceId=&memberId=any|<uuid>&date=YYYY-MM-DD`** → `200 { slots: [{ start, memberId }] }`
- **`POST /api/book/appointments`**
  - Body: `{ slug, serviceId, memberId: 'any'|<uuid>, start, customer: { name, phone, email }, note?, pay: 'shop'|'manual'|'card' }`
  - `201 { appointment: { id, start, end, serviceName, memberName, priceCents, depositCents, manageUrl }, checkoutUrl?: string }`. `checkoutUrl` is present only for `pay: 'card'`.
  - `409 { error: 'slot-taken', alternatives: [{ start, memberId }] }` (next 3 free).
  - `400 { error: 'invalid', field }`
  - `409 { error: 'duplicate' }` (same phone + same start).
  - `423 { error: 'bookings-paused' }`
- **`GET /api/book/manage?token=`** → `200 { appointment: { id, start, end, status, serviceName, memberName, priceCents, amountPaidCents, paymentStatus, shop: { name, slug, address, phone, timezone } }, canCancel: boolean, canReschedule: boolean, refundCentsIfCancelled: number }`
- **`POST /api/book/manage`**
  - Body: `{ token, action: 'cancel' }` or `{ token, action: 'reschedule', start, memberId? }`
  - `200 { appointment }`, `409 { error: 'slot-taken', alternatives }`, `403 { error: 'too-late' }`
- **`POST /api/book/sent`** → body `{ token, method: 'cashapp'|'venmo'|'zelle'|'paypal' }` → `200 {}`. Sets `customer_says_paid_at` and pushes "{name} says they paid ${x} by {method}".
- **`GET /api/book/ics?t=<member ics_token>`** → `text/calendar`: that member's appointments, from 30 days back to 180 days ahead.
- **`POST /api/stripe/connect-webhook`:** verifies the signature; handles `checkout.session.completed`, `checkout.session.expired`, `account.updated` (sets `stripe_charges_enabled`) and `charge.refunded`. Idempotent by event id (stored in `ab_events`).
- **`GET /stripe-return?shop=&state=`:** a tiny static page (`public/stripe-return.html`) that redirects to `aibarber://get-paid?state=…`.

## Owner API (`Authorization: Bearer <Supabase access token>`; caller must be the shop owner)

- **`POST /api/shop/setup`**
  - Body: `{ siteId, name, timezone, address?, phone?, accent?, transactionId?, services: [{ name, priceCents|null, durationMin, description?, photoUrl? }] }`
  - Behaviour:
    - Creates (or returns the existing) `ab_shops` row for this owner (one shop per owner in v1).
    - Creates the owner's `ab_members` row (`role 'owner'`, `display_name` = the account's full name or "Owner").
    - Seeds `ab_services` from `services`.
    - Seeds `ab_availability` for the owner from the defaults (Tue–Sat 9:00–18:00, `weekday` 0 = Mon).
    - Picks the slug: the site's Vercel label if this owner's `sites` row has one; else `slugify(name)`, plus `-xxxx` if it's taken or reserved.
    - If `transactionId` is given, verifies it with the existing `lib/ios` verifier and stores `ios_otid`.
  - `200 { shop: { id, slug, ... } }`
- **`POST /api/shop/appointments`** (walk-in or owner booking)
  - Body: `{ memberId, serviceId, start, customer: { name, phone?, email? }, note? }`
  - Skips minimum notice and lead days. Still subject to the exclusion constraint.
  - Returns `201` or `409 slot-taken`.
- **`POST /api/shop/appointments/:id/cancel`** → full refund of the amount paid (card), an email to the customer, and a `cancelled_by 'shop'` status. `200 { appointment }`.
- **`POST /api/shop/appointments/:id/reschedule`** → body `{ start, memberId? }` → email to the customer. `200` or `409`.
- **`POST /api/shop/time-off`** → body `{ memberId, start, end, reason?, cancelConflicts: boolean }`.
  - Inserts the time off.
  - If `cancelConflicts` is set, cancels the overlapping appointments with refund + email.
  - `200 { conflicts: [{ id, start, customerName }] }`. The conflicts are listed even when `cancelConflicts` is false, so the app can ask first.
- **`POST /api/shop/stripe/onboard`**
  - Creates a Standard connected account if needed (prefilled: business name, phone, URL, email of the owner).
  - Creates an Account Link (`refresh_url` / `return_url` = `https://www.aibarber.org/stripe-return?shop=<id>`).
  - `200 { url }`
- **`GET /api/shop/stripe/status`** → `200 { connected: boolean, chargesEnabled: boolean, detailsSubmitted: boolean }`, refreshed from Stripe.
- **`POST /api/shop/push-token`** → body `{ expoToken, platform: 'ios' }` → upsert → `200 {}`.

## Cron

- **`/api/book/reminders`** (every 15 min): emails a reminder for appointments 23–25 h ahead with `reminder_sent_at` null, then stamps it.
- **`/api/book/daily-summary`** (hourly): pushes "3 bookings today" to owners at 8:00 shop-local. It's opt-in via `ab_shops.daily_summary bool default false`, which goes in migration 006.

## Notifications (server agent S2 owns `lib/bookings/notify.ts`)

`notify(event)` with `event.kind` one of:
- `booking_created`: push to the shop + confirmation email to the customer, with `.ics` attached and the manage link.
- `booking_cancelled {by}`: push and email.
- `booking_rescheduled`: push and email.
- `customer_says_paid`: push.
- `reminder`: email.

Emails go out as plain HTML in the shop's name: "{Shop} via AI Barber" <support@davoxa.com>, with a reply-to of the shop owner's email.

Push copy:
- "New booking: {customer}, {service}, {Fri 2:00 PM}"
- "Cancelled: {customer}, {Fri 2:00 PM}"
- "Rescheduled: {customer} → {Sat 11:00 AM}"

## Parallel agents and their boundaries

| Agent | Repo / branch | Owns |
|---|---|---|
| **S1 Booking API** | AI-Barber `bookings-api` (off `bookings-foundation`) | migration 006, `api/book/{shop,days,slots,appointments,manage,sent,ics}.ts`, `api/shop/{setup,appointments,time-off,push-token}.ts`, `lib/bookings/{repo,auth,rateLimit,slug}.ts`, tests. It calls S2's functions through the interfaces below and stubs them in tests. |
| **S2 Payments + notifications** | AI-Barber `bookings-pay` (off `bookings-foundation`) | `lib/bookings/{payments,notify,email,push,ics}.ts`, `api/stripe/connect-webhook.ts`, `api/shop/stripe/{onboard,status}.ts`, `api/book/{reminders,daily-summary}.ts`, `public/stripe-return.html`, the vercel.json crons + rewrites for these, tests. |
| **W Booking page** | AI-Barber `bookings-page` (off `bookings-foundation`) | `book.html`, `src/book/**` (React, no pixels, no analytics except a privacy-safe PostHog pageview), the vite.config multi-page input, the vercel.json `/book/*` rewrite. It builds against this contract with a mocked fetch. |
| **A1 App Bookings tab** | aibarber-ios `p2-bookings-tab` | `src/app/(tabs)/bookings.tsx`, `src/components/bookings/**` (date strip, appointment list, detail sheet, add booking, block time), `src/lib/bookings/{api,calendar}.ts`, push-token registration, tab-bar entry. |
| **A2 App setup + Get Paid** | aibarber-ios `p2-bookings-setup` | account gate + first-run wizard, `src/lib/shop.ts` (Supabase data layer for `ab_*`), `src/components/setup/**` (barbers, per-barber hours, booking rules, services bookings-mode, Get Paid incl. manual handles + Stripe onboarding via `aibarber://get-paid` deep link), the Share sheet "Booking link" row (`ShareKind 'booking'`: `Book your next cut at ${shop} 💈 ${url}`). |

**Interfaces S1 consumes from S2** (`lib/bookings/payments.ts`, `lib/bookings/notify.ts`):
- `createCardCheckout(shop, appt, amountCents): Promise<{ url: string; sessionId: string }>`
- `refundAppointment(shop, appt, amountCents): Promise<{ refundedCents: number }>`
- `notify(event: NotifyEvent): Promise<void>`. It never throws.

**Interface A1 and A2 share** (A2 creates `src/lib/shop.ts`; A1 consumes it, coding against this signature and stubbing it until merge):
- `loadMyShop(): Promise<Shop | null>`
- `type Shop = { id, slug, name, timezone, bookingsEnabled, payInShop, manualHandles, stripeChargesEnabled }`
- `listMembers(shopId): Promise<Member[]>`
- `listServices(shopId): Promise<Service[]>`
- `bookingUrl(shop): string` → `https://www.aibarber.org/book/${slug}`

## Reviews

- **One Opus review each for S1 and S2.** These are money and booking-critical: double-booking, refunds, webhook idempotency, RLS, auth, rate limits.
- **W, A1 and A2:** batched into one Opus whole-phase review after integration.

## Notes from the foundation build (binding for S1/S2)

- **Column grants on `ab_shops`.** The foundation grants owners `insert`/`update` column by column, so they can't change `platform_fee_bps` or the Stripe fields.
  - Every new column in migration 006 that the app writes directly (`address`, `phone`, `accent`, `daily_summary`) must also be granted to `authenticated` in 006. If it isn't, the write fails with error 42501.
  - Server-only columns (`ios_otid`) are not granted.
- **Push tokens:** `/api/shop/push-token` upserts through the service role. The table's RLS is per user and tokens are unique, so a phone that switches accounts must be able to take its token over.
- **Duplicate bookings:** the API checks the same normalized phone at the same start across all barbers of the shop, and returns `409 duplicate`. There is no database guard for this.
- **Buffer:** the slot engine applies `buffer_min` around existing appointments. The database only blocks true overlap, which is fine because the default buffer is 0.
- **Merge order:** merge `ios-lapse` (004) before `bookings-*` (005/006).
