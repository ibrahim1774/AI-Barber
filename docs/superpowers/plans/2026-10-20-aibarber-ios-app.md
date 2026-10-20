# AI Barber iOS app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A native Expo iPhone app that reproduces the aibarber.org homepage flow (import → generate → edit → Superwall paywall → publish → dashboard) against the existing aibarber.org backend and Supabase, with the same tracking stack as Ibrahim's other apps.

**Architecture:** Expo Router screens with native chrome. The site itself is the real web template HTML (vendored byte-for-byte from the web repo) rendered in a `react-native-webview`, made tappable by invisible field markers plus an injected script; every field is also editable from a native "All fields" sheet. Business logic lives in small `src/lib/*` modules with injected dependencies so Jest can test them. Payments: Superwall paywall → transaction id from `getCustomerInfo()` → backend `/api/ios/publish` (backend plan).

**Tech Stack:** Expo SDK 55 (`expo ~55.0.31`, `react-native 0.83.10`, `expo-router ~55.0.18`), `expo-superwall ^1.5.0`, `react-native-appsflyer ^7.0.2-v2`, `posthog-react-native ^4.81.2`, `@supabase/supabase-js ^2`, `react-native-webview 13.16.0`, `expo-image-picker`, `expo-image-manipulator`, `expo-sqlite` (kv-store), `expo-tracking-transparency`, `expo-web-browser`, Jest (`jest-expo ~55`). Versions copied from `/Users/ibrahim/CrewLens/crewlens/package.json`.

**Spec:** `docs/superpowers/specs/2026-10-20-aibarber-ios-design.md` (read "Findings during planning"). Backend counterpart: `docs/superpowers/plans/2026-10-20-backend-ios-publish.md` — its Tasks 1–8 must be merged before this plan's Task 8 talks to production; Tasks 1–7 here need nothing from it.

## Global Constraints

- Repo `ibrahim1774/aibarber-ios` at `/Users/ibrahim/aibarber-ios`. Bundle id `com.ibrahim1774.aibarber`, app name "AI Barber", scheme `aibarber`, Apple team `Q5U5W6788K`, iPhone only, portrait, deployment target 16.4, `userInterfaceStyle: "dark"`.
- Products: `com.ibrahim1774.aibarber.hosting.monthly` $19.99/mo, `com.ibrahim1774.aibarber.hosting.yearly` $191.99/yr, one subscription group "AI Barber Hosting", no trial, Superwall entitlement `hosting`, placement `publish`.
- API base `EXPO_PUBLIC_API_BASE`, default `https://www.aibarber.org`. Supabase `https://lyjruphvzfwbtzfwfvwm.supabase.co` with the public anon key the web bundle ships (`EXPO_PUBLIC_SUPABASE_ANON_KEY`).
- Look: web colours — background `#0d0d0d` (importer `#070709`), accent `#f4a100`, text white/cream; fonts Montserrat (headings, via `@expo-google-fonts/montserrat`) and Manrope (body). Copy text in importer, prompts, launch guide and pre-payment banner is copied from the web components named in each task, minus anything about price tests, domains or the custom-design upsell.
- No Stripe, no calls to `/api/fb-*`, `/api/tiktok-event`, `/api/save-pending-site`, `/api/upload-image`, `/api/deploy-site` from the app.
- No secrets in the app: only `EXPO_PUBLIC_*` public keys (Superwall public key, AppsFlyer dev key, PostHog `phc_` key, Supabase anon key).
- Native builds on EAS cloud only (`development-simulator`, `adhoc`, `production`); locally only Metro (port 8083) and Jest. Before any `npm install`, check `df -h /` ≥ 1.5 GB.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- App killed or offline right after paying → on next launch the pending publish is retried and the barber lands on their live site, not the paywall. (Task 8 test `retries a pending publish on launch`.)
- Barber already subscribed (reinstall / new phone) taps Publish → paywall is skipped, Restore finds the site via `/api/ios/site`, dashboard shows it. (Task 8 test `skips paywall when entitled`, Task 9 test `restore loads the bound site`.)
- A template transforms a field so its marker can't be found (e.g. split or uppercased in JS) → that field is still editable from "All fields", and no stray marker characters reach the published payload. (Task 5 tests `every editable path is reachable` and `stripMarkers leaves no U+2063`.)
- Photo picked from a 12 MP HEIC → uploaded as a ≤2048 px JPEG; publish body never contains `data:` URLs. (Task 4 test `uploadPhoto resizes and returns the public URL`, Task 8 test `publish payload has no data URLs`.)
- Booking link from an unsupported host or a failed scrape → the same friendly error the web shows, with "Fill in manually" offered. (Task 3 test `unsupported host is rejected before calling the API`.)

