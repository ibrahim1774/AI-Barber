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
