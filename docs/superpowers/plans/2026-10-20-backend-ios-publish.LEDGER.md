# SDD ledger — plan: /Users/ibrahim/aibarber-ios/docs/superpowers/plans/2026-10-20-backend-ios-publish.md

Spec: /Users/ibrahim/aibarber-ios/docs/superpowers/specs/2026-10-20-aibarber-ios-design.md
Worktree: /Users/ibrahim/aibarber-backend-ios (branch ios-backend from origin/main 1c74415), created by controller at setup.

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T4, T5 | `slugify` export, `publishSite(id,{force})`, `writePendingSite` | consistent |
| T2 → T5, T6 | `VerifiedTx`, `VerifyFailure`, `isActive`, `AppleDecode` | consistent; T6 reuses AppleDecode shape for decodeTransaction |
| T3 → T4 | `PurchasesRepo.slugTaken` → `makeIsTaken.repoTaken` | consistent |
| T3 → T5, T7, T6 | `get/upsertVerified/bindSlug/markPublished/setUser/unpublishedBound/applyNotification` | consistent |
| T5 ↔ T7 | T5 edits vercel.json `functions` incl. sweeper maxDuration | ok; T7 does not touch vercel.json |
| T9 ← all | env vars, preview, merge | controller-run (side effects outside worktree) |
| T1 self | tests vs code | consistent |
| T2 self | prod skipped when APPLE_APP_ID unset only in defaultVerifier; tests use makeVerifier | consistent |
| T3 self | Step 5 applies migration to shared production Supabase | see ruling 1 |
| T4 self | consistent |
| T5 self | status union lists 409 but no rule produces it | ruling 2 |
| T6, T7, T8 self | consistent |

Ruling: T3 Step 5 (apply migration to production Supabase `lyjruphvzfwbtzfwfvwm`) is done by the controller after T3's review, not by the implementer — keeps the one production-DB write with the controller; Ibrahim pre-authorised applying the migration — cost if wrong: none, the table is additive and unused until the endpoints ship.
Ruling: T5's unused 409 status may be dropped from the union — no rule in the plan produces it — cost if wrong: trivial.
Ruling: T9 (env vars, push, PR, merge, prod smoke) is run by the controller — side effects on shared Vercel/GitHub; Ibrahim pre-authorised merge after tests pass — cost if wrong: a bad merge is revertible via `git revert` + redeploy.
Ruling: vercel.json sweeper maxDuration 300 — if the Vercel plan rejects it at deploy, lower to 60 — cost if wrong: a failed preview deploy, caught in T9.