---

### Task 1: Scaffold, config, vendored web modules

**Files:**
- Create: `package.json`, `app.json`, `eas.json`, `tsconfig.json`, `jest.config.js`, `metro.config.js`, `eslint.config.js`, `.gitignore` (`node_modules`, `.env.local`, `*.p8`, `ios/`, `.expo/`), `.env.local` (gitignored; keys filled in Task 11), `src/app/_layout.tsx`, `src/app/index.tsx` (placeholder)
- Create: `scripts/sync-web.sh`, `src/web/` (vendored), `src/web/SOURCE`
- Test: `__tests__/web.test.ts`

**Interfaces:**
- Produces (from vendored files, unchanged): `src/web/types.ts` (`WebsiteData`, `ShopInputs`, `TemplateId`), `src/web/services/geminiService.ts` (`generateContent(inputs: ShopInputs): Promise<WebsiteData>`), `src/web/lib/render/{luxe,prime,euphoria}.ts`, `src/web/lib/buildSiteFromScrape.ts`, `src/web/lib/booksyNiche.ts`, `src/web/lib/brandSwatches.ts`, `src/web/lib/supportedBookingHost.ts`.
- Produces: `src/lib/render.ts` — `renderSite(data: WebsiteData): string` (same template switch as `lib/publishSite.ts` `renderSite`) and `withImages(html: string, data: WebsiteData): string` (fills `{{hero}}`, `{{about}}`, `{{gallery{i}}}`, `{{craft{i}}}`, `{{staff{i}}}` placeholders from the data's own URLs, for preview).

- [ ] **Step 1:** Create `package.json` with Crew Lens's versions for: expo, expo-router, expo-constants, expo-linking, expo-status-bar, expo-splash-screen, expo-font, expo-image, expo-sqlite, expo-secure-store, expo-web-browser, expo-tracking-transparency, expo-build-properties, expo-dev-client, expo-application, expo-crypto, expo-haptics, expo-clipboard, expo-image-manipulator, expo-superwall, posthog-react-native, react, react-dom, react-native, react-native-appsflyer, react-native-gesture-handler, react-native-reanimated, react-native-worklets, react-native-safe-area-context, react-native-screens, react-native-svg, react-native-url-polyfill, react-native-webview, @supabase/supabase-js, @react-navigation/native; plus `npx expo install expo-image-picker @expo-google-fonts/montserrat @expo-google-fonts/manrope`. Dev: jest, jest-expo, typescript, @types/jest, eslint, eslint-config-expo. Scripts as Crew Lens (`test`, `typecheck`, `lint`). `npm install`.
- [ ] **Step 2:** `app.json` per Global Constraints, modelled on Crew Lens's (`ITSAppUsesNonExemptEncryption: false`, `NSAdvertisingAttributionReportEndpoint: "https://appsflyer-skadnetwork.com/"`, plugins: expo-router, expo-font, expo-sqlite, expo-secure-store, expo-web-browser, expo-image-picker with `photosPermission: "AI Barber uses your photos so you can put your own shop and haircuts on your website."`, expo-tracking-transparency with `userTrackingPermission: "AI Barber uses this to understand which ads bring barbers to the app."`, expo-build-properties (16.4), react-native-appsflyer, splash `#0d0d0d`). Add `ios.infoPlist.SKAdNetworkItems` with AppsFlyer's and Meta's published SKAdNetwork ids (fetch the current lists from AppsFlyer's and Meta's docs; at minimum `v9wttpbfk9.skadnetwork` and `n38lu8286q.skadnetwork` for Meta). `eas.json` = Crew Lens's profiles plus `adhoc` (extends production, `distribution: "internal"`); leave `ascAppId` blank until Task 11. `eas init` (creates the EAS project, writes `extra.eas.projectId`).
- [ ] **Step 3:** `scripts/sync-web.sh`: `git -C ~/AI-Barber fetch origin`, copy the files listed above from `origin/main` (via `git show origin/main:<path>`) into `src/web/<same path>`, rewrite `.ts"`/`'.ts'` import suffixes and `../types.ts` paths only as needed for Metro, write `src/web/SOURCE` with the commit sha and date. Run it.
- [ ] **Step 4: Write failing test** `__tests__/web.test.ts`:
  - `generateContent builds a site for a shop name` — `generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' })` → `shopName === 'Fresh Cuts'`, `services.length > 0`.
  - `renderSite renders luxe and prime` — both outputs contain `Fresh Cuts` and `name="published-at"`.
  - `withImages leaves no placeholders when every slot has a URL`.
- [ ] **Step 5:** Run `npx jest __tests__/web.test.ts` → FAIL; implement `src/lib/render.ts`; run → PASS. `npx tsc --noEmit` clean.
- [ ] **Step 6:** Commit `Scaffold AI Barber iOS (Expo 55) with vendored web templates`; push.

### Task 2: Local site store

**Files:**
- Create: `src/lib/siteStore.ts`, `test/mocks/kv.ts`
- Test: `__tests__/siteStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SiteRecord {
    draftId: string; inputs: ShopInputs; data: WebsiteData; updatedAt: number;
    slug: string | null; deployedUrl: string | null; transactionId: string | null;
  }
  export interface PendingPublish { transactionId: string; data: WebsiteData; createdAt: number }
  export function loadSite(): Promise<SiteRecord | null>;      // one site per install (one site per subscription)
  export function saveSite(r: SiteRecord): Promise<void>;
  export function clearSite(): Promise<void>;
  export function loadPendingPublish(): Promise<PendingPublish | null>;
  export function savePendingPublish(p: PendingPublish | null): Promise<void>;
  ```
  Backed by `expo-sqlite/kv-store` (`Storage`), keys `site.v1`, `pendingPublish.v1`.

- [ ] **Step 1: Failing tests:** `round-trips a site`; `pending publish set and cleared`; `corrupt JSON loads as null`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (+ jest moduleNameMapper for `expo-sqlite/kv-store` → mock). **Step 4:** PASS. **Step 5:** Commit.

### Task 3: API client and importer logic

**Files:**
- Create: `src/lib/api.ts`, `src/lib/importer.ts`
- Test: `__tests__/api.test.ts`, `__tests__/importer.test.ts`, fixtures `__tests__/fixtures/scrape-booksy.json`, `__tests__/fixtures/import-business.json` (capture real responses once from production with `curl -X POST https://www.aibarber.org/api/import-scrape -d '{"url":"<a public Booksy shop>"}'` and the find/import-business pair)

**Interfaces:**
- Produces:
  ```ts
  export class ApiError extends Error { constructor(public status: number, public code: string, message: string) }
  export const api: {
    importScrape(url: string): Promise<ScrapePayload>;                       // POST /api/import-scrape {url}
    placesAutocomplete(input: string): Promise<{ suggestions: unknown[]; error?: string }>;
    findBusiness(query: string, near?: string): Promise<{ candidates: Candidate[]; searchedNear: string | null }>;
    importBusiness(url: string): Promise<ScrapePayload>;                    // POST /api/import-business {url}
    getUploadUrls(folder: string, filenames: string[]): Promise<{ filename: string; signedUrl: string; publicUrl: string }[]>;
    iosPublish(body: { transactionId: string; siteData: WebsiteData; userId?: string | null }): Promise<{ siteId: string; deployedUrl: string; republished: boolean }>;
    iosSite(transactionId: string): Promise<{ siteId: string; deployedUrl: string | null; siteData: WebsiteData | null; active: boolean }>;
    deleteAccount(accessToken: string): Promise<void>;
  };
  // importer.ts — port of GbpImportPage.tsx toShopSite (origin/main line 478) and its URL checks
  export function checkBookingLink(text: string): { ok: true; url: string } | { ok: false; message: string }; // extractFirstUrl + isSupportedBookingHost
  export function toShopSite(payload: ScrapePayload, fallbackUrl: string, source: 'booking' | 'gbp'): { inputs: ShopInputs; site: WebsiteData };
  export function manualSite(shopName: string): Promise<{ inputs: ShopInputs; site: WebsiteData }>; // generateContent({shopName, area:'', phone:''})
  ```
  `ScrapePayload` and `Candidate` types copied from GbpImportPage.tsx / find-business.ts. Error messages copied from GbpImportPage.tsx.

- [ ] **Step 1: Failing tests:** `unsupported host is rejected before calling the API`; `toShopSite marks importedFrom booking` (fixture → `inputs.importedFrom === 'booking'`, `site.shopName` from payload); `gbp import maps hours and reviews`; `api maps 422 to ApiError with the server message`; `getUploadUrls posts siteId=folder and filenames`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit.

### Task 4: Photo upload

**Files:**
- Create: `src/lib/photos.ts`
- Test: `__tests__/photos.test.ts`

**Interfaces:**
- Consumes: `api.getUploadUrls` (Task 3).
- Produces: `export async function pickAndUploadPhoto(folder: string): Promise<string | null>` (image picker, cancelled → null) and `export async function uploadPhoto(localUri: string, folder: string, deps?): Promise<string>` — resize to max 2048 px long edge, JPEG 0.8 via `expo-image-manipulator`, filename `${Date.now()}-${random}.jpg`, `PUT` to `signedUrl` with `Content-Type: image/jpeg`, return `publicUrl`. Folder is `ios-drafts/${draftId}`.

- [ ] **Step 1: Failing tests:** `uploadPhoto resizes and returns the public URL` (manipulator called with `resize` ≤ 2048, fetch PUT with `image/jpeg`); `upload failure throws`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit.

### Task 5: Editable preview

**Files:**
- Create: `src/lib/editable.ts`, `src/lib/editorScript.ts`, `src/components/SitePreview.tsx`
- Test: `__tests__/editable.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const EDITABLE_TEXT_PATHS: string[]; // shopName, hero.heading, hero.tagline, about.heading, about.description.{i}, services.{i}.title|subtitle|description, phone, area, contact.address, bookingUrl, + prime-only policy.title, policy.body, pullQuote.text when present
  export const IMAGE_PATHS: (d: WebsiteData) => string[]; // hero.imageUrl, about.imageUrl, gallery.{i}, craftImages.{i}, staff.{i}.photo
  export function markData(d: WebsiteData): { marked: WebsiteData; ids: Record<string, string> }; // wraps each text value as `⁣${n}⁣${value}⁣/⁣`
  export function stripMarkers(s: string): string;
  export function getPath(d: WebsiteData, path: string): unknown;
  export function setPath(d: WebsiteData, path: string, value: unknown): WebsiteData; // immutable
  export const EDITOR_JS: string; // injected: walk text nodes, wrap marked runs in <span data-edit="path">, strip markers, tag <img>/background-image whose URL equals an IMAGE_PATHS value with data-edit-image, disable links/forms, on tap postMessage({type:'edit'|'image', path})
  // SitePreview props: { data: WebsiteData; editable: boolean; onEditText(path: string): void; onEditImage(path: string): void }
  ```
  `SitePreview` renders `withImages(renderSite(editable ? markData(data).marked : data))` in a `WebView` (`originWhitelist={['*']}`, `injectedJavaScript={EDITOR_JS}`) and re-renders on data change (keep scroll position by posting `scrollY` before reload and restoring it).

- [ ] **Step 1: Failing tests:**
  - `every editable path is reachable` — for the luxe and prime fixtures (from `generateContent` + one scrape fixture), each path in `EDITABLE_TEXT_PATHS` that has a non-empty value either appears marked in `renderSite(markData(d).marked)` **or** is listed in an explicit `SHEET_ONLY_PATHS` exported constant (record which fields each template transforms). Fails if a path is neither.
  - `stripMarkers leaves no U+2063`.
  - `setPath updates nested arrays immutably`.
  - `published payload never contains markers` — `stripMarkers(JSON.stringify(markData(d).marked)) === JSON.stringify(d)`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Template-specific transforms found here go into `SHEET_ONLY_PATHS`, not into edits of `src/web/`. **Step 4:** PASS. **Step 5:** Commit.

### Task 6: Theme, primitives, importer and loading screens

**Files:**
- Create: `src/constants/theme.ts`, `src/components/{Button,Field,Screen,Text}.tsx`, `src/app/start.tsx`, `src/app/booking-link.tsx`, `src/app/find-listing.tsx`, `src/app/manual.tsx`, `src/app/generating.tsx`, `src/lib/flow.ts`
- Test: `__tests__/flow.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces: `src/lib/flow.ts` — `startDraft(result: { inputs: ShopInputs; site: WebsiteData }): Promise<SiteRecord>` (new `draftId` via `expo-crypto` `randomUUID`, saves, tracks `site_generated` with `importedFrom`) and `track` calls per Task 10's event list.
- Screens copy GbpImportPage.tsx (origin/main) structure and text: start asks "Do you have a booking link?" (Yes → booking-link; No → find-listing; "Fill in manually" → manual); find-listing = autocomplete + candidates list → importBusiness; generating = LoadingScreen.tsx staged messages, then `router.replace('/editor')`. "Sign in" link top right → `/sign-in`.

- [ ] **Step 1: Failing test:** `startDraft saves a draft and returns it with a uuid`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Run in the simulator via an EAS `development-simulator` build (first time: `eas build -p ios --profile development-simulator`, install the .app with `xcrun simctl install` on the iPhone 17 simulator, `npx expo start --dev-client --port 8083`). Manually walk: manual "Fresh Cuts" → generating → editor placeholder. Booking link with a real Booksy URL imports. Screenshot each screen (`xcrun simctl io booted screenshot`) and compare with the web at 390 px (Playwright `browser_resize` 390×844 on https://www.aibarber.org).
- [ ] **Step 6:** Commit.

### Task 7: Editor screen, prompts and launch guide

**Files:**
- Create: `src/app/editor.tsx`, `src/components/{DesignSwitcher,EditSheet,AllFieldsSheet,ColourSheet,HomePrompts,LaunchGuide,PublishBar}.tsx`, `src/lib/editor.ts`
- Test: `__tests__/editor.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces: `src/lib/editor.ts`:
  ```ts
  export function switchDesign(d: WebsiteData, t: 'luxe' | 'prime'): WebsiteData; // port of App.tsx handleHomeDesignSwitch (origin/main line 118): what it preserves/seeds (policy, pullQuote) must match
  export function applyHomePrompts(d: WebsiteData, area: string, phone: string): Promise<WebsiteData>; // port of handleHomePromptFinish (line 947)
  export function applyBookingLink(d: WebsiteData, link: string): Promise<WebsiteData | null>; // port of handleHomePromptBookingLink (line 909) using api.importScrape + buildSiteFromScrape
  export function setColour(d: WebsiteData, swatch: string): WebsiteData; // same field the web swatch grid writes
  ```
- Editor = `SitePreview` full screen + floating Design 1 / Design 2 switcher (hidden after publish) + bottom bar: "Edit" (All fields), "Photos", "Colour", "Publish". Tapping text → `EditSheet` for that path; tapping an image → `pickAndUploadPhoto(`ios-drafts/${draftId}`)` then `setPath`. Every change `saveSite`. First open after generation: `HomePrompts` (copy HomeBookingPrompts.tsx) then `LaunchGuide` (copy HomeLaunchGuide.tsx), each once per draft.

- [ ] **Step 1: Failing tests:** `switchDesign keeps edited text`; `switchDesign to prime seeds policy and pullQuote like the web`; `applyHomePrompts sets area and phone`; `applyBookingLink returns null for unsupported host`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Simulator walk-through: edit heading by tapping it, change hero photo, switch designs and back (edit kept), colour change, prompts then guide appear once. Screenshots vs web.
- [ ] **Step 6:** Commit.

### Task 8: Superwall paywall and publish

**Files:**
- Create: `src/lib/paywall.tsx` (adapted from `/Users/ibrahim/CrewLens/crewlens/src/lib/paywall.tsx`: `SubscriptionSync`, `usePaywall`, `useRestorePurchases`; placement type `'publish'`), `src/lib/publish.ts`, `src/app/publishing.tsx`, `src/app/live.tsx`, `test/mocks/superwall.ts` (copy Crew Lens's, add `getCustomerInfo`)
- Modify: `src/app/_layout.tsx` (wrap in `SuperwallProvider` with `EXPO_PUBLIC_SUPERWALL_API_KEY`; on launch call `resumePendingPublish`)
- Test: `__tests__/publish.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3.
- Produces:
  ```ts
  export interface PublishDeps {
    hasEntitlement(): Promise<boolean>;
    showPaywall(): Promise<'purchased' | 'restored' | 'declined'>;   // registerPlacement('publish', feature)
    latestTransactionId(): Promise<string | null>;                   // getCustomerInfo().subscriptions: active, productId in our two ids, newest purchaseDate → transactionId
    iosPublish: typeof api.iosPublish; store: typeof import('./siteStore');
    userId(): string | null;
  }
  export type PublishOutcome = { kind: 'live'; url: string; republished: boolean } | { kind: 'declined' } | { kind: 'pending'; message: string } | { kind: 'inactive' };
  export async function publishFlow(site: SiteRecord, deps: PublishDeps): Promise<PublishOutcome>;
  export async function resumePendingPublish(deps: PublishDeps): Promise<PublishOutcome | null>;
  ```
  `publishFlow`: entitled? skip paywall : showPaywall; declined → `declined`. Get transaction id (retry 3× at 1 s; Superwall can lag); none → `pending`. `savePendingPublish({transactionId, data: stripMarkers-clean data})` **before** calling the API; call `iosPublish`; on success save `slug/deployedUrl/transactionId` to the site, clear pending, `trackConversion` already fired by Superwall events; 402 → `inactive`; network/5xx → keep pending, return `pending` ("Your payment went through. We're finishing your website — it'll be live in a few minutes.").

- [ ] **Step 1: Failing tests:** `skips paywall when entitled`; `declined paywall publishes nothing`; `pending publish is saved before the API call`; `retries a pending publish on launch`; `402 shows inactive and keeps the site`; `publish payload has no data URLs or markers`; `latestTransactionId picks the newest active AI Barber subscription`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** `live.tsx`: live URL, Open (expo-web-browser), Copy, Share; then the optional sign-up sheet (Task 9) with email field, as the web does after deploy. `publishing.tsx` shows the web's publish overlay copy (PublishOverlay.tsx).
- [ ] **Step 6:** Commit.

### Task 9: Accounts, dashboard, restore, delete

**Files:**
- Create: `src/lib/supabase.ts` (as Crew Lens's, project `lyjruphvzfwbtzfwfvwm`, SecureStore session), `src/lib/auth.ts`, `src/lib/account.ts`, `src/app/sign-in.tsx`, `src/app/sign-up.tsx`, `src/app/dashboard.tsx`, `src/app/settings.tsx`
- Test: `__tests__/account.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function signUp(email: string, password: string, fullName: string, phone: string): Promise<void>; // supabase.auth.signUp with metadata {full_name, phone} like AuthContext.tsx, then POST /api/sync-auth-phone like the web
  export async function signIn(email: string, password: string): Promise<void>;
  export async function syncSiteToSupabase(site: SiteRecord, userId: string): Promise<void>; // upsert into public.sites (id = draftId uuid, user_id, company_name, service_area, phone, site_data, deployed_url, deployment_status 'deployed'|'draft') — same columns the web writes in upsertSiteToSupabase
  export async function restore(deps): Promise<SiteRecord | null>; // restorePurchases → latestTransactionId → api.iosSite → saveSite
  export async function deleteAccountAndData(): Promise<void>; // api.deleteAccount(session.access_token) → signOut → clearSite
  ```
- Dashboard (`/dashboard`, the app's home once a site exists): site card (name, live URL or "Not published"), Edit (→ editor; Publish republishes for free when entitled), Open site, Settings. Settings: account (sign in/up/out), Restore purchases, Manage subscription (`Linking.openURL('itms-apps://apps.apple.com/account/subscriptions')`), Delete account (confirm dialog), Privacy + Terms links (aibarber.org pages; confirm they exist, else create them in the web repo), Support `support@davoxa.com`. `src/app/index.tsx`: pending publish → resume; site exists → dashboard; else → start.

- [ ] **Step 1: Failing tests:** `restore loads the bound site`; `restore with no subscription returns null`; `delete calls the endpoint with the access token then clears local data`; `syncSiteToSupabase writes the web's column names`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit.

### Task 10: Attribution and analytics

**Files:**
- Create: `src/lib/analytics.ts` (copy Crew Lens's, rename strings), `test/mocks/analytics.ts`
- Modify: `src/app/_layout.tsx` (call `initAttribution()` at launch; request ATT on the first screen after splash via `requestTrackingThenStart()`; after Superwall configures, `setIntegrationAttributes({ appsflyerId: await AppsFlyer.getAppsFlyerUID() })`)
- Test: `__tests__/analytics.test.ts` (copy Crew Lens's pending-queue tests)

**Interfaces:**
- Event map (PostHog + AppsFlyer): `site_generated` + AppsFlyer `af_lead` (`importedFrom`) — web's Lead equivalent; `editor_opened`; `publish_tapped` + `af_initiated_checkout`; Superwall `subscriptionStart` → `af_subscribe` with revenue via `trackConversion` (in `SubscriptionSync`); `site_published` (`republished`); sign-up → `af_complete_registration`; `restore_tapped`; `account_deleted`.

- [ ] **Step 1: Failing tests:** `events wait until AppsFlyer starts`; `publish_tapped sends af_initiated_checkout`; `subscription start sends af_subscribe with revenue`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5:** Commit.

### Task 11: Dashboards (agent does these in the logged-in Playwright browser and CLIs)

- [ ] **App Store Connect** (browser tab 0 if the API can't): create app "AI Barber" (if the name is taken, "AI Barber: Website Builder"), bundle `com.ibrahim1774.aibarber` (register the bundle id via ASC API `POST /v1/bundleIds` with the key in `~/.vibe-aso`), SKU `aibarber-ios`, primary language English (U.S.). Record the numeric app id → `eas.json submit.production.ios.ascAppId`, `.env.local EXPO_PUBLIC_APPLE_APP_ID`, Vercel env `APPLE_APP_ID` (Production + Preview). Subscription group "AI Barber Hosting" with the two products and US prices $19.99 / $191.99 (other storefronts: Apple's equalised prices), localized display names "Website Hosting — Monthly/Yearly". App Store Server Notifications V2: Production and Sandbox URL `https://www.aibarber.org/api/ios/apple-notification`. Sandbox tester: reuse `APPLE_SANDBOX_TESTER_EMAIL` from Crew Lens `.env.local`.
- [ ] **Superwall** (CLI `superwall`, load the `superwall` skill; browser tab 3 for the editor): new iOS app "AI Barber" in org IBRAHIMS ECOM, import the two products, entitlement `hosting`, campaign with placement `publish` → paywall (dark `#0d0d0d`/`#f4a100`, copy from the web pre-payment banner: "Publish Your Website", monthly and yearly, "Save 20%" on yearly), AppsFlyer integration on (check it does not also send purchase events the app sends — if it does, drop the app-side `af_subscribe`), Meta integration off. Public API key → `EXPO_PUBLIC_SUPERWALL_API_KEY`.
- [ ] **AppsFlyer** (browser tab 1): add iOS app with the ASC app id (pending-app mode before release), Meta partner integration with the new Meta app id, enable `af_complete_registration`, `af_subscribe`, `af_initiated_checkout`, `af_lead` mapping. Dev key → `EXPO_PUBLIC_APPSFLYER_DEV_KEY`.
- [ ] **Meta for Developers** (browser tab 2): new app in portfolio 411319692678287, add iOS platform with bundle id; store id after launch.
- [ ] **PostHog** (tab 4 or API with the personal key): project "AI Barber"; project key `phc_…` → `EXPO_PUBLIC_POSTHOG_KEY`.
- [ ] **EAS secrets:** `eas env:create` for every `EXPO_PUBLIC_*` in production and preview environments.
- [ ] Record all ids in memory file `aibarber-ios-project.md` (ids only, never secrets). If a dashboard Save is blocked by the permission classifier, ask Ibrahim to click it.

### Task 12: Device build and end-to-end sandbox test

- [ ] **Step 1:** `eas build -p ios --profile adhoc` (TestFlight is broken on Ibrahim's phone); install over USB: `xcrun devicectl device install app --device CCA16474-9DAE-5536-B7D9-E9F3C0EB03AF <ipa>` (phone unlocked; sandbox account in Settings → Developer).
- [ ] **Step 2: E2E on the phone** (Ibrahim taps, agent watches logs/backend):
  1. Manual "Fresh Cuts Test" → edit heading + hero photo → Publish → paywall → buy monthly (sandbox) → live screen shows `https://ios-test-fresh-cuts-test….vercel.app`; open it: heading and photo match.
  2. Edit again → Publish → no paywall → same URL, change visible (republish, force).
  3. Delete app, reinstall, Settings → Restore → dashboard shows the site.
  4. Kill switch: in a second run, airplane mode right after purchase → relaunch online → site goes live (pending publish), or the sweeper publishes within 10 min.
  5. Supabase `ios_purchases` row has slug, `published_at`, environment `Sandbox`; Apple notification rows update (`last_notification`).
  6. Sign up, then Delete account → auth user and `sites` row gone, site still live.
- [ ] **Step 3:** AppsFlyer SDK integration test page shows install + events; PostHog shows events; Superwall shows the transaction.
- [ ] **Step 4:** Delete `ios-test-*` Vercel projects (`vercel project rm`), sandbox rows stay (harmless).
- [ ] **Step 5:** Commit, push, update memory. App Store listing, screenshots and submission are a separate step (vibe-aso skill) once Ibrahim has tried the build.
