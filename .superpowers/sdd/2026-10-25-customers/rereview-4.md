# Re-review 4: 6cdc643 (R1 from rereview-3.md)

This was a read-only review of `git show 6cdc643`. The accountSwitchFixes and publish suites pass: 2 suites, 52 tests. As asked for this last round, I only looked for two kinds of issue: a paid publish that gets dropped, and one account overwriting another account's live site.

**Verdict: fix first.** One small fix is needed. The resume path is fixed, but a Publish tap can still drop the same paid record.

## R1 on the resume path: closed

- `boundElsewhere` now returns `'none'` for a 404, a `no-site` answer or an empty `siteId`. `checkBound` turns that into `'fresh'`, and `publishFlow` stores `target.freshBind: true` before sending.
- On resume, `freshBind` skips the ownership check. The send goes ahead and the record is kept on failure. The new test covers this: a 502 after the bind, then a resume that sends again.
- **Can this let one account overwrite another's site?** No. `freshBind` is set only after a clean 404 for this transaction at pay time. The server publishes only to the slug bound to the transaction, so the slug a fresh record can reach is the one its own send bound. Switching accounts throws while anything is pending (`account.ts:204`). Restore brings back the site this Apple ID is bound to, which is the same slug. I found no path where a `freshBind` record publishes over a site it didn't bind.
- **N1 and N2 are intact.** A record without `freshBind` still checks against `pending.target`. A pay-time answer of `true` still blocks and drops the record, and the new cross-account test covers this. N2 has no changes.
- **Offline, and check-error fail-closed.** `checkBound` still returns `'unknown'` when the check throws. In `publishFlow` that keeps the paid record (the paid case) or shows CHECK_FAILED_MESSAGE (the entitled case). Resume keeps the record. Fail-closed now applies only when the record has no `freshBind`, which is the case where another account could be involved.
- **A→B→A.** Nothing changes from round 3. The target and `freshBind` travel with the record, and account switches are refused while a publish is pending.

## R1b. HIGH (fix first): tapping Publish after a failed first send can still drop the paid record

This is R1 again, reached through `publishFlow` instead of resume. The `freshBind` flag is read only in `resumePendingPublish`. `publishFlow` never looks at the pending record that already exists, and it overwrites that record when the user has paid in the same call.

1. The first publish runs. `guard` is `'fresh'`, the server binds `cuts-xyz`, and the send then fails with a 502 or a lost response. The record is saved with `freshBind: true`.
2. The user taps Publish again while `hasEntitlement()` is false. The `entitled` mirror updates from Superwall's `subscriptionStatus` in an effect. It is false on a cold launch until Superwall reports ACTIVE. It also stays false if the product-to-entitlement mapping does not include `hosting`, `bookings` or `store`.
3. `showPaywall()` resolves `'purchased'` for a subscriber who already has a transaction. That happens when the placement is skipped and `verify` finds the transaction, or when the user restores. So `paid = true`.
4. The `savePendingPublish({... target: targetOf(site)})` call before the check replaces the record, and the new record has no `freshBind`.
5. `checkBound` returns `blocked`, because `cuts-xyz` is bound and the local site has no slug. Since `paid` is true, `savePendingPublish(null)` runs, the record is dropped, and the user sees "different website". Every later tap is blocked the same way. The site never goes live, even though the user paid.

When `hasEntitlement()` is true, the tap shows the wrong "blocked" message, but the record is kept and the next resume sends it. No money is lost on that path, but the message is wrong.

**Fix (small).** At the start of `publishFlow`, load the existing pending record. If it has `target.freshBind` and the same `draftId` as `site`, take one of these routes:
- (a) Preferred: hand the tap to the resume logic and send the stored record with no check. That is what resume already does.
- (b) Minimum: never overwrite or drop that record in this flow. Carry `freshBind` into the record saved before the check, and treat `guard === 'blocked'` as `'ok'` when that flag is present.

Add a test: a first publish fails with a 502 after the bind. Next, call `publishFlow` again with `hasEntitlement: false`, `showPaywall: 'purchased'`, and a `boundElsewhere` that sees the new slug. The result must not be `blocked`, and `iosPublish` must be called a second time (or the record must still be there).

## Checked and fine
- `boundElsewhere` has one caller (`checkBound`). Its `'none'` result is handled before the truthiness test.
- In `publishFlow`, the `'unknown'` and `'blocked'` paths do not overwrite the record when the user did not pay in this call, so an entitled re-tap leaves a `freshBind` record alone.
- `send` on success writes the slug into the current local site and clears the record. After that, Publish goes through `slug != null`, which returns `'ok'`.