## Progress
Task 1: complete (commits 1c74415..b425251, review clean)
Task 1: minor (deferred): tests don't unstub fetch / restore GCS env between files
Task 1: minor (deferred): no test that a 200 without the marker still deploys
Ruling: Task 2 maps an Apple-response decode failure to 'apple-unavailable' (503) — the server fetched that payload from Apple itself, so a decode failure means misconfiguration (certs/app id), not a forged purchase; 503 makes the app retry — cost if wrong: a misconfigured verifier shows "try again" instead of an error until fixed.
Ruling: Task 5 (owner of vercel.json) adds `includeFiles: "lib/ios/certs/**"` for api/ios/publish.ts, api/ios/site.ts, api/ios/apple-notification.ts and api/publish-sweeper.ts — Task 2 flagged it; without it defaultVerifier can't load root certs on Vercel — cost if wrong: caught by T9 smoke.
Task 2: fix round 1/5 (1 important + 4 minor addressed, 0 open — library VerificationException mapping; commits 54b2658..f1e2c21)
Ruling: Task 2 INVALID_APP_IDENTIFIER → bad-bundle, INVALID_ENVIRONMENT → not-found fall-through, other verification failures → apple-unavailable (supersedes the earlier blanket ruling) — reviewer showed bad-bundle was unreachable — cost if wrong: small.
Task 2: complete (commits b425251..f1e2c21, review clean)
Task 2: minor (deferred): defaultVerifier's VerificationException mapping has no direct test (needs mocking SignedDataVerifier)
Task 3: fix round 1/5 (2 addressed, 0 open — env CHECK vs IosEnv type; expires_at null wipe; commits 7a61bd2..a3ac9f8)
Ruling: keep the migration's CHECK (environment in Production/Sandbox); applyNotification takes IosEnv, so Task 6 must skip Xcode/LocalTesting notifications — cost if wrong: Apple test-environment notifications are ignored (harmless).
Task 3: complete (commits f1e2c21..a3ac9f8, review clean)
Task 3: minor (deferred): migration not idempotent (CREATE TABLE without IF NOT EXISTS) — matches 001 convention
Controller: migration ios_purchases applied to lyjruphvzfwbtzfwfvwm via MCP apply_migration (success).
Task 4: complete (commits a3ac9f8..1990f41, review clean)
Task 4: minor (deferred): urlServes fails open on network error (repo + pending checks are authoritative); doesn't cancel response body; no abort test
Ruling: Task 5 — drop unused 409; pending+repo slug checks authoritative (urlServes fails open); vercel.json functions block with includeFiles lib/ios/certs/** + maxDuration (publish 60, sweeper 300 unless set in code); userId only drives repo.setUser; bind-race loser uses winner's slug without force; unexpected repo/GCS errors → 503 — cost if wrong: small, all reviewable in T5 diff.
Ruling: Task 5 setUser is best-effort (non-UUID skipped, errors logged) — a bad optional userId must not fail a paid publish — cost if wrong: an iOS purchase may lack its user link (only used for account features later).
Ruling: Task 5 markPublished failure after a live deploy still returns 200 — retrying would force a redeploy; sweeper repairs the row — cost if wrong: sweeper republishes once (idempotent).
Ruling: Task 5 apple-notification functions entry deferred to Task 6 (Vercel rejects patterns that match no file).
Ruling: Task 5 data-URL rejection must not reject ordinary text containing "data:" — reject only string values that START with "data:" (any depth) — the brief's literal substring check would 400 a bio like "Metadata: ..." — cost if wrong: none.
Ruling: Task 7 must treat a bound, unpublished row whose pending file is missing as its own case (publishSite → no-backup): log it loudly, skip it, and do not count it as a retryable failure forever — reviewer found writePending can fail after bindSlug — cost if wrong: such a buyer needs a manual republish (the app also retries with its own content).
Task 5: minor (deferred): chooseSlug worst case 6×8 s urlServes can eat the 60 s budget; deploy worst case exceeds 60 s (timeout recoverable via sweeper once bound)
Task 5: minor (deferred): stale deployedUrl in pending file after a failed republish can make the sweeper's non-force publish treat old content as live
Task 5: minor (deferred): userId unauthenticated — anyone with a transactionId can re-point user_id
Task 5: fix round 1/5 (1 important + ruling + 3 minor addressed, 0 open — shape validation before verify, data-URL walk, republished flag, injected clock, handler tests; commits fb99757..eb99695)
Controller check: WebsiteData (types.ts) declares hero, about, services, gallery as required — new validation matches web-generated data.
Task 5: complete (commits 1990f41..eb99695, review clean)
Ruling: Task 6 — only Production/Sandbox reach applyNotification (others 200 ignored); prod-then-sandbox notification verification; other bundles / no signedTransactionInfo → 200 ignored; REFUND/REVOKE → revoked; DB errors after valid signature → 500 so Apple retries; vercel.json gets the apple-notification includeFiles entry — cost if wrong: small.
Ruling: Task 6 Production verifier needs APPLE_APP_ID — set to 6825001790 in Task 9 env vars (Preview + Production).
Task 6: complete (commits eb99695..aff4ca1, review clean)
Task 6: minor (deferred): every decode failure → 400 bad-signature with no logging (config errors look like bad input); no tests for bad-transaction path, tx.bundleId mismatch, liveNotificationDeps/signedDataVerifierFor fallback; test file mocks then importActual with misleading alias
Task 6: minor (deferred): out-of-order notifications can move expires_at backwards (no ordering guard)
Ruling: Task 7 — no-backup rows reported as 'missing' (logged, not failed); default limit 50 (brief said 20) to limit starvation; per-row errors isolated; iOS branch failure never breaks the Stripe branch's response; expired-but-paid rows still published — cost if wrong: small.
Ruling: Task 7 — supersede ruling 4: iOS sweep moves to its own cron function api/ios/sweep.ts (*/10, maxDuration 300); publish-sweeper.ts reverted except authorized() moved to lib/cronAuth.ts; sweepIos gets a 200 s start-deadline with `deferred` — reviewer showed shared 300 s budget and Stripe early-exits skipping iOS repairs — cost if wrong: one more cron slot on the Vercel project (Pro allows 40).
Task 7: minor (deferred): head-of-line starvation if ≥50 missing/failing rows accumulate (needs a retry cursor/backoff column)
Task 7: fix round 1/5 (2 important + minors addressed, 0 open — own cron api/ios/sweep.ts, 200 s deadline/deferred, test hygiene; commits cb0fccf..9310969). Controller verified: vitest 123/123, vercel.json parses (2 crons, 4 function entries).
Task 7: complete (commits aff4ca1..9310969, review clean)
Ruling: Task 8 — order token→sites→(users_profile if no cascade)→auth user; 401 for any token problem with nothing deleted; post-token failures 500 delete-failed; user id only from the token — cost if wrong: small.
Controller check (live DB lyjruphvzfwbtzfwfvwm): every FK to auth.users is ON DELETE CASCADE or SET NULL (client_sites.owner, ios_purchases.user_id, auth.scim_users = SET NULL); deleteUser cannot be blocked by an FK.
Task 8: complete (commits 9310969..ab6a70b, review clean)
Task 8: minor (deferred): handler wiring on a valid token and handler catch path untested (lib logic tested); comment the deleteSites-ok/deleteUser-fail retry window
Task 9 (controller): env vars APPLE_IAP_KEY_ID/ISSUER_ID/BUNDLE_ID/APP_ID/PRIVATE_KEY added to Production+Preview; branch pushed; preview https://prime-barber-hym473fld-ibrahims-projects-e5ab879e.vercel.app READY (no deployment protection).
Task 9 smoke (preview): publish fake tx → 404 not-found (Apple lookup works, 0.3 s); publish data URL → 400; site fake tx → 404; notification junk → 400 bad-signature; ios sweep unauth → 401; web create-checkout-session → clientSecret (web path intact).
Final review (opus): With fixes — C1 Vercel-project collision, I1 publish maxDuration, I2 renewals/grace via getAllSubscriptionStatuses, I3 deploy throttle, M1-M5.
Ruling: fix C1, I1, I2, M1, M2, M3, M4 in one fix wave before merge — C1 breaks a non-negotiable, I1 is a documented failure, I2 blocks the app E2E, the M's are cheap — cost if wrong: one extra fix cycle.
Ruling: I3 (per-purchase deploy throttle, needs a column) deferred as a PRE-LAUNCH item — no client calls these endpoints yet — cost if wrong: a looping client could burn Vercel deploy quota until added.
Ruling: M5 — before deleting any ios-test-* Vercel project, confirm its ios_purchases.environment = 'Sandbox'.
Ruling: unauthenticated userId acceptable only while nothing reads ios_purchases.user_id for authorization/display (record for app plan).
Final fix wave: DONE (commits ab6a70b..028f072; vitest 184/184; tsc 3760).
Ruling: I2 — no status entry from getAllSubscriptionStatuses → fail closed (503, app retries) — Apple always returns an entry for a real auto-renewable transaction — cost if wrong: a rare transient 503.
Ruling: C1 projectExists uses VERCEL_TOKEN without teamId, matching deployToVercel — mis-scope fails closed (503), never a collision.
Final: minor (deferred): stored product_id is from the proven transaction, not the latest (monthly→yearly switch shows old product; no auth impact).
Final fix wave re-review (opus): all addressed, no new Critical/Important (commits ab6a70b..028f072).
Final: minor (deferred): latest-transaction productId not re-checked against IOS_PRODUCT_IDS (only matters if a non-hosting product joins the group); missed REFUND_REVERSED leaves row revoked for the sweeper (sync publish still works); TOCTOU between projectExists and deploy.
Task 9: complete — PR #234 squash-merged (b0ac3c4), production READY, live smoke clean (2026-10-20).
