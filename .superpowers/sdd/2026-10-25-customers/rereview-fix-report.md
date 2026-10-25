
## Re-review ship-blockers 1 and 2

- Blocker 1: BOUND_ELSEWHERE_MESSAGE no longer mentions Restore. `restore()` (account.ts) now gives the restored site a fresh draftId when the local site belongs to the signed-in account, so it can no longer overwrite that account's row. Settings E3 copy not done.
- Blocker 2: publish guard (`checkBound` in publish.ts) fails closed. A thrown check returns 'pending' and keeps the paid record. The paywall check treats ApiError 404 / no-site as not bound. `resumePendingPublish` now runs the same check against the stored site: blocked drops the record, an error keeps it, and neither sends.
- Tests added in `__tests__/accountSwitchFixes.test.ts` (4). tsc clean; full jest 139 suites, 1926 tests pass.

## Re-review 2: N1 and N2 (root-cause fix)

- N1: a pending publish now stores `target` (draftId, slug, deployedUrl, owner) of the site it was paid for. The launch retry checks that snapshot through the same `checkBound` as publishFlow, so Restore swapping the local site no longer turns the guard off. No target and no local site fails closed (kept, not sent).
- `checkBound` now covers every site without a slug (owned or not), not only owned ones. A guard that is not wired in test doubles counts as ok; `usePublishDeps` always wires it.
- N2: `restore()` keeps the draft id only for a never-owned, unpublished draft (`!ownerUserId`); anything an account owns gets a new id, signed in or not.
- N4: an entitled republish whose check failed now says to try again (CHECK_FAILED_MESSAGE). N3 covered by the fail-closed retry. Legacy pending records (no target) are checked against the current site.
- Tests added (4) in `__tests__/accountSwitchFixes.test.ts`. tsc clean; full jest run once.

## Re-review 3: R1 (paid first publish dropped)

- `boundElsewhere` now answers true (different site), false (this site) or 'none' (nothing bound, 404). `checkBound` maps 'none' to 'fresh'.
- On 'fresh' the pending record stores `target.freshBind`. A retry of that record skips the ownership check, so a slug the server bound during a failed send is accepted as this payer's own: it sends again or stays pending, never blocked.
- Cross-account case unchanged: an already-bound different site still blocks, and a thrown check still fails closed. N1/N2 and A→B→A untouched.
- Tests (2): first publish with no account, failed send, retry succeeds; cross-account overwrite still blocked. tsc clean; full jest 139 suites, 1932 tests pass.

## Re-review 4: R1b (re-tap dropped the freshBind record)

- `publishFlow` now loads the existing pending record first. If it has `target.freshBind` for the same draft (`carry`), the paywall-time save keeps its transactionId and `freshBind`, the ownership check is skipped when the transaction matches (`owned`), and the pre-send save keeps `freshBind`. A re-tap with entitlement false therefore sends instead of being blocked.
- On `blocked` (confirmed foreign owner for a different transaction) the carried record is restored rather than nulled.
- Audit of every clearer: send success / 402 / 400 / 409 (final answers), resume expiry / no-subscription / blocked (resume skips check for freshBind), `adoptAndSave` (server already holds the live site, copy newer), `deleteLocalData` (explicit user delete), `switchAccountSite` (throws first if any pending exists). No re-tap, failed read, or new attempt clears it now.
- Tests (5) in `__tests__/accountSwitchFixes.test.ts`: re-tap with entitlement false completes, failed re-tap keeps record, failing ownership check, failing transaction lookup keeps record, entitled re-tap. N1/N2/R1/cross-account tests still pass. tsc clean; full jest 139 suites, 1937 tests pass.
