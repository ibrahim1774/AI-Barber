# AIBarber web launch review — November 1, 2026

Status: client fixes deployed to the existing test project at https://prime-barber-app.vercel.app/app/. Public launch is not complete. No merge to main or iOS release deployment was performed.

## Verified checklist

Checked means directly tested and passed in the stated environment, not a guarantee of zero bugs.

- [x] Desktop preview header/title spacing at three desktop sizes; mobile geometry unchanged.
- [x] Site edits restore between clean desktop and mobile-browser sessions.
- [x] Booking creation, reschedule, Day/Week/Month views, and cancellation.
- [x] Rescheduled booking restores on a separate mobile-browser login.
- [x] Fresh generation, Stripe Sandbox checkout, automatic return and publish, and one paid checkout/one subscription.
- [x] Fresh real-email reset CODE, new password, password sign-in in two completely clean desktop/mobile contexts, and complete saved-site hash match.
- [x] Expired/used-link recovery screen.
- [x] Complete automated client/server suites and native public-config parity.
- [x] Temporary Supabase redirect cleanup verified against the original five entries.
- [ ] Fresh real-email LINK path on this final build (Claude's prior successful link test is recovered evidence only).
- [ ] Current physical iPhone/Safari/Add to Home Screen.
- [ ] Offline upload guarantees and same-field concurrent-edit preservation.
- [ ] Full web/iOS data isolation: shared deletion and draft source remain design issues.
- [ ] Server preview deployment, published-site desktop correction, live Stripe and public launch.

## Changes saved for review

Server repository: https://github.com/ibrahim1774/AI-Barber.git, branch `web-app` (three local commits; push blocked by automatic approval review).

- `6d4f658`: deterministic first occurrence of repeated daylight-saving booking hours; regression test runs with both summer and winter server clocks.
- `b1e42c5`: /api/web-app/me prefers the retained active subscription and returns scheduled cancellation and period-end fields.
- `acd4dec`: desktop Luxe header/hero spacing; scoped to widths >=768px. Phone layout geometry is unchanged. Golden output fixtures were updated only for the intentional desktop CSS addition.

Client repository: https://github.com/ibrahim1774/aibarber-ios.git, branch `web`, local commit `a17c94f`.

- Explicit platform-specific action-sheet import fixes the calendar plus button, Settings action sheet, and product-photo options. The native wrapper re-exports the existing Apple action sheet; the web wrapper imports the browser menu directly. The previous web build threw `Cannot read properties of undefined (reading showActionSheetWithOptions)`.
- Scheduled cancellation display, desktop preview correction, and exact renderer provenance.
- Generated dist/ is ignored.

The staging client uses the corrected renderer. The server fixes have NOT reached its preview or production because their GitHub push was rejected. Published-site desktop output therefore still needs the server deployment.

## Verification

- Complete server suite: 189 suites; 4,556 passed, one skipped.
- Complete client suite: 229 suites; 3,712 passed. The existing suite leaves background handles open; final run used --forceExit after completion. Some existing teardown warnings remain.
- Focused client suite: 86 passed. Typecheck passed.
- Native public Expo config is identical to Claude's saved iOS baseline.
- Browser-tested at 1134x335, 1280x754, 1440x900, and 390x700: corrected desktop title does not overlap the header or clip; mobile geometry matches the baseline.
- Clean desktop and mobile-browser contexts with no local draft: edit made on desktop restores on mobile; mobile edit restores on desktop after reload. Original test-site name restored.
- Calendar: actual owner booking created on dedicated web test account 22, rescheduled 10:00 to 11:00, displayed in Day and Week; Month accessibility label reported one booking. Clean mobile-browser login restored the 11:00–11:45 time with no browser errors. Test booking cancelled afterward.
- Actual fresh site generation on dedicated account 974; Stripe Sandbox Checkout using a standard test card; return reached /app/live automatically; published site URL returned. Stripe read-back showed one active subscription and one completed paid checkout. Draft name persisted and no repeated payment banner appeared on the return to the editor. Deletion of the temporary account/site completed afterward; Stripe read-back confirmed zero active subscriptions and one cancelled sandbox subscription.
- Fresh password-reset code test: a new dedicated account 975 had a saved site before requesting the email. The owner supplied the emailed code. Reset completed in the browser; a generated private test password was then used through the normal sign-in UI in two completely clean desktop/mobile contexts. Both restored the entire saved site with a matching SHA-256 hash and no preloaded draft. No real customer password or iOS account was changed. The test account/site was subsequently removed.
- Expired-reset-link page manually displayed the friendly expired/used message. Claude's interrupted task logs independently recorded a real email-link reset completing successfully, including short-password and mismatch validation. This remains recovered evidence for the LINK path; the current session independently tested the real-email CODE path described above.
- Supabase migration 024 tables and columns were read back successfully using the service role.
- Removed only https://prime-barber-app.vercel.app/** from Supabase's redirect list. Reload verified exactly the original five entries and Site URL https://www.aibarber.org. Production reset addresses are covered by the existing wildcard; no production redirect addition is needed.
- Production /api/web-app/me returned 404. Vercel production environment-name inspection showed no WEB_APP_* or STRIPE_WEBAPP_* launch configuration and no CRON_SECRET. Do not infer secret values from redacted Vercel API results.

## Recommended decisions from Claude's checklist

- Alert inbox: propose the owner's primary Gmail, ibrahim3709@gmail.com, for operational alerts. Configure it at launch and verify delivery; it has not been set in production.
- Keep the App Store-linked checkout block, including lapsed links. Current shop gates follow ios_otid; accepting a web payment would not reopen those gates.
- Leave Stripe's account-wide single-subscription restriction off for this shared Stripe account. Keep the app-specific existing-subscription, in-progress-payment, and idempotency guards. Stripe's account-level restriction detects customers by customer object/email and is broader than this app: https://docs.stripe.com/payments/checkout/limit-subscriptions.
- Leave automatic duplicate refunds off initially; use alerts and manually review duplicates. This avoids automatic money movement during launch. Enable only after explicit review of the guarded refund rules and live operational delivery.
- Prefer Resend Pro before broader launch traffic because Free has a 100/day cap and Pro has no daily cap: https://resend.com/pricing. No paid plan upgrade was purchased.
- Keep the existing password policy during this web rollout; do not silently change shared authentication policy and affect iOS.

## Separation issues that still need a launch decision

The owner chose shared login with separate billing/app behavior. Billing uses separate web tables and Stripe metadata; iOS-linked purchases win their gates and block web checkout. However, the existing shared-account behavior is not complete data isolation:

- lib/webApp/deleteAccount.ts wraps the iOS global deletion flow, lists iOS sites as well as web sites, and eventually deletes the shared auth user. A web deletion on an account that also owns iOS data can affect iOS. Do not describe it as web-only deletion.
- The web client's account.ts still marks draft rows with source='ios' and can restore the same source rows. Existing RLS is per user, not per app. This is a shared-draft design, not independent app data.

No broad account/database migration or draft refactor was started, following the instruction to continue Claude's plan. These findings must be resolved or explicitly accepted before claiming web/iOS data isolation or launching publicly.

## Next steps in Claude's launch order

1. Approve uploading the exact reviewed feature-branch commits to the two GitHub repositories above. Automatic approval review rejected the server push as unapproved code egress to an unverified destination. Do not bypass the rejection using another deployment route.
2. Resolve the shared-account deletion/draft behavior above before any public launch.
3. Update the staging server preview, then verify the cancellation display and the published desktop renderer against the deployed server commit.
4. Configure and verify CRON_SECRET before enabling production web jobs. All existing cron handlers must continue accepting Vercel's Bearer header: https://vercel.com/docs/cron-jobs/manage-cron-jobs.
5. Create isolated live web-app products/prices, portal configuration and signed webhook in the chosen Primehub Stripe account; preserve existing Stripe and Connect integration settings. Record object IDs without exposing keys.
6. Add production web-app configuration with launch flags initially off. Apply no additional migration until its exact schema state is checked. Migration 024 is already present.
7. Deploy reviewed server code with flags off, then deploy the web client to the existing /app destination and activate checkout/entitlement flags in the checked order. Keep automatic refunds off.
8. Run the approved production reset/payment/refund smoke checks and monitor webhooks, cron invocations and alert delivery.

## Limits

Desktop and emulated mobile Chromium were exercised; this is not a physical iPhone or Safari test. Add to Home Screen remains a real-device check. Offline edits cannot appear on another device until uploaded, and clearing local browser storage before upload can lose local-only data. Simultaneous edits to the same field use last-writer-wins; the merge tests cover different-field edits, not preservation of two conflicting values. No claim of zero bugs or universal data-loss protection is made.

## Additional save/publish edge-case audit

The successful browser tests cover the normal path. Source review subsequently identified launch-blocking reliability gaps that have not yet been fixed or each reproduced in a browser:

1. **Checkout proceeds without a confirmed durable save.** webAutosave.web.ts:38 resolves after five seconds and suppresses errors; web-paywall.tsx:109 then leaves for Stripe. Failed/slow saves can leave the latest draft only in browser storage. A new device or cleared storage can therefore lack the paid-for draft.
2. **Failed writes can advance the merge base.** syncIfSignedIn catches upload errors (account.ts:111); webAutosave.web.ts:71–73 nevertheless writes local data as the new merge base. A later merge can then treat an unsaved edit as already saved and replace it with the cloud value.
3. **Concurrent cloud writes have no conditional version check.** Autosave reads the row, merges, then account.ts:38 upserts the entire row. Two devices can both read the same old version and overwrite each other's different-field edits. The pure merge3 tests do not cover this read/write race.
4. **Resume is consumed before publish starts.** StripeReturn.web.tsx:59 clears the flag, then line 64 schedules publish 400ms later. Unmount cleanup clears that timer. Navigation/closing during that interval can leave a paid account without automatic publication until Publish is requested again.
5. **Payment and deployment are separate operations.** Closing Stripe after successful payment avoids the return-triggered publish. A later hosting deployment can also fail (publishFlow.ts:251–255). Stored ownership/pending data and retries help recovery, but successful payment alone does not prove the site is live.

Recommended next work: strict save acknowledgement before redirect; advance merge state only after a successful write; conditional versioned writes with retry/remerge; durable server-side publish intent and recoverable resume; explicit Saving/Saved/Retry status; and failure tests for network loss, timeout, tab closure and concurrent writes. Keep changes scoped to the web path and recheck the iOS baseline.


## Authorized reliability implementation — local checkpoint, November 1, 2026

The findings above describe the earlier implementation and deployed baseline. The local feature branches now contain the fixes described in WEB-RELIABILITY-ROLLOUT.md. They are opt-in and are not yet activated in staging or production.

| Check | Result and scope |
| --- | --- |
| Server full regression suite | Passed: 4,574 tests; 1 existing skip; 190 suites |
| Client full regression suite | Passed: 3,730 tests / 231 suites before the final editor/tab follow-ups |
| Final focused client checks | Passed: 46 tests / 5 suites, including the final editor replay, per-tab baseline and paid-resume fixes |
| Client TypeScript | Passed on the final implementation |
| Server TypeScript | Existing repository-wide errors remain; comparison with a clean HEAD snapshot found no new distinct errors before the final small follow-ups. Do not report a clean full server typecheck. |
| Native public Expo configuration | Exactly matches the previously saved iOS baseline |
| Web export | Builds with EXPO_WEB_EXPORT=1 and EXPO_PUBLIC_WEB_DRAFTS=1 |
| Local browser recovery | Simulated services: editor stays usable during a failed publish; two-device separate fields are preserved; failed-save edits stay local and upload after recovery; clean mobile context restores both edits |
| Local paid republish | Actual browser Publish action submits once, reaches the Live screen, and sends zero checkout requests (simulated payment/deployment services) |
| Desktop style/layout | Correct icon sizes, no header/title overlap and no horizontal overflow at 1280, 1920 and 2560 pixels. The giant icon seen during testing came from the test harness blocking the preview styling script; the harness was corrected. |
| Live schema / flags / Stripe test rollout | NOT performed for this implementation; migration 025 and matched staging rollout remain required |
| Legacy migration | Dry-run backfill script prepared. Ambiguous old source='ios' drafts are not blindly imported. Resolve this before enabling the rollout for affected accounts. |

All old assistant-created Supabase/Gmail/test contexts were closed. The final local browser harness closes its desktop/mobile windows in a finally block. No personal browser window is targeted.

Upload blocker: an earlier automatic approval review rejected pushing the server's private code to the GitHub remote because destination/payload upload was not explicitly authorized. No alternate deployment was used to bypass it. The reviewed destinations are https://github.com/ibrahim1774/AI-Barber.git (web-app branch) and https://github.com/ibrahim1774/aibarber-ios.git (web branch only; no iOS release branch). Staging verification remains pending that upload approval and the database rollout gates above.
