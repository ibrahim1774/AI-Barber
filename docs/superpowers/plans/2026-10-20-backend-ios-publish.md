# AI Barber backend: iOS publish path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server routes the AI Barber iOS app needs (verify an Apple subscription, choose a safe slug, publish/republish the one bound site, look a site up after restore, Apple server notifications, sweeper retry, account deletion) to the existing aibarber.org Vercel backend without changing any web behaviour.

**Architecture:** New code lives under `lib/ios/` as pure-ish functions with injected dependencies (unit-tested with Vitest) and thin Vercel handlers under `api/ios/`. The only change to existing code is an opt-in `force` option on `publishSite` and an exported `writePendingSite`, plus a second branch in `api/publish-sweeper.ts`. State lives in one new Supabase table, `ios_purchases`.

**Tech Stack:** TypeScript (repo has `strictNullChecks` off), Vercel Node functions, `@apple/app-store-server-library`, `@supabase/supabase-js` (service role), `@google-cloud/storage`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-aibarber-ios-design.md` in `ibrahim1774/aibarber-ios` — read the "Findings during planning" section; it overrides earlier sections.

## Global Constraints

- Work in a git worktree of `ibrahim1774/AI-Barber` branched from `origin/main` at `/Users/ibrahim/aibarber-backend-ios` (no spaces/parens in path), branch `ios-backend`. The old clone `~/AI-Barber` is stale and has untracked files (`gcs-key.json`) — never commit from it.
- Imports inside `api/` and `lib/` use `.js` extensions on relative paths (Vercel ESM), matching existing files (e.g. `./deploySite.js`).
- Bundle id `com.ibrahim1774.aibarber`. Product ids `com.ibrahim1774.aibarber.hosting.monthly` ($19.99) and `com.ibrahim1774.aibarber.hosting.yearly` ($191.99).
- Apple In-App Purchase key: key id `6W4KWKD3WN`, issuer `8e2cad29-fcba-4f15-baf7-23b9cbcd6c24`, file `/Users/ibrahim/CrewLens/crewlens/SubscriptionKey_6W4KWKD3WN.p8`. Env vars: `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_PRIVATE_KEY` (PEM text), `APPLE_BUNDLE_ID`, `APPLE_APP_ID` (numeric ASC app id; needed by the production verifier; set once the ASC app exists).
- Supabase project `lyjruphvzfwbtzfwfvwm` (named "PrimeHub"; shared with primehub.dev). Server env already has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Sandbox-environment purchases get slug prefix `ios-test-`, decided from the verified transaction, never from the request.
- Every existing web path (Stripe webhook, sweeper Stripe branch, `deploy-site`, `save-pending-site`) must behave exactly as before.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A web customer already owns `fresh-cuts` (pending file and live site) and an iOS barber publishes "Fresh Cuts" → the iOS site gets `fresh-cuts-xxxx`; the web customer's pending file and Vercel project are untouched. (Task 4, Task 5 test `does not reuse a slug owned by the web`.)
- The barber renames the shop after publishing and republishes → same slug, redeployed with new content (force), not a new site. (Task 5 test `republish after rename keeps the bound slug and forces a deploy`.)
- Subscription expired or refunded, app tries to republish → 402, nothing deployed, site stays up. (Task 5 test `expired subscription cannot republish`.)
- App killed after purchase, before publish returns → row exists with slug bound and `published_at` null → sweeper publishes it. (Task 7 test `publishes bound unpublished rows`.)
- Sandbox transaction id sent to production lookup → production 401/404 → sandbox lookup succeeds → slug starts `ios-test-`. (Task 2 test `falls back to sandbox`, Task 4 test `sandbox prefix`.)

---

### Task 1: Worktree, Vitest, and `publishSite` force option

**Files:**
- Create worktree `/Users/ibrahim/aibarber-backend-ios` (branch `ios-backend` from `origin/main`)
- Modify: `package.json` (add `"test": "vitest run"`, devDeps `vitest@^2`, deps `@apple/app-store-server-library@^1`)
- Create: `vitest.config.ts` (`test.include: ['tests/**/*.test.ts']`, `environment: 'node'`)
- Modify: `lib/publishSite.ts`
- Test: `tests/publishSite.test.ts`

**Interfaces:**
- Produces: `publishSite(siteId: string, opts?: { force?: boolean }): Promise<PublishOutcome>`; `writePendingSite(siteId: string, pending: PendingSite): Promise<void>` (same file format as `stampDeployedUrl`: `{ siteId, savedAt, data }` at `pending-sites/{slug}.json`); `export const slugify` (now exported).

- [ ] **Step 1:** `git -C ~/AI-Barber fetch origin && git -C ~/AI-Barber worktree add -b ios-backend /Users/ibrahim/aibarber-backend-ios origin/main`, then `npm ci` there. Check `df -h /` first; stop if under 1.5 GB free.
- [ ] **Step 2: Write failing tests** in `tests/publishSite.test.ts`, mocking `@google-cloud/storage` (in-memory bucket with `file().exists/download/save`), `../lib/deploySite.js` (`deployRenderedSite` spy returning `{ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} }`) and global `fetch`:
  - `default call returns alreadyLive without deploying when our marker is served` — fetch returns 200 body containing `name="published-at"` → `{ ok: true, alreadyLive: true }`, `deployRenderedSite` not called.
  - `force deploys even when the site is already live` — same fetch, `publishSite('fresh-cuts', { force: true })` → `deployRenderedSite` called once, `alreadyLive: false`.
  - `writePendingSite then publishSite reads it back` — `writePendingSite('Fresh Cuts', pending)` stores at `pending-sites/fresh-cuts.json`; `publishSite('fresh-cuts')` with fetch 404 deploys.
- [ ] **Step 3:** `npx vitest run tests/publishSite.test.ts` → FAIL (`force`/`writePendingSite` missing).
- [ ] **Step 4:** Implement: add the `opts` parameter (skip the `alreadyLive` gate only when `opts.force`), export `slugify`, add `writePendingSite`. No other behaviour change.
- [ ] **Step 5:** `npx vitest run` → PASS; `npx tsc --noEmit -p .` → no new errors versus `origin/main` (record the baseline count first).
- [ ] **Step 6:** Commit `publishSite: opt-in force redeploy; export writePendingSite (for iOS)`.

### Task 2: Apple transaction verification

**Files:**
- Create: `lib/ios/appleVerify.ts`, `lib/ios/certs/AppleRootCA-G3.cer`, `lib/ios/certs/AppleRootCA-G2.cer`, `lib/ios/certs/AppleIncRootCertificate.cer` (download from https://www.apple.com/certificateauthority/)
- Test: `tests/ios/appleVerify.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type IosEnv = 'Production' | 'Sandbox';
  export interface VerifiedTx {
    originalTransactionId: string; transactionId: string; productId: string;
    environment: IosEnv; expiresAt: number | null; revoked: boolean;
  }
  export type VerifyError = 'not-found' | 'bad-bundle' | 'bad-product' | 'apple-unavailable';
  export class VerifyFailure extends Error { constructor(public code: VerifyError) }
  export const IOS_PRODUCT_IDS: readonly string[];
  export function isActive(tx: VerifiedTx, now?: number): boolean; // !revoked && (expiresAt === null || expiresAt > now)
  export interface AppleLookup { (env: IosEnv, transactionId: string): Promise<{ status: number; signedTransactionInfo?: string }> }
  export interface AppleDecode { (env: IosEnv, signed: string): Promise<{ bundleId: string; productId: string; originalTransactionId: string; transactionId: string; expiresDate?: number; revocationDate?: number }> }
  export function makeVerifier(deps: { lookup: AppleLookup; decode: AppleDecode; bundleId: string }): (transactionId: string) => Promise<VerifiedTx>;
  export function defaultVerifier(): (transactionId: string) => Promise<VerifiedTx>; // wires AppStoreServerAPIClient + SignedDataVerifier from env
  ```

- [ ] **Step 1: Write failing tests** (fake `lookup`/`decode`):
  - `returns the production transaction` — prod 200 → `environment: 'Production'`.
  - `falls back to sandbox` — prod 401 (and separately 404) → sandbox 200 → `environment: 'Sandbox'`.
  - `not found in either environment` → `VerifyFailure('not-found')`.
  - `rejects another app's transaction` — decoded bundleId `com.other` → `'bad-bundle'`.
  - `rejects unknown product` → `'bad-product'`.
  - `isActive` — revoked → false; `expiresAt` in the past → false; future → true.
  - `apple 5xx` → `'apple-unavailable'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `makeVerifier` (production first, sandbox on 401/404). `defaultVerifier` uses `AppStoreServerAPIClient(key, keyId, issuerId, bundleId, Environment.X).getTransactionInfo(id)` and `new SignedDataVerifier(rootCerts, true, env, bundleId, appAppleId).verifyAndDecodeTransaction`; map `APIException` 401/404 to `status`. Production verifier needs `APPLE_APP_ID`; if unset, skip production and go straight to sandbox (pre-launch).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `iOS: verify App Store transactions (prod, sandbox fallback)`.

### Task 3: `ios_purchases` table and repository

**Files:**
- Create: `supabase/migrations/003_ios_purchases.sql`
- Create: `lib/ios/purchases.ts`
- Test: `tests/ios/purchases.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PurchaseRow {
    original_transaction_id: string; product_id: string; environment: 'Production' | 'Sandbox';
    site_slug: string | null; user_id: string | null; expires_at: string | null; revoked_at: string | null;
    last_notification: string | null; published_at: string | null;
  }
  export interface PurchasesRepo {
    get(otid: string): Promise<PurchaseRow | null>;
    upsertVerified(tx: VerifiedTx): Promise<PurchaseRow>;       // never overwrites site_slug/published_at/user_id
    bindSlug(otid: string, slug: string): Promise<boolean>;     // UPDATE … WHERE site_slug IS NULL; true if it took
    slugTaken(slug: string): Promise<boolean>;
    markPublished(otid: string): Promise<void>;
    setUser(otid: string, userId: string): Promise<void>;
    applyNotification(n: { otid: string; productId: string; environment: string; expiresAt: number | null; revokedAt: number | null; type: string }): Promise<void>;
    unpublishedBound(limit: number): Promise<PurchaseRow[]>;    // site_slug not null, published_at null, revoked_at null
  }
  export function supabasePurchases(client?: SupabaseClient): PurchasesRepo;
  ```
- Migration: table `public.ios_purchases` with the columns above (`original_transaction_id text primary key`, `site_slug text unique`, `user_id uuid references auth.users(id) on delete set null`, timestamps `timestamptz`, `verified_at`/`created_at default now()`); `alter table … enable row level security;` and **no policies** (service role only).

- [ ] **Step 1: Write failing tests** against a fake Supabase client that records the query chain:
  - `bindSlug only updates when site_slug is null` — asserts `.is('site_slug', null)` in the chain and returns false when 0 rows updated.
  - `upsertVerified does not send site_slug, user_id or published_at` — inspects the upsert payload keys.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Apply the migration to `lyjruphvzfwbtzfwfvwm` with the Supabase MCP `apply_migration` (name `ios_purchases`), then `list_tables` shows `public.ios_purchases` with RLS enabled. Run `get_advisors` (security) and confirm no new warnings beyond "RLS enabled, no policy" for this table, which is intended.
- [ ] **Step 6:** Commit `iOS: ios_purchases table + repository`.

### Task 4: Slug chooser

**Files:**
- Create: `lib/ios/slug.ts`
- Test: `tests/ios/slug.test.ts`

**Interfaces:**
- Consumes: `slugify` (Task 1), `PurchasesRepo.slugTaken` (Task 3).
- Produces:
  ```ts
  export async function chooseSlug(shopName: string, env: 'Production' | 'Sandbox',
    isTaken: (slug: string) => Promise<boolean>, rand?: () => string): Promise<string>;
  export function makeIsTaken(deps: { pendingExists(slug: string): Promise<boolean>; repoTaken(slug: string): Promise<boolean>; urlServes(url: string): Promise<boolean> }): (slug: string) => Promise<boolean>;
  ```
  Base = `slugify(shopName)` truncated to 40 chars, `'barbershop'` if empty; sandbox prefixes `ios-test-`. If taken, try `${base}-${rand()}` (4 lowercase base36 chars) up to 5 times, then throw `Error('slug-exhausted')`. `makeIsTaken` returns true if any of: pending file exists, repo has it, or `https://{slug}.vercel.app` answers 2xx (any content).

