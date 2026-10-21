# AI Barber: Bookings, Store, and Section Editors (design)

**Status:** draft for Ibrahim's approval, 2026-10-21.
**Builds on:** `2026-10-20-aibarber-ios-design.md` (the website app) and the lapse-takedown work of 2026-10-21.

## 1. Intent and why

Today AI Barber sells a website. Ibrahim wants it to be the barber's whole front door: **website + online bookings + a small store**, the way Booksy is, minus Booksy's consumer marketplace. Barbers are not technical. Everything must be doable with a thumb, in a minute, with sensible defaults and nothing to configure that they don't understand.

Decisions already made by Ibrahim (2026-10-21):
- Per-barber calendars (a shop can have several barbers, each with their own hours and bookings).
- Store supports pickup and shipping.
- Pricing: three plans, Website $19.99 / Bookings $24.99 / Store $39.99 per month (see §11).
- Payments: Stripe Connect (bank payouts, deposits, Apple Pay) **or** manual rails (Cash App / Venmo / Zelle / PayPal handle) **or** pay in the shop. Any mix. A 1–2% platform fee on Stripe payments only.
- No customer accounts, no reviews, no discovery.
- Services and other site sections are edited as simple structured lists, not by hunting for text in the preview.

## 2. Goals, non-goals, anti-goals

**Goals**
- A customer can book an appointment from the barber's website in four taps, on a phone, without an account.
- A barber sees today's appointments the moment they open the app, gets a push for every new booking, and can block time or mark a no-show in two taps.
- A barber can add a product with a photo, name and price in under a minute, and customers can buy it (pickup or shipped).
- One Services list drives the website and the booking page. Add or remove once; the site updates on publish.
- Sharing the site/booking link is one tap into the iOS share sheet (Messages, WhatsApp, AirDrop, Instagram, Copy) with a pre-written message, plus a QR code.
- Nobody is blocked by payment setup: bookings work on day one with "pay in shop".

**Non-goals (v1)**
- Customer accounts, reviews, marketplace/discovery, loyalty.
- SMS (costs money; email + push instead).
- Two-way Google/Apple Calendar sync (one-way subscribe link instead).
- Stock counts, product variants, coupons, tax calculation.
- Staff-paid seats or per-staff billing.

**Anti-goals**
- Anything that needs a settings screen a barber wouldn't understand. If a setting is needed, it ships with a default and lives under "Advanced".
- Taking money without the barber knowing (platform fee is shown on the Stripe setup screen).
- Making the website's static-hosting model dynamic. Dynamic pages live on aibarber.org.

## 3. Constraints

- App: Expo SDK 55, expo-router, existing tabs Edit / Settings. Superwall for paywalls; RevenueCat observes; AppsFlyer/Meta/PostHog as today.
- Backend: Vercel functions in the AI-Barber repo, shared Supabase (`lyjruphvzfwbtzfwfvwm`, shared with PrimeHub), GCS for images.
- Sites: static HTML per customer on Vercel. Booking and shop pages are hosted on aibarber.org subdomains and linked from the site.
- Apple: haircuts and physical products are real-world goods, so Stripe/manual rails are allowed (Guideline 3.1.3(e)); the AI Barber plans themselves stay on IAP. Review notes must say this.
- Lapse rule (2026-10-21): a lapsed subscription takes the site offline. Extended here: booking page shows "Bookings paused"; owner keeps read-only access to upcoming appointments for 30 days.

## 4. Roles and accounts

