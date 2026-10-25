# Fix report: stream E and stream D reviews (branch e2e-pressure, not pushed)

tsc clean; full jest 139 suites / 1922 tests pass. One commit per review.

## Stream E (commit "Account switching: ...")
1. sign-up skips switch: FIXED. signUp routes through afterSession. Test in accountSwitchFixes.
2. sign-in wipes unsynced edits / paid pending: FIXED. New SiteRecord.accountSyncedAt; switchAccountSite refuses (UNSAVED_OTHER_ACCOUNT message, signs out again, A kept) when edits are unsynced or a publish is pending; pushSiteBeforeSignOut now syncs before the pending check. Tests.
3. B's site publishes over A's live site: FIXED for publish. publishFlow asks boundElsewhere (api.iosSite + boundMatches) for slug-less account-owned records and returns 'blocked' (new screen state) without sending. Tests. NOT done: Restore-while-B-signed-in stamping, and the Settings copy for Gap 3 (product decision, skipped).
4. timeout races switch: FIXED. Generation token checked before any write; signOut/timeout bump it. Test.
5. reset burns code: FIXED. Password is set first, account switch runs last (identify still at verify). Test.
6. live.tsx domain box: FIXED (known && !hasDomain). Test. Colour nits left.
7. reminders survive switch: FIXED (cancelAllReminders on switch and on sign-out clear).
8. booking push token on sign-out: SKIPPED, needs a server delete-token endpoint in AI-Barber.
9. sign-out overwrites newer web edit: FIXED (pull before push).
10. empty-account notice lost on Bookings return: FIXED (alert shown before leaving). No dedicated test (hook UI).

## Stream D (second commit)
1. Owes counts refunded orders: FIXED (owedCents on StoreCustomer). Tests. Detail "Order total" left as is.
2. Old buyers stay after switch/failure: FIXED in useStoreCustomers and Bookings useCustomers (shown-shop ref). Test (store).
3. Bookings header 375pt: FIXED (icons dropped at width <= 380, tighter padding, maxFontSizeMultiplier 1.4). Test. Not checked on a simulator.
4. >1000 items truncation / quadratic grouping: FIXED (batches of 100, fetchAllPages, Map). Test.
5. refetch on every focus: SKIPPED (cost note only).
6. customer id can change: SKIPPED (low, no PII).
7. tour copy: SKIPPED (G1 scope).