- [ ] **Step 1: Write failing tests:** `free base is used as is` (`'Fresh Cuts'` → `fresh-cuts`); `taken base gets a suffix` (`fresh-cuts` taken, rand `'ab12'` → `fresh-cuts-ab12`); `sandbox prefix` (→ `ios-test-fresh-cuts`); `empty name` (`'!!!'` → `barbershop`); `gives up after five tries`; `makeIsTaken` true when only the URL serves.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `iOS: collision-safe slug chooser`.

### Task 5: `POST /api/ios/publish` and `POST /api/ios/site`

**Files:**
- Create: `lib/ios/publishFlow.ts`, `api/ios/publish.ts`, `api/ios/site.ts`
- Modify: `vercel.json` — add `"functions": { "api/ios/publish.ts": { "maxDuration": 60 }, "api/publish-sweeper.ts": { "maxDuration": 300 } }` (keep whatever the sweeper has today if it already sets one; `deployRenderedSite` polls up to 30 s)
- Test: `tests/ios/publishFlow.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  ```ts
  export interface IosPublishInput { transactionId: string; siteData: WebsiteData; userId?: string | null }
  export type IosPublishResult =
    | { status: 200; body: { siteId: string; deployedUrl: string; republished: boolean } }
    | { status: 400 | 402 | 404 | 409 | 502 | 503; body: { error: string; reason?: string } };
  export interface PublishDeps {
    verify(transactionId: string): Promise<VerifiedTx>; repo: PurchasesRepo;
    isTaken(slug: string): Promise<boolean>; writePending(slug: string, p: PendingSite): Promise<void>;
    publish(slug: string, opts: { force: boolean }): Promise<PublishOutcome>;
    readPending(slug: string): Promise<PendingSite | null>; now(): number;
  }
  export function buildImageUrlMap(sd: WebsiteData): Record<string, string>; // keys hero, about, gallery{i}, craft{i}, staff{i}; only http(s) values
  export function toPendingSiteData(sd: WebsiteData, map: Record<string, string>): WebsiteData; // same transform as GeneratedWebsite.tsx preparePendingSite ('uploaded' markers, services imageUrl '')
  export async function runIosPublish(input: IosPublishInput, deps: PublishDeps): Promise<IosPublishResult>;
  export async function runIosSiteLookup(transactionId: string, deps: Pick<PublishDeps, 'verify' | 'repo' | 'readPending'>):
    Promise<{ status: 200; body: { siteId: string; deployedUrl: string | null; siteData: WebsiteData | null; active: boolean } } | { status: 404 | 503; body: { error: string } }>;
  ```
- Status mapping: invalid body or any `"data:"` substring in `JSON.stringify(siteData)` or body > 3 MB → 400 `bad-request`; `VerifyFailure` not-found/bad-bundle/bad-product → 404/400/400; apple-unavailable → 503; `!isActive` → 402 `subscription-inactive`; bound slug exists → reuse it with `force: true`; else `chooseSlug` + `bindSlug` (if bind returns false, re-`get` and use the now-bound slug); `writePending` then `publish`; ok → `markPublished`, 200; not ok → 502 with `reason` (row stays unpublished for the sweeper). `userId` (only when given) → `repo.setUser`.
- `site` handler: verify → `repo.get` → 404 `no-site` if no slug, else `readPending(slug)` and return `deployedUrl` from it, `siteData` with `'uploaded'` markers replaced back from `imageUrlMap`, and `active: isActive(tx)`.

- [ ] **Step 1: Write failing tests** with in-memory fakes:
  - `first publish binds a new slug and publishes without force`.
  - `does not reuse a slug owned by the web` — `isTaken('fresh-cuts')` true → slug `fresh-cuts-xxxx`; `writePending` never called with `fresh-cuts`.
  - `republish after rename keeps the bound slug and forces a deploy` — row bound to `fresh-cuts-ab12`, input shopName `'Elite Fades'` → publish called with (`fresh-cuts-ab12`, `{force:true}`), `republished: true`.
  - `expired subscription cannot republish` → 402, `publish` not called.
  - `rejects data URLs` → 400.
  - `deploy failure leaves the row for the sweeper` → 502, `markPublished` not called, slug still bound.
  - `concurrent first publish uses the slug that won the bind`.
  - `buildImageUrlMap` keeps only http(s) and indexes gallery/craft/staff.
  - `site lookup returns siteData with real image URLs`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement `publishFlow.ts`; handlers parse JSON, allow `OPTIONS`/CORS like the existing endpoints, call `runIosPublish(body, liveDeps())` and `res.status(r.status).json(r.body)`. **Step 4:** PASS.
- [ ] **Step 5:** Commit `iOS: publish/republish and site lookup endpoints`.

### Task 6: `POST /api/ios/apple-notification`

**Files:**
- Create: `lib/ios/notifications.ts`, `api/ios/apple-notification.ts`
- Test: `tests/ios/notifications.test.ts`

**Interfaces:**
- Produces: `export async function handleAppleNotification(signedPayload: string, deps: { decodeNotification(p: string): Promise<{ notificationType: string; subtype?: string; data?: { environment?: string; bundleId?: string; signedTransactionInfo?: string } }>; decodeTransaction(env: IosEnv, s: string): ReturnType<AppleDecode>; repo: PurchasesRepo; bundleId: string }): Promise<{ status: 200 | 400; body: object }>` — verifies via `SignedDataVerifier.verifyAndDecodeNotification` (try production verifier, then sandbox), ignores other bundles (200, `ignored`), calls `repo.applyNotification`. Never publishes or unpublishes. Always 200 for well-signed payloads so Apple stops retrying.

- [ ] **Step 1: Write failing tests:** `records renewal expiry`; `records refund as revoked` (`REFUND` → `revokedAt` set); `ignores other bundle ids`; `bad signature → 400`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `iOS: App Store Server Notifications V2 receiver`.

### Task 7: Sweeper branch for iOS

**Files:**
- Create: `lib/ios/sweep.ts`
- Modify: `api/publish-sweeper.ts` — after the existing Stripe loop, `await sweepIos(...)` and include its summary in the JSON response; the Stripe branch is unchanged.
- Test: `tests/ios/sweep.test.ts`

**Interfaces:**
- Produces: `export async function sweepIos(deps: { repo: PurchasesRepo; publish(slug: string): Promise<PublishOutcome> }, limit = 20): Promise<{ checked: number; published: string[]; failed: string[] }>` — for each `unpublishedBound(limit)` row, `publish(slug)` (no force; pending file was written by the publish call) and `markPublished` on ok.

- [ ] **Step 1: Write failing tests:** `publishes bound unpublished rows`; `leaves failures for next run`; `no rows → zero work`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement and wire. **Step 4:** PASS (whole suite). **Step 5:** Commit `Sweeper: also publish paid iOS sites that never finished`.

### Task 8: `POST /api/ios/delete-account`

**Files:**
- Create: `lib/ios/deleteAccount.ts`, `api/ios/delete-account.ts`
- Test: `tests/ios/deleteAccount.test.ts`

**Interfaces:**
- Produces: `export async function deleteAccount(bearer: string | undefined, deps: { getUser(jwt: string): Promise<{ id: string } | null>; deleteSites(userId: string): Promise<void>; deleteUser(userId: string): Promise<void> }): Promise<{ status: 200 | 401; body: object }>` — `Authorization: Bearer <supabase access token>` required; deletes `sites` rows for the user then the auth user (service role `auth.admin.deleteUser`). `ios_purchases.user_id` clears via `on delete set null`. Published sites stay up.

- [ ] **Step 1: Write failing tests:** `missing token → 401`; `invalid token → 401, nothing deleted`; `deletes sites then user`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `iOS: in-app account deletion endpoint`.

### Task 9: Preview deploy, env vars, smoke tests, merge

- [ ] **Step 1:** Add env vars to Vercel project `prime-barber-ai` (team `ibrahims-projects-e5ab879e`) for Preview **and** Production: `APPLE_IAP_KEY_ID=6W4KWKD3WN`, `APPLE_IAP_ISSUER_ID=8e2cad29-fcba-4f15-baf7-23b9cbcd6c24`, `APPLE_BUNDLE_ID=com.ibrahim1774.aibarber`, and `APPLE_IAP_PRIVATE_KEY` from the .p8 file via `vercel env add APPLE_IAP_PRIVATE_KEY preview < file` (do not echo the key). If the auto-mode classifier blocks this, stop and ask Ibrahim to run the two `vercel env add` commands. `APPLE_APP_ID` is added later (app plan, ASC task).
- [ ] **Step 2:** `git push -u origin ios-backend`; wait for the Vercel preview; find its URL with `vercel ls prime-barber-ai`. If Deployment Protection returns 401, use a protection-bypass token (`x-vercel-protection-bypass`) for the smoke calls.
- [ ] **Step 3: Smoke** against the preview:
  - `POST /api/ios/publish` `{ "transactionId": "2000000000000000", "siteData": {…fixture…} }` → 404 `not-found` (proves key + sandbox lookup work end to end).
  - `POST /api/ios/publish` with a `data:image` in siteData → 400.
  - `POST /api/ios/apple-notification` `{ "signedPayload": "x.y.z" }` → 400.
  - `POST /api/ios/delete-account` without auth → 401.
  - Homepage `/` still renders; `POST /api/create-checkout-session` `{ "siteId": "x", "plan": "monthly" }` still returns a Stripe client secret/url (web unchanged).
- [ ] **Step 4:** Full `npx vitest run` green and `tsc` no new errors. Then merge: `gh pr create --base main --head ios-backend` with a summary, `gh pr merge --squash`. Confirm the production deploy goes READY and repeat the smoke checks against `https://www.aibarber.org`.
- [ ] **Step 5:** The real end-to-end (sandbox purchase → live `ios-test-…` site → republish → sweeper) runs in the app plan, Task 12. Delete `ios-test-*` Vercel projects afterwards.
