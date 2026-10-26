# Ownership (server half) report, branch plan-fix

Rule (DECIDED 2026-10-26): ios_purchases.user_id is set once and never moved. No transfer/re-link/release.
Nothing applied: migration 018 is NOT applied; no live Supabase/Vercel/GCS/Apple calls.

## Migration 018 (supabase/migrations/018_ios_purchases_user_id.sql)
- user_id already existed (003); `add column if not exists` is a no-op there. Adds non-unique partial index on user_id (otid is already the PK, so one owner per purchase).
- Backfill (only rows with user_id null): (a) ab_shops.ios_otid -> owner_id; (b) no shop: the single account with a sites row at https://<slug>.vercel.app[/]. Several accounts on one URL = not guessed.
- Review/verification SELECTs V1-V4 are comments at the bottom (counts, still-unlinked bound rows with candidate ids, shop-vs-sites conflicts, integrity). Apply the migration BEFORE deploying the code.

## POST /api/ios/site  (still POST {transactionId}, not GET; app contract unchanged)
Header `Authorization: Bearer <Supabase token>` now required.
- 401 `{error:'unauthorized'}`: no/invalid token (checked before Apple is asked, before the rate-limit-protected Apple call).
- 200 IosSiteBody (unchanged shape) only when purchase.user_id == caller.
- 409 `{error:'purchase-other-account', hint:'a***@gmail.com'|null}`: linked to another account. No site data, no id, no full email.
- Legacy unlinked + slug bound: linked to the caller (conditional SQL) only if the caller owns the bound shop (ab_shops.ios_otid) or sites row; else 409 with hint null (also when ambiguous or nothing proves ownership). Lost race re-decided. Unlinked + no slug: 404 no-site (not linked).
- Unchanged: 404 no-site (incl. removed_at), 404 verify failures, 503, 429.

## POST /api/ios/publish
- Purchase linked: caller must equal user_id. No/invalid token 401 `unauthorized`; auth outage 503; other account 409 `purchase-other-account` + hint. Nothing written (no bind, no pending write, no deploy).
- Unlinked + signed-in caller: links on first verified publish via setUserIfUnlinked (exactly one of two racing accounts wins; loser 409). If a slug is already bound and bindingOwner(row) names a different account (or ambiguous), 409 and no link. Nobody attached yet: first signed-in caller claims.
- No token + unlinked: old fresh-bind behaviour (no link). Body userId still ignored.
- removed_at, take-offline, slug reservation, prefix guards, 402 inactive, site-updated 409 unchanged. Order: Apple verify (402/400) comes before the ownership check.

## GET /api/shop/plan
Adds `purchaseAccount: 'self'|'other'|null` (also in POST body). Source: the shop's purchase; optional `?otid=<originalTransactionId>` (digits) lets a shop-less/other-linked account learn 'other' for the device's purchase without Apple ('other' wins). No shop still 200 unlinked (S2).

## POST /api/shop/plan (Restore)
Other account's purchase: 409 `{error:'purchase-in-use', reason:'purchase-other-account', hint}` (error string kept for old builds; app should key on `reason`). Unlinked purchase whose bound shop/site belongs to another account: same 409. Shop link now happens BEFORE setUser, so a 'taken' 409 no longer leaves the purchase linked.

## Lapse/refund/revoke/renewal
Sweep and notification code untouched (no user_id use). Tests prove: lapse/refund take the site down, user_id unchanged, B refused throughout, renewal under A republishes and unlocks.

## Tests
New: tests/e2e/ownership.test.ts (20), tests/migration018.test.ts (3). Updated existing tests for the new contract (lookup needs bearer; publish to linked purchase needs the owner; plan 409 body). vitest 3777 pass; tsc output identical to baseline.

## Undecided / for the app and the owner
1. Plan says "GET by otid" but the endpoint is POST {transactionId}; kept POST.
2. Plan POST error string: kept `purchase-in-use` + `reason`; renaming to `purchase-other-account` would break old builds. Say if you want it renamed.
3. A purchase bound by a no-account publish that nobody owns yet can be claimed by whichever signed-in account touches it first (same Apple ID, unavoidable). Lookup is stricter: it never discloses a site without proof of ownership, so such a row gives 409 on lookup until linked by a publish or plan POST.
4. 402 subscription-inactive takes precedence over 409 for B when the subscription is inactive.
5. Concurrency of two plan POSTs for one unlinked purchase: setUser is not conditional (existing); the shop ios_otid unique index is the guard. Could switch to setUserIfUnlinked.
6. Old app builds (no bearer on /api/ios/site) now get 401 on Restore: ship the app update first or together.
7. 018 step 3b guesses the owner from sites.deployed_url only for exact https://<slug>.vercel.app; custom-domain-only rows land in review query V2.


