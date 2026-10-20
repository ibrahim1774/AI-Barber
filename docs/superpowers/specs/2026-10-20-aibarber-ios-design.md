# AI Barber iOS — design

Date: 2026-10-20. Status: draft for Ibrahim's approval. Planned with Fable 5.1; execution intended for Opus.

## Intent

A native iPhone app that does what the aibarber.org homepage does: a barber imports or types their shop details, gets a finished website in seconds, tweaks it, pays, and the site goes live. Same functionality, same look, same backend. The point is a second distribution channel (App Store + Meta app-install ads measured through AppsFlyer) for an offer that already converts on the web.

## Goals

- Replicate the **homepage flow only** of aibarber.org (the bare `/` route): import → generate → edit → pay → publish → dashboard.
- One subscription through Apple in-app purchase, shown with Superwall:
  - Website hosting: **$19.99/month** or **$191.99/year** (20% off, rounded to Apple's .99 tier).
  - **One subscription = one site.** The subscription is bound to the first site it publishes; the dashboard edits and republishes that site. No "create new site" in v1.
- Same Supabase project and same `/api` backend as the web app. Web and iOS customers live in the same tables.
- Same tracking stack and setup pattern as Ibrahim's other apps: App Store Connect, Superwall, AppsFlyer → Meta, PostHog, EAS builds.
- Separate GitHub repo: `ibrahim1774/aibarber-ios`, cloned at `~/aibarber-ios` (no spaces or parentheses in the path — jest-expo cannot handle them).

## Non-goals

- Domain purchase (`create-domain-checkout`, `purchase-domain`, DomainManager). Left out entirely.
- **Custom website design upsell** (`custom-home`, PrePaymentBanner's "Don't like this?" offer, the Google Form hand-off). Removed from the app for now (Ibrahim, 2026-10-20). It also avoids Apple guideline 3.1.3(e) questions about a human-delivered service sold by IAP.
- Multiple sites per account.
- Existing web customers signing in and seeing their web sites. Not blocked — same Supabase — but not designed for or tested now.
- Price-test funnels (`/home-2`, `/20`, `/15`, `/9`, `/7`), `/booksy`, `/free-barber`, `/custom-design*`, `/primebarber`, `/generate`, `/barber-generate`, admin pages, recovery pages, client portal, tracking page.
- Android.
- PrimeHub (separate project, later).

## Anti-goals (would make this a failure)

- A thin WebView wrapper around aibarber.org. Apple rejects these (guideline 4.2) and it would not count as a native app.
- Stripe anywhere in the app. Subscriptions must be Apple IAP (guideline 3.1.1).
- Double-counted purchases in Meta (Superwall → Meta and AppsFlyer → Meta both on, or server CAPI firing for iOS purchases).
- A paid site that never publishes. The web history has several "site did not publish after payment" fixes; the iOS publish path must be idempotent and have a server-side safety net.
- Secret keys (Gemini, Apify, GCS, Vercel token, Supabase service role) in the app bundle.

## Constraints

- Expo SDK 55 (not 57), Expo Router, Superwall, AppsFlyer, PostHog — same as Crew Lens and CostCook. Local build gotchas in memory `costcook-build-gotchas` apply (UTF-8 env, RN from source, Release builds of SuperwallKit crash swift-frontend → use Debug locally / EAS for store builds).
- Native builds need ~6 GB free disk; the Mac was at 200 MB today. Check `df -h` before every build.
- TestFlight on Ibrahim's iPhone is broken (404s since 2026-10-06); device testing uses an ad hoc build over USB (memory `testflight-phone-workaround`).
- The web repo's local clone `~/AI-Barber` is 29 commits behind origin; backend work must branch from `origin/main`.
- Backend changes go into the **AI-Barber web repo** (`/api`), since they run on the existing Vercel project `prime-barber-ai` and need its env vars (GCS, Vercel token, Supabase service role).

## What the web app actually does (verified in origin/main @ 1c74415)

These facts drive the design. File references are to the AI-Barber repo.

1. **"AI generation" is not AI.** `services/geminiService.ts:157-210` builds `WebsiteData` from fixed copy and stock image URLs with a fake 250 ms delay. `api/gemini.ts` exists but has no callers. The iOS app can build `WebsiteData` the same way, client-side, with no API call.
2. **Import paths.** Booking-link scrape: `POST /api/import-scrape` (dispatches to `lib/scrapers/*`, needs `APIFY_TOKEN`) then `lib/buildSiteFromScrape.ts`. Google listing: `/api/find-business` → `/api/import-business` (not read in detail; they exist on origin/main only). Manual: name-only form.
3. **Three templates**, chosen by `WebsiteData.template`: `prime` → PrimeWebsite, `euphoria` → EuphoriaWebsite, otherwise GeneratedWebsite ("luxe"). The homepage Design 1 / Design 2 switcher toggles luxe ↔ prime. Euphoria is not reachable from the homepage flow.
4. **Rendering.** `lib/render/{luxe,prime,euphoria}.ts` export pure functions `WebsiteData → HTML string` with `{{image placeholders}}`. They already run both in the browser (`services/templateRenderer.ts`) and on the server (`lib/publishSite.ts:135-139`). Not yet verified: whether they are free of DOM globals (needed only if we bundle them into the app rather than call a server endpoint).
5. **Images.** Editors hold photos as base64 data URLs; at checkout `preparePendingSite` uploads each via `POST /api/upload-image` to GCS. `api/get-upload-urls.ts` returns 15-minute signed PUT URLs and has no callers today — the better fit for native uploads.
6. **Checkout → live site.**
   - `preparePendingSite` (GeneratedWebsite.tsx:334-464, same shape in Prime/Euphoria) uploads images, then `POST /api/save-pending-site` writes `{siteId, existingSiteId, siteData, imageUrlMap}` to GCS `pending-sites/{siteId}.json`. **`siteId` is the shop-name slug**, not a UUID, and becomes the Vercel project name.
   - Stripe webhook `checkout.session.completed` → waits 90 s → `publishSite(metadata.siteId)` (`lib/publishSite.ts:145`). `publishSite` needs **only the slug**; it is idempotent (`alreadyLive` checks a `published-at` marker) and returns `no-backup` if the pending file is missing.
   - Browser return path also renders HTML and posts to `/api/deploy-site` (belt and braces).
   - `api/publish-sweeper.ts` (cron every 10 min) re-publishes any paid **Stripe** session from the last 48 h. It knows nothing about Apple.
7. **Paid status is not in Supabase.** `users_profile.stripe_customer_id` / `subscription_status` exist but nothing writes them. `sites.deployment_status` / `deployed_url` are written from the client. Cancellation does not unpublish anything.
8. **Auth.** Supabase email + password only (`contexts/AuthContext.tsx`). Sign-up is **offered after a successful deploy**, email pre-filled and locked; it is not required to pay or publish. `users_profile` row is created by DB trigger `handle_new_user`. Sign in with Apple is therefore not required by Apple (only mandatory when third-party social login is offered).
9. **Tracking.** Server fires Meta CAPI (and TikTok) for ViewContent, Lead, InitiateCheckout, Purchase, CompleteRegistration, triggered from the browser via `/api/fb-*` and from the Stripe webhook (Purchase, `event_id = session.id` for dedup).
10. **Custom-design upsell.** PrePaymentBanner offers `custom-home` ($20/mo today). It is a Stripe subscription with `siteId: 'custom-design-request'`; nothing is deployed; on return the browser sends the user to Google Form `https://docs.google.com/forms/d/e/1FAIpQLSdS2iaBt6ee0AGWv7pQPSLHoicovQuTOKLFktuiEG4tobBIPw/viewform`.
11. **Security.** `deploy-site`, `upload-image`, `save-pending-site`, `verify-stripe-session` have no auth and `CORS: *`. Out of scope to fix, but the new iOS endpoints must not inherit this for anything that publishes or deletes.

## Decisions (Ibrahim's)

- aibarber first; PrimeHub later as its own project.
- Homepage flow only.
- Hosting $19.99/mo, yearly at 20% off. Custom design removed for now.
- One site per subscription.
- Domains left out.
- Backend release: the agent tests on a Vercel preview deployment with Apple's sandbox, then merges to `AI-Barber` main and applies the Supabase migration itself.
- Same Supabase; ignore existing web customers for now.
- Separate GitHub repo.
- Ibrahim logs into ASC, Superwall, AppsFlyer, Meta, Expo, GitHub, PostHog so the agent can do dashboard setup itself.

## Decisions (mine — check these)

- **App name / bundle:** "AI Barber", `com.ibrahim1774.aibarber`. (Pattern of the other apps.)
- **Yearly price $191.99**, the nearest Apple tier to 20% off ($191.90).
- **One subscription group** "AI Barber Hosting" with two products, monthly and yearly, same level. One Superwall entitlement: `hosting`.
- **No free trial** (web has none).
- **Editing a live site is in scope.** The web lets a barber reopen the editor and republish (by paying again). Here republishing is free for the bound site: `/api/ios/publish` has a redeploy mode that bypasses `publishSite`'s `alreadyLive` short-circuit when the verified transaction's `original_transaction_id` is already bound to that slug.
- **`/api/ios/publish` takes the site content directly** — `{ siteId, siteData, imageUrlMap, signedTransaction }` — verifies the Apple signature first, then writes `pending-sites/{slug}.json` itself and publishes. The app never calls the unauthenticated `save-pending-site`, so nobody can overwrite a paid iOS site's content without a valid transaction for that slug. (Builder check finding.)
- **Slug binding:** the first verified publish binds `original_transaction_id → site_slug` in `ios_purchases`. A later publish with the same transaction but a different slug is rejected (one site per subscription). Restore Purchases looks the slug up by `original_transaction_id` and repopulates the dashboard.
- **Sandbox testing publishes real sites.** Sandbox-environment transactions publish normally (end-to-end test) but the app prefixes test slugs with `ios-test-`; the builder deletes those Vercel projects after testing.
- **Sign-up order follows the web:** optional, offered after publish, not before payment. Sites are stored on device (SQLite/AsyncStorage) like the web's IndexedDB and synced to Supabase `sites` once signed in.
- **Preview rendering via a new server endpoint** `POST /api/ios/render-preview` (wraps the existing `renderSite`) rather than bundling the renderers into the app. Keeps one template source; costs one network round trip per re-render. Builder may switch to bundling if the renderers prove DOM-free and the round trip hurts editing.
- **Editing UX:** the generated site is shown in a WebView; tapping a text/colour/photo region sends a bridge message and a native bottom sheet edits it; the WebView re-renders. This is the "same UI" promise without a WebView-wrapper app: all chrome, forms, prompts, paywall, dashboard are native.
- **Image upload** through `get-upload-urls` signed PUTs from the native image picker (resized ≤ 2048 px), instead of base64 through `upload-image`.
- **Publish trigger (the critical path):**
  1. The app uploads images via signed PUT URLs, then shows Superwall placement `publish` → user buys hosting (or already has the `hosting` entitlement → skip straight to step 2).
  2. App calls new `POST /api/ios/publish` with `{ siteId, siteData, imageUrlMap, signedTransaction }` where `signedTransaction` is the StoreKit 2 JWS. Server verifies it with Apple's App Store Server Library (bundle id, product ids, environment), upserts the new Supabase table `ios_purchases (original_transaction_id pk, product_id, site_slug, user_id nullable, environment, verified_at, published_at, site_data_hash)`, writes the pending file, calls `publishSite(siteId)` (redeploy mode if already bound to this slug) and returns `deployedUrl`.
  3. Safety net: **App Store Server Notifications V2** → new `POST /api/ios/apple-notification` upserts `ios_purchases` from every notification (also records expirations for future use; nothing is unpublished, matching the web). `publish-sweeper` gains a second branch: any `ios_purchases` row with a `site_slug` and no `published_at` → `publishSite`.
  4. The app persists "pending publish" (site content + transaction) locally and retries `/api/ios/publish` on next launch until it gets a URL. All paths are idempotent.
- **Tracking rules:**
  - App events go through AppsFlyer (and PostHog), never through `/api/fb-*` or `/api/tiktok-event`. The server's Meta CAPI Purchase in the Stripe webhook does not fire for Apple purchases because they never touch Stripe. AppsFlyer → Meta carries installs, `af_start_trial`/`af_purchase`, `af_initiated_checkout`, `af_complete_registration`.
  - Superwall → Meta integration stays **off** (double counting).
  - From day one: `SKAdNetworkItems` in app.json, ATT prompt before AppsFlyer starts, AppsFlyer started at launch (not after onboarding), `Superwall.setIntegrationAttributes({ appsflyerId })`, SKAN schema set once AppsFlyer has received the events.
- **Account deletion** (Apple 5.1.1(v)): new `POST /api/ios/delete-account`, authenticated with the user's Supabase JWT, deletes `sites` rows and the auth user via service role. Published sites are not taken down (matches web: cancellation never unpublishes).
- **New endpoints are authenticated**: `/api/ios/publish` by Apple signature verification; `/api/ios/delete-account` by Supabase JWT; `/api/ios/apple-notification` by Apple's JWS signature. `render-preview` is public read-only, rate-limit-free like the existing render path.

## Screens (native, matching the web's dark #0d0d0d / amber #f4a100 look)

1. **Start** — "Do you have a booking link?" Yes → paste link (supported hosts list from `lib/supportedBookingHost.ts`); No → search Google listing (Places autocomplete via `/api/places-autocomplete` → `find-business` → `import-business`); "Fill in manually" → shop name only. "Sign in" link top-right.
2. **Loading** — same staged messages as `LoadingScreen`.
3. **Editor** — WebView preview + floating Design 1 / Design 2 switcher + edit toolbar (text, colours from `lib/brandSwatches.ts`, photos) + "Publish" button. Sequential overlays exactly as the web: HomeBookingPrompts (area, phone, booking link), then HomeLaunchGuide ("how it works"), then the pre-payment banner **without** the custom-design offer.
4. **Paywall** — Superwall placement `publish` (hosting monthly / yearly).
5. **Publishing / Success** — progress, then the live URL with copy/open/share; then the optional sign-up sheet (email locked) as the web does.
6. **Dashboard** — the one site (local, and in Supabase when signed in): edit → republish, open live URL, sign out, delete account, manage subscription (deep link to Apple's subscription settings), restore purchases. A user without a site is sent to Start.
7. **Auth** — sign in / sign up / password reset (Supabase).

## Dashboard setup checklist (agent does these; Ibrahim keeps sessions logged in)

- App Store Connect: app record, bundle id, subscription group + 2 products with localized names, App Store Server Notifications V2 URL, sandbox tester, review notes (demo account not needed — no login before publish).
- Superwall: new app, 2 products mapped to ASC, `hosting` entitlement, one paywall on placement `publish`, AppsFlyer integration (check it does not also send purchase events twice), Meta integration left off.
- AppsFlyer: new iOS app (bundle id), Meta partner integration with the new Meta app id, `af_complete_registration` event, SKAN subscription template later.
- Meta for Developers: new app under portfolio 411319692678287, iOS platform with bundle id; Store ID only after launch.
- PostHog: new project (needs the `phc_` project key, not a personal key).
- EAS: `eas init`, build profiles `development`, `adhoc`, `production` (copy of Crew Lens's eas.json), credentials with the shared ASC key.
- Vercel (existing `prime-barber-ai`): new env vars `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_BUNDLE_ID`; Supabase migration for `ios_purchases`.
- GitHub: `aibarber-ios` repo; backend PR against `ibrahim1774/AI-Barber`.

## Left to the builder

- Exact RN component structure, navigation, state management.
- Whether to bundle the HTML renderers or call `render-preview` (see decision above).
- Which import endpoints' request/response shapes need adapting — `find-business`, `import-business`, `import-scrape` were not read in detail; the builder reads them from origin/main.
- Test strategy (Jest for data shaping + publish-flow logic; Maestro for the happy path; StoreKit configuration file for local purchase testing).
- Order of work. Suggested: (1) backend endpoints + migration + sweeper branch, tested with Apple sandbox JWS; (2) app skeleton + import + generate + preview; (3) editor; (4) Superwall + publish; (5) dashboard/auth/delete; (6) tracking; (7) dashboards + store listing.

## Certainty ledger (what Fable is 100% sure of vs. not)

**Sure (read in code or in Ibrahim's confirmed decisions):** the homepage flow and its overlays; three templates and the luxe/prime switcher; generation is fixed copy, no Gemini call; `publishSite(slug)` is the single publish function and only needs the slug plus the pending-site file; `siteId` is the shop slug; Stripe webhook + 90 s grace + 10-min sweeper are the web's publish safety nets; sign-up is optional and comes after deploy; auth is email/password only; paid status is not stored in Supabase; cancellation never unpublishes; custom-design purchase deploys nothing and redirects to the Google Form; the Meta/TikTok event list and event_id strategy; the env var list; the unauthenticated endpoints; the stack and build constraints from the other apps.

**Not yet verified (builder must confirm before relying on it):** renderers are DOM-free; `find-business` / `import-business` / `import-scrape` request shapes; whether Superwall's RN SDK exposes the StoreKit 2 JWS (if not, fall back to `expo-iap`/`react-native-iap` `getReceiptData` + App Store Server API `getTransactionInfo`, or to Superwall's purchase webhook); whether Superwall → AppsFlyer sends purchase events that would double with client events; Apple tier $191.99 is available in the US storefront (standard .99 tier, but confirm in ASC).

## Findings during planning (2026-10-20, Opus) — these override earlier sections where they conflict

- **Purchase proof is the transaction id, not a JWS.** `expo-superwall` 1.5 returns only `{type:'purchased'}` from purchases; transaction ids come from `getCustomerInfo().subscriptions[].transactionId` and from `transaction_complete` events (`storeTransaction.originalTransactionIdentifier`). The app sends `transactionId`; the server calls the App Store Server API `GET /inApps/v1/transactions/{id}` with the In-App Purchase key `SubscriptionKey_6W4KWKD3WN.p8` (issuer `8e2cad29-fcba-4f15-baf7-23b9cbcd6c24`), verifies the returned signed transaction with `@apple/app-store-server-library`, and checks bundle id, product id, revocation and expiry. Production first; on 401/404 retry sandbox (production answers 401 for a bundle that is not live yet — observed with Crew Lens). Test call against sandbox succeeded (404 "Transaction id not found" = auth OK).
- **The server chooses the slug.** `deployToVercel` names the Vercel project after the slug and `publishSite`'s `alreadyLive` treats any of our pages at `{slug}.vercel.app` as done, so an iOS shop sharing a web customer's name would otherwise be shown — or overwrite — the web customer's site. First publish: server slugifies `shopName`, and if `pending-sites/{slug}.json` exists, an `ios_purchases` row has it, or `https://{slug}.vercel.app` answers 2xx, appends `-` + 4 random base36 chars (retry up to 5). Sandbox transactions get the `ios-test-` prefix, decided by the verified environment, never by the app. Later publishes always reuse the slug bound to the `original_transaction_id`; the app never sends a slug.
- **Images:** the app uploads each picked photo immediately via `/api/get-upload-urls` under folder `ios-drafts/{draftId}` and keeps the public GCS URL in `WebsiteData`. `deployRenderedSite` accepts any URL in `imageUrls`. `/api/ios/publish` rejects bodies containing `data:` URLs (Vercel body limit ~4.5 MB) and builds `imageUrlMap` itself from every `http(s)` image slot (`hero`, `about`, `gallery{i}`, `craft{i}`, `staff{i}`), exactly like `preparePendingSite` in GeneratedWebsite.tsx:334-420.
- **Preview rendering is bundled, not a server endpoint.** `lib/render/{luxe,prime,euphoria}.ts` import only `types.ts` and are DOM-free (luxe's 3 `window/document` references are inside the emitted `<script>`). Same for `services/geminiService.ts` (`generateContent`), `lib/buildSiteFromScrape.ts`, `lib/booksyNiche.ts`, `lib/brandSwatches.ts`, `lib/supportedBookingHost.ts`. These are vendored byte-for-byte into `src/web/` by `scripts/sync-web.sh`, which records the source commit. `/api/ios/render-preview` is dropped.
- **Editing.** The web editor is a React re-implementation with inline `contentEditable` (`EditableText`) on: shopName, hero.heading, hero.tagline, about.heading, about.description, services[i].title/subtitle/description, phone, area, contact.address, bookingUrl; image replace on hero, about, gallery, craftImages, staff photos; colour swatches (`BRAND_SWATCHES`). The app renders the real template HTML in a WebView with every editable string wrapped in invisible markers, so an injected script can tag and make those elements tappable, plus a native "All fields" sheet covering every field (the fallback for anything a template transforms).
- **Supabase:** aibarber.org uses the Supabase project named **PrimeHub**, ref `lyjruphvzfwbtzfwfvwm` (eu-west-1); the MCP can read it.
- **Builds:** native builds run on EAS cloud (`development-simulator`, `adhoc`, `production`), not locally — the Mac has ~4 GB free.