**Account rule (Claude's call, 2026-10-21):** publishing a website stays account-optional (the Apple purchase is the identity, as today). **Bookings and Store require a free account.** The first time the Bookings or Store tab opens, the barber creates an account (name, email, password) or signs in, before the setup wizard. The shop row is created then and linked to the `ios_purchases` row through the existing `user_id` attach. No live account-less shops exist yet (the app is not launched), so there is no migration. A barber gets their shop back on a new phone by signing in (the account pull built on 2026-10-21) or by Restore purchases.


- **Owner:** the account that pays. Manages everything.
- **Barber (staff):** a person who takes bookings. v1 release: owner manages every barber's hours and sees all calendars; a barber can subscribe to their own calendar feed. **v1.1 (first update):** barber signs in by invite link, sees only their calendar, blocks their own time, gets their own pushes. Data model is built for v1.1 from day one (`shop_members` with roles).
- **Customer:** no account. Identified per booking/order by name + phone + email. Manage link by email.

## 5. App structure

Bottom tabs: **Edit · Bookings · Store · Settings**. (Store tab hidden until the Store tier is active; shows an upgrade card otherwise.)

### 5.1 Edit tab (existing) + Sections

Keep the live preview and tap-to-edit. Add a **Sections** button in the bottom bar next to Text / Photos / Colour / Design. Sections opens a sheet listing the site's sections as cards:

- **Services** → the shared Services list (see 6).
- **Team** → barbers: name, photo, one-line bio. Same list the booking page uses.
- **Hours** → the weekly hours grid (shop hours). Same grid used for booking availability unless a barber has their own.
- **Gallery** → photo grid, add/remove/reorder.
- **About** → shop name, tagline, about paragraph, address, phone, booking link toggle.
- **Contact** → phone, address, Instagram, map toggle.

Each card is a plain form list. Editing a section updates the preview immediately; **Publish** pushes it live as today. The intent: a barber never needs to find text in the preview, though they still can.

### 5.2 Bookings tab

**Header:** shop name · **Share** (icon) · **Setup** (gear).

**Date strip:** horizontal days (Today highlighted), swipe for weeks. Tapping a day shows its appointments.

**Barber filter chips** (only if more than one barber): All · Mike · Jay.

**Appointment list** for the day, in time order. Each row: time, customer name, service, barber (if >1), status chip (Booked / Paid / Deposit / No-show / Done). Empty day: "No bookings yet. Share your booking link" with a Share button.

**Floating +:** "Add booking" (walk-in: pick barber, service, time, name, optional phone) · "Block time" (barber, from/to, or all day; reason optional).

**Appointment detail (sheet):** customer name, phone (Call · Text buttons), email, service, barber, time, price, payment status. Buttons: **Mark paid** · **No-show** · **Reschedule** · **Cancel** (asks to confirm; customer gets an email). After Done: **"Text rebook link"** opens Messages to the customer with "Thanks for coming in! Book your next cut: {link}".

**Setup (gear) screen:** Services · Barbers · Hours · Booking rules (Advanced) · Get paid · Calendar subscription link.

**First-run wizard** (shown once when the Bookings tab is first opened), every step skippable with defaults:
1. Your services (pre-filled list; tap to edit prices).
2. Your hours (grid, default Tue–Sat 9–6).
3. Who takes bookings? (Just me / Add barbers.)
4. How do you want to get paid? (In shop / Cash App etc. / Card payments.)
5. Share your booking link (share sheet).

### 5.3 Store tab

Segmented: **Products · Orders** (Orders shows a badge for new orders).

**Products:** grid of photo cards with price. **+** opens Add product: photo (camera / library, up to 5, first is the cover) → name → price → optional description → **Save**. Switch "Sold out". Long-press to reorder; swipe to delete.

**Orders:** list, newest first: order number, customer name, items, total, status chip (New / Paid / Ready for pickup / Shipped / Done), payment method. Detail: items, customer contact (Call · Text · Email), shipping address if any, **Mark paid** (manual rails), **Ready for pickup** or **Mark shipped** (optional tracking number → emailed to customer), **Done**, **Refund** (Stripe orders only; opens a confirm with full/partial).

**Store setup (gear):** Pickup instructions text · Shipping (on/off, flat rate, "ships within N days") · Get paid (shared screen).

### 5.4 Settings tab (existing) additions

- **Share your site** row (same Share sheet).
- **Get paid** row.
- **Plan** row: current plan, upgrade to Store, manage subscription.
- Staff (v1.1): invite link.

## 6. Services: one list for everything

The Services list is the single source for: the website's Services section and the booking page's service picker. The store sells products only; services are never prepaid through the store.

**Picker:** when adding, the barber sees a **library of ready-made services as tappable rectangles** (chips), grouped: Haircuts (Haircut, Fade, Skin fade, Taper, Buzz cut, Kids cut, Senior cut, Line up / Edge up, Hair design), Beard (Beard trim, Beard shape-up, Hot towel shave, Razor line), Combos (Haircut + beard, Cut + shave), Extras (Shampoo, Facial, Eyebrows, Hair colour, Braids, Locs retwist, Scalp treatment). Tapping a chip adds it with a default length and a blank price to fill. **"Add your own"** for anything else.

**Each service:** name · price · length (15/30/45/60/90 chips) · optional description · optional photo · **Bookable** switch (on) · **Show on website** switch (on) · which barbers offer it (all, by default) · optional per-barber price override (Advanced).

**Import:** when a site was generated from Google or Booksy, their services are pre-loaded here, so the list is not empty on first open.

**Remove:** swipe to delete. It disappears from the site on next publish and from the booking page immediately.

Same pattern for **Team**, **Hours**, **Gallery**, **About**, **Contact** (section 5.1). Hours and Team are shared with Bookings.

## 7. Customer-facing pages (hosted on aibarber.org)

URLs: `book.aibarber.org/{slug}` and `shop.aibarber.org/{slug}`. Custom domains: the static site includes `/book` and `/shop` redirect pages.

The website gets: **Book now** (header, hero, and a sticky bottom bar on phones) and **Shop** (nav) when the tier is active. Both templates (Design 1 and 2) get these.

**Existing booking links (Claude's call):** sites imported from Booksy/Square keep their current `bookingUrl` by default. Wizard step 1 offers "Switch your Book button to AI Barber bookings", with a warning that two calendars cause double-bookings. Live sites keep their link until the barber switches; switching rewrites the Book buttons on next publish.

**Web (Stripe) customers (Claude's call):** out of scope for v1. The Book now / Shop buttons and sticky bar render only when a site field set by the app (`features.bookings` / `features.store`) is present, so web customers' republishes are unchanged.

**Branding:** pages use the site's colours, logo/shop name, barber photos, address with map link, and a Call button.

### 7.1 Booking page, four steps

1. **Service:** list with price and length. (Services the shop marked not bookable are hidden.)
2. **Barber:** "Any available" (default, picks the first free) or a specific barber with photo. Skipped if the shop has one barber.
3. **Day and time:** month strip; days with no free slot are greyed. Then the free times for that day, shop-local. Slot step = service length (configurable under Advanced).
4. **Your details:** name, phone, email, optional note. Then, depending on the shop's payment setup: **Book** (pay in shop) · deposit or full payment by card/Apple Pay (Stripe) · Cash App / Venmo / Zelle / PayPal buttons with "I've sent it".

**Confirmation:** "You're booked" with date/time/barber/address, **Add to calendar** (.ics), **Get directions**, **Manage booking** link. Email confirmation with the same. Reminder email 24 h before. Manage page: reschedule (same flow) or cancel, allowed until the cutoff (default 2 h).

**Double-booking:** the server inserts the appointment inside a transaction with a per-barber time-range exclusion constraint. A conflicting insert fails and the customer is shown the next free times.

### 7.2 Shop page

Photo grid → product detail → **Add to cart** → cart → **Checkout**: name, phone, email, pickup or shipping (address if shipping; flat rate added), then payment as above. Stripe Checkout (hosted) for card/Apple Pay with shipping address collection. Manual rails: our page collects details, shows pay buttons and "I've sent it"; order is New until the barber marks it paid. Confirmation page + email; "Ready for pickup" / "Shipped" emails.

## 8. Sharing (the growth loop)

**Share sheet (ours):** opened from Bookings header, Settings, the Live screen after publish, and the empty-day state. Three big rows, each opening the native iOS share sheet (Messages, WhatsApp, AirDrop, Instagram, Mail, Copy…):
- **Booking link** — pre-written: "Book your next cut at {Shop} 💈 {book link}"
- **Website link** — "Check out {Shop}'s new website: {site link}"
- **Shop link** (Store tier) — "{Shop} now sells online: {shop link}"

Plus: **QR code** (full-screen, "Save to Photos", "Print" via AirPrint) for the counter or mirror, and a tip row "Add to your Instagram bio" that copies the link and opens Instagram.

**From an appointment:** "Text {customer}" and "Text rebook link" prefill Messages to that number.

## 9. Notifications

- **Barber push** (Expo push, server-sent): new booking, cancellation, reschedule, new order, "customer says they paid", optional 8 am daily summary ("3 bookings today"). Tapping opens the item.
- **Customer email:** booking confirmation, 24 h reminder, cancellation/reschedule, order confirmation, ready/shipped. Sender support@davoxa.com (Google Workspace, ~2,000/day); move to Resend when volume needs it.
- Existing local publish reminders stay as they are.

## 10. Getting paid

One screen, "How do you want to get paid?", three cards, any mix:
1. **In the shop** (default). No setup.
2. **Cash App / Venmo / Zelle / PayPal:** enter handle(s). Customer buttons deep-link with the amount where supported (Cash App `cash.app/$tag/amount`, Venmo, PayPal.me); Zelle shows the number with Copy. Orders/bookings carry "Awaiting confirmation" until the barber taps Mark paid.
3. **Card payments (Stripe):** "Takes about 5 minutes. Customers pay by card or Apple Pay; money goes to your bank automatically. AI Barber keeps {fee}% per payment." Opens Stripe-hosted onboarding for a **Standard** connected account, pre-filled with shop name, phone, address, URL. Direct charges on the connected account with `application_fee_amount`. Deposits per service (none / fixed / percent) under Advanced. Refunds from the order/appointment detail.

Platform fee: **2%** of each Stripe payment (Ibrahim, 2026-10-21), shown on the setup screen.

**Money rules on cancellation (Claude's call, Ibrahim may override):**
- Customer cancels before the cutoff → automatic full refund (deposit or full payment).
- Customer cancels after the cutoff, or no-shows → barber keeps the deposit; a manual Refund button remains.
- Barber cancels or reschedules → automatic full refund.
- Every refund also refunds the platform fee proportionally (`refund_application_fee: true`).
- Manual rails: no automatic money movement; the status is informational only.

## 11. Plans and entitlements (Ibrahim, 2026-10-21)

Three tiers, all in the App Store subscription group "AI Barber Hosting" (22497224) so upgrades/downgrades are Apple-native with proration:

| Plan | Monthly | Yearly (20% off) | Entitlements |
|---|---|---|---|
| **Website** | $19.99 (existing products) | $191.99 | `hosting` |
| **Bookings** | $24.99 | $239.99 | `hosting` + `bookings` |
| **Store** | $39.99 | $383.99 | `hosting` + `bookings` + `store` |

- New ASC products: `com.ibrahim1774.aibarber.bookings.monthly/.yearly`, `com.ibrahim1774.aibarber.store.monthly/.yearly`, group levels Website 3 < Bookings 2 < Store 1.
- Superwall: entitlements `bookings` and `store`; placements `bookings_upgrade` (Bookings tab when `bookings` inactive) and `store_upgrade` (Store tab when `store` inactive). The `publish` paywall keeps showing only the Website plan. No monthly-equivalent of yearly prices anywhere.
- RevenueCat: same products and entitlements mirrored.
- Lapse: `hosting` lapsed → site offline + "Bookings paused" page + 30-day read-only calendar; `bookings` lapsed (downgrade to Website) → booking page paused, calendar read-only, Book buttons removed on next publish; `store` lapsed → shop page offline, orders remain visible.

## 12. Data model (Supabase, RLS by shop membership)

- `shops` (1:1 with `sites`): slug, timezone, currency, payment settings (modes enabled, handles), booking rules (lead days 30, min notice 2 h, buffer 0, cancel cutoff 2 h, slot step), stripe_account_id, store_enabled, shipping settings.
- `shop_members`: shop_id, user_id, role (owner/barber), display_name, photo_url, bio, sort.
- `services`: shop_id, name, price_cents, duration_min, description, photo_url, bookable, show_on_site, sort.
- `service_barbers`: service_id, member_id, price_override_cents.
- `availability`: member_id, weekday, start, end, break_start, break_end.
- `time_off`: member_id, start_at, end_at, reason.
- `appointments`: shop_id, member_id, service_id, start_at, end_at (tstzrange with an exclusion constraint per member), customer name/phone/email/note, status (booked/done/no_show/cancelled), payment (none/awaiting/deposit/paid/refunded, method, stripe ids), manage_token.
- `products`: shop_id, name, price_cents, description, photos[], sold_out, sort.
- `orders`, `order_items`: customer, fulfilment (pickup/shipping + address), status, payment fields, tracking, stripe ids.
- `push_tokens`: user_id, expo token, platform.
- `shop_events` (audit/notification log).

## 13. API (Vercel functions, aibarber.org)

Public (rate-limited, no auth): services/barbers/availability for a slug; create appointment; manage appointment by token; create order; "I've sent it"; Stripe Checkout session creation; Stripe webhooks; .ics feeds by token.
Owner/barber (Supabase JWT): everything else. Direct Supabase access with RLS where it's simple; functions where it needs server logic (slot calculation, Stripe, email, push).

## 14. Edge cases the builder must handle

- Time zones and DST: all times stored UTC; slot math in the shop's IANA timezone; tests across a DST change.
- Blocking time over existing bookings: show the conflicts; offer "keep them" or "cancel and email".
- Barber deleted/removed: future bookings reassigned to owner or cancelled with email; the barber chooses.
- Service deleted with future bookings: bookings keep a snapshot of name/price.
- Customer books twice by accident: duplicate (same phone, same slot) is rejected with a friendly message.
- Manual-rail payment claimed but never confirmed: no automatic action; the barber decides.
- Stripe webhook retries and ordering: idempotent by event id.
- Lapsed `hosting`: booking page paused; existing manage links still allow cancel.

## 15. Phasing

1. **Payments setup + Services/Sections editors** (also improves the existing product on its own).
2. **Bookings:** engine, booking page, Bookings tab, pushes, emails, share sheet, QR.
3. **Store:** products, shop page, orders, Stripe Checkout, shipping.
4. **Plans:** Store tier IAP, Superwall paywall, entitlements, lapse rules; review notes; production build.
5. **v1.1:** staff sign-in by invite link.

Each phase ships on its own.

## 16. Decisions (Ibrahim, 2026-10-21)

1. Three plans: Website $19.99, Bookings $24.99, Store $39.99 (see §11).
2. Platform fee 2%.
3. Stripe Connect to be enabled in Ibrahim's Stripe dashboard by Claude (Ibrahim logs in).
4. Open: OK to start with owner-managed staff calendars and ship staff sign-in in the first update? (Assumed yes unless objected.)

## 17. Builder's calls (made by Claude, changeable)

- Hosted booking/shop pages on aibarber.org subdomains, linked from the site, rather than embedded engines.
- Email required at booking (needed for the manage link); phone required (barber needs to call).
- Slot step equals service length by default.
- Stripe Standard accounts with direct charges (no Connect fees to the platform).
- "Any available" picks the first free barber in list order.
- Store tab hidden behind an upgrade card when the tier is inactive.
