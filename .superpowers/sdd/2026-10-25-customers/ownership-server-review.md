# Review: plan-fix (PR #263, 951fbe6) — purchase ownership, server half

Scope: money, ownership, PII, data loss. Read-only; nothing applied, no live calls.
Verdict: **FIX FIRST** (one deploy blocker, two ownership bypasses). The migration itself is safe.

## Blockers / High

**H1. Deploying this server breaks every shipping app build on /api/ios/site (Restore, admin sync, take-offline).**
`lib/ios/publishFlow.ts:411` returns 401 when there is no bearer. No app build sends one to this endpoint:
build 22 (lane-b `src/lib/api.ts` `iosSite` posts `{transactionId}` only), and neither does the app's own
plan-fix branch (`~/abi-planfix/src/lib/api.ts:208-213`). Callers that break:
- Restore (`src/lib/account.ts:361`) -> 401 for everyone, including the real owner A.
- Admin-edit sync (`src/lib/adminSync.ts:178`) -> fails silently, so admin edits are never adopted.
- Take site offline with a site on screen (`src/lib/account.ts:488`): the `iosSite` pre-check throws, so the user cannot take the site down from the app.
Publish is less affected: build 22 sends the bearer on `/api/ios/publish` when signed in. A signed-out
publish on a linked purchase now gets 401 (`publishFlow.ts:238-241`), which is intended.
Fix, either one:
(a) Ship an app build that sends the bearer on `iosSite` and handles 401/409 `purchase-other-account` first, then deploy the server.
(b) Compatibility window in `runIosSiteLookup`. With no bearer: if `row.user_id` is set, or `bindingOwner(row)` is non-null, return 401. Otherwise keep the old 200 for unlinked, unowned rows (that is today's exposure, no new leak). With a bearer: the new rules.
Do not ship a mode where no bearer still returns a linked site. That is the cross-account copy bug this PR fixes.

**H2. `/api/shop/setup` is an untouched bypass of the new rules.** `lib/bookings/ownerFlow.ts:162-170`:
- It never calls `bindingOwner`. B (same Apple ID, second email) can POST setup with the transactionId of an unlinked purchase whose slug is bound to A's shop or site. B gets linked, which `refreshPlan` (`planFlow.ts:181-187`) now refuses.
- `setUser` is unconditional (`purchases.ts:215`). It can overwrite a link that a concurrent publish or Restore just set, which re-points a subscription that must never move.
- It links the user BEFORE `setShopOtid` (`ownerFlow.ts:215`). A 'taken' 409 then leaves the purchase linked to the loser, which is the exact bug this PR fixed in plan POST.
Fix: apply the same rules as `refreshPlan`: the `bindingOwner` check, then shop link first, then `setUserIfUnlinked`. Return 409 `purchase-other-account` when the conditional update loses.

**H3. `refreshPlan` still uses the unconditional `setUser`** (`lib/ios/planFlow.ts:206`). The row is read at `:174`. If a publish or lookup links the same otid to another account (via `setUserIfUnlinked`) between that read and `:206`, the link is overwritten. The shop's unique `ios_otid` does not guard this, because the publish path does not touch `ab_shops`.
Fix: `setUserIfUnlinked`. On false, re-read the row and return 409 when it is someone else's (the builder's open item #5; it should be done now).

## Medium

**M1. A publish with no bearer on an unlinked purchase skips the ownership check entirely** (`publishFlow.ts:245`: the `else if` requires `caller`).
Any unlinked row with a bound slug can be force-republished by whoever holds the transactionId with no account. This includes a row whose `bindingOwner` is A: legacy rows the backfill missed, and rows bound before A's shop or sites row existed. Today that is the same Apple ID, so it matches the old behaviour.
Fix: in the no-bearer branch, if `row.site_slug && bindingOwner(row)` is non-null, return 401. A true no-account first publish (no slug, or no owner) still fresh-binds, so freshBind keeps working.

**M2. Backfill 3b and runtime `liveBindingOwner` trust `sites.deployed_url`, which the Restore-copy bug polluted** (migration `:34-48`, `ownership.ts:155-159`).
Example: Jack's site was copied into ibrahim3709's sites row 115e0369.
- When the real buyer also has a sites row at that URL: ambiguous, left unlinked. Correct.
- When the buyer published with no account, or their row has a custom-domain URL: the copy victim is the only match and is linked permanently. Under "never movable" only manual SQL can undo that.
Fix: before applying, run 3b's inner SELECT as a preview, and hand-check each row against `sites.created_at` vs `ios_purchases.published_at` (or drop 3b and rely on V2 review).
For the QA otid 2000001256297137 this is moot: step 3a (shop `ios-test-jacks-barbershop`, owner b6c109a3) runs first. ibrahim3709 (e3f90927) gets nothing. V3 will list row 115e0369 as a conflict: expected, and cleaned per plan step 6.

## Low

**L1. Tier gates don't check who the purchase is linked to.** The plan view (`planFlow.ts:84-88`) and the gates in `lib/bookings/core.ts:176-198` grant tiers from `shop.ios_otid` without checking `purchase.user_id == shop.owner_id`. A legacy shop whose purchase is linked to another account keeps the tier, while `purchaseAccount` says 'other'. Run V4 after applying. Optionally treat 'other' as all-false.

**L2. `GET /api/shop/plan?otid=`** (`planFlow.ts:118-128`) tells any signed-in user whether any otid is linked to them, to someone else, or to nobody. No email is returned and otids are not public, so this is a minor existence check. Consider rate-limiting it or only answering 'self'/null.

**L3. The masked hint (`ownership.ts:103`) shows the full domain.** For a business address (jack@jacksbarbers.com) the domain names the shop. The requester must hold a valid Apple transaction plus any account, so in practice it is the same Apple ID holder. Acceptable. With a one-letter local part, the hint is the whole address. No user id or site data leaks in any 409 body. Ambiguous owners get a null hint. Good.

**L4. 402 for an inactive purchase comes before the ownership 409** (builder item #4). That is fine: nothing is written either way.

## Checked and correct
- **Migration 018** is additive and idempotent:
  - `add column if not exists` is a no-op (003 created the column).
  - The new index is non-unique and partial, so no unique constraint can fail. A plain CREATE INDEX on a small table locks it only briefly.
  - Both UPDATEs only touch rows with `user_id is null`, so they never re-point a link.
  - 3a is unambiguous (`ab_shops.ios_otid` is unique).
  - `count(distinct)` ignores null `sites.user_id`.
  - RLS stays enabled from 003 with no new policies or grants.
  - No drops or deletes.
- **B reading A's site:** lookup requires a bearer and `user_id == caller`. Unlinked rows need proof via `bindingOwner === caller`. Otherwise 409 with no site data.
- **B publishing onto A's slug when the purchase is linked:** no bearer gets 401, another account gets 409, before any bind, pending write or deploy. Only `upsertVerified` runs first (Apple truth, harmless).
- **B racing a claim:** in publish and lookup, `setUserIfUnlinked` plus a re-read gives exactly one winner (except via H2/H3).
- **Replay:** there is no client JWS. The server re-verifies the transactionId with Apple every time, so a stale id only returns the current Apple state. Revocation-time ordering (`checkedAt`) is unchanged.
- **Lapse, refund, revoke:** sweep and notification code is untouched and keyed by otid/slug. A lapse takes down only the site bound to that purchase and locks the linked shop's tier. Renewal, or Restore under A (plan POST with `user_id == A`), unlocks it. B is refused throughout. Tests in `tests/e2e/ownership.test.ts` cover this.
- **Plan POST order:** the shop link now happens before the user link. 'taken' no longer leaves a stray link (except via setup, H2).
- **`purchaseAccount`:**
  - 'self'/'other'/null are correct.
  - The device otid's 'other' overrides the shop's 'self': intended copy, entitlements unaffected.
  - No shop returns 200 with everything false.

## Deploy order
1. Apply migration 018 now. It is safe with the current production code: old publish and site lookup ignore `user_id`, and old plan/setup already honour it the same way. Then run V1–V4 and resolve the V2/V3 rows by hand.
2. Fix H1–H3 (and M1) on this branch.
3. Ship the app build that sends the bearer on `iosSite` and handles 401 and 409 `purchase-other-account` / `reason`.
4. Deploy the server: right after that app is live, or straight away with the H1(b) compatibility window.

Without H1(b), deploying the server before that app build means build 22 has no working Restore, admin sync or take-offline pre-check until users update. There is no safe window in which build 22 keeps a working Restore for linked purchases: no bearer means the server cannot tell A from B. Plan for a forced update.