# Review fix round (Opus review ownership-server-review.md: H1-H3, M1)

## Single writer of ios_purchases.user_id
`PurchasesRepo.setUserIfUnlinked(otid, uid)` is the ONLY writer (one `UPDATE ... SET user_id=$uid WHERE original_transaction_id=$otid AND user_id IS NULL`, true = this call linked it). The unconditional `setUser` is deleted from the repo, PlanDeps and the setup verifier (now `linkUserIfUnlinked`). A source-audit test (tests/e2e/ownership.test.ts) fails if any other lib/api code updates user_id on ios_purchases. Callers: publish, /api/ios/site (Restore), plan POST, shop setup. On 0 rows each re-reads the row: another owner = 409, same caller = fine.

## Final endpoint contracts
- POST /api/shop/setup {transactionId?...} (Bearer): verified purchase linked to another account -> 409 `{error:'purchase-other-account', hint}`. Unlinked + bindingOwner(row) is another account/ambiguous -> same 409, nothing created or linked. Order: ownership check, shop link (setShopOtid, 409 `purchase-in-use` if another shop holds it, purchase stays unlinked), then atomic link; if the link race is lost to another account the shop link is reverted and 409 `purchase-other-account`.
- POST /api/shop/plan: lost link race -> 409 `{error:'purchase-in-use', reason:'purchase-other-account', hint}` and the shop link is reverted (old error string kept for old builds; key on `reason`).
- POST /api/ios/publish: linked: owner only (401 no/invalid token, 409 other). Unlinked + bearer: bindingOwner check then atomic link (loser 409). NEW (M1) unlinked + NO bearer + slug already bound to an account's shop/site: 401 `unauthorized` (a true first publish with no slug/owner still fresh-binds).
- POST /api/ios/site: Bearer required. No Authorization header at all: 401 `{error:'auth-required'}` (compat for old builds, before Apple is asked, no site data, no unauthenticated read ever). Present but bad/expired token: 401 `{error:'unauthorized'}`. Else 200 / 409 `purchase-other-account` / 404 as before.
- POST /api/ios/take-offline: unchanged. A purchase linked to an account needs the owner's Bearer: no token 403 `sign-in-required`, wrong account 403 `not-owner`. Unlinked purchases still work with the bare transactionId (App Store 5.1.1(v)).

## App call sites that must send `Authorization: Bearer <supabase access token>` (currently they do not)
1. Restore: src/lib/account.ts ~361 (`iosSite`). Handle 401 `auth-required` (prompt sign-in), 401 `unauthorized` (refresh token), 409 `purchase-other-account`.
2. Admin-edit sync: src/lib/adminSync.ts ~178 (`iosSite`, signed-in only; skip when signed out).
3. Take-offline pre-check: src/lib/account.ts ~488 (`iosSite`), and the take-offline POST itself must send the Bearer when signed in (403 `sign-in-required` otherwise for linked purchases).
4. api.ts `iosSite` (src/lib/api.ts ~208): add the header there once; all three callers go through it.
Also: shop setup caller must handle 409 `purchase-other-account`; plan POST caller keys on `reason`.

## Deploy note
Old builds: Restore/admin sync/take-offline pre-check on a linked purchase show an error until updated (auth-required 401). Publish and take-offline POST keep working signed-in. Tests: 3788 pass; tsc identical to baseline (4809 pre-existing errors).


# Pay-then-sign-up server tasks 1+2 (plan 2026-10-26-pay-then-signup-flow) - contracts for the app builder

Nothing applied: migration 019 is NOT applied; no live calls. Apply 019 BEFORE deploying (claim-start answers 503 while the column is missing). Deploy order per the plan: ship the app first, then the server.

## Owner rulings implemented
- Q1: deleting an account may free the purchase: `user_id` stays ON DELETE SET NULL, so a NEW account can claim it afterwards (tested). Between two LIVE accounts a purchase is still never movable (setUserIfUnlinked is the only writer).
- Q2: unclaimed rows past `claim_expires_at` are only LOGGED by the sweep (`[Sweeper:iOS] EXPIRED UNCLAIMED purchase ...`, summary field `expiredUnclaimed: [otid]`, present only when non-empty). No refund, no takedown; such a row can still be claimed.
- Q3: phone is required and validated server-side in /api/ios/signup.
- Q4: no email verification: accounts are created confirmed by the server. No Supabase dashboard setting changed (shared project; web sign-up unaffected).

## POST /api/ios/claim-start   body { transactionId }   (Authorization optional)
Call right after the purchase, before any account. Verifies with Apple, upserts the row, stamps `claim_expires_at = now+30d` ONCE. Writes no slug, no content, no user.
- 200 `{ ok:true, state:'unclaimed', claimExpiresAt:<ISO> }` (idempotent per originalTransactionId: a retry returns the same deadline, never extends).
- 200 `{ ok:true, state:'claimed', claimExpiresAt }` only when the Bearer is the account that already owns it (retry-safe).
- 402 `{ error:'subscription-inactive', reason?:'revoked' }`: refunded/revoked/expired. Phone clears its pending record.
- 409 `{ error:'purchase-claimed' }` already linked to an account (nothing disclosed); 409 `{ error:'purchase-has-site' }` legacy purchase that already has a site (use Restore/publish with a Bearer).
- 400 bad-request (missing/oversized transactionId; or Apple bad-bundle/bad-product), 404 not-found, 429 rate-limited (+Retry-After), 503 apple-unavailable / temporarily-unavailable (incl. column missing).

## POST /api/ios/signup   body { name, email, phone, password }   (no auth)
Creates the Supabase user via the admin API with `email_confirm:true`, `user_metadata { full_name, name, phone }`. Then the app signs in with `supabase.auth.signInWithPassword({ email, password })` (use the returned normalized `email`).
- 200 `{ ok:true, email }` (lower-cased, trimmed). No token, id, password or metadata is ever returned.
- 400 `{ error:'bad-request', field:'name'|'email'|'phone' }`: name 1-100 chars; email syntax <=254; phone digits with optional leading +, 7-15 digits (spaces - . ( ) stripped; stored normalized, e.g. `+15550100199`).
- 400 `{ error:'weak-password', minLength:8 }` for < 8 or > 72 chars (bcrypt limit).
- 409 `{ error:'email-exists' }`: the only account-existence signal. App: "Sign in instead", keep the email.
- 429 `{ error:'rate-limited' }` (+Retry-After 60): 10/min per IP and 4/min per email (hashed key). Limiter failure fails open (logged).
- 503 `{ error:'temporarily-unavailable' }`. Validation runs before the limiter and before any Supabase call.
- Web sign-up note: the web app's own "confirm email" setting is untouched; only accounts created here skip it. If a DB trigger on auth.users creates profile rows, it fires for these users too (same as web).

## POST /api/ios/publish (changed)   Authorization: Bearer <Supabase access token>
One request does link -> bind slug -> write -> deploy. Order: Apple verify (402/400) -> ownership -> (first-time only) link -> slug bind -> compare-and-set write -> deploy.
- Unlinked purchase + Bearer: refusals come BEFORE any write: 409 `{ error:'purchase-other-account', hint }` (slug bound to another account's shop/site, or lost the link race: exactly one of two racing accounts wins), 409 `{ error:'account-has-site', slug:'<the account's existing live site>' }` (the account already holds a different, not-removed site; sign out and use another account, or manage that site). Link failure is 503 (fails closed; nothing is published).
- Linked purchase: owner only (401 unauthorized no/invalid token, 409 purchase-other-account for another account), unchanged. site-updated 409, removed_at, slug reservations, prefix-scoped deletion unchanged.
- NO Bearer on an unlinked purchase: 401 `{ error:'unauthorized' }` before anything is written... EXCEPT while the compat flag is on (below). Auth outage with a Bearer: 503.
- COMPAT FLAG (old app builds): `ALLOW_ACCOUNTLESS_PUBLISH_UNTIL_APP_SHIPS = true` in lib/ios/publishFlow.ts. While true, a publish with no valid Bearer on an unlinked purchase still fresh-binds with no account, exactly as before (REMOVE-AFTER-APP-SHIPS: set false / delete the branch once the new app is live). `PublishDeps.allowAccountlessPublish` overrides it (tests run the strict contract). So with the flag on, "401 without Bearer" is NOT yet enforced in production; the new app must still always send the Bearer.
- Behaviour change for everyone: a Bearer that cannot be checked (auth outage) or a failed link write is now 503 instead of publishing unlinked.

## Sweep
`expiredUnclaimed` scan runs first, best effort, log only (see Q2).

## Known limits
- account-has-site counts only purchases linked to the account (ios_purchases.user_id with a slug and no removed_at), not web-created sites. Two simultaneous first claims by one account with two purchases could both pass the check (no DB uniqueness); rare, not guarded.
- Tests: tests/e2e/payThenSignup.test.ts (21), tests/ios/signup.test.ts (11). vitest 3819 pass; tsc output identical to baseline (4813 lines).
