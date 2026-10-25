# Re-review 2: eef7738 (the two ship-blockers from rereview.md)

This was a read-only review of `git show eef7738` in /Users/ibrahim/abi-e2e. Targeted jest passes: accountSwitchFixes, publish, restoreFlow and account, 4 suites and 103 tests. I did not run it on a device. I checked the server side against `/Users/ibrahim/aibarber-bk/lib/ios/publishFlow.ts`.

**Verdict: fix first.** Each blocker is closed for the exact path it named. One new combined path still lets B's paid content publish over A's live site (N1). Blocker 1 is also still open when Restore runs while signed out (N2).

## Blocker 1: Restore overwrote B's site with A's

| Case | Result |
|---|---|
| B signed in, local is B's account site, no deployedUrl | **Closed.** `keepDraftId` is false because the owner is the current uid, so the site gets a new `randomUUID()`. `syncIfSignedIn` inserts a new row, and B's own row is left alone. |
| Message pointed users to Restore | **Closed.** BOUND_ELSEWHERE_MESSAGE no longer mentions Restore. |
| Signed out, legacy unowned draft | The draft id is kept, as intended (photo folder key). |
| **Signed out, local still owned by A** | **Still open (N2).** |
| A→B→A | No overwrite found. B's Restore creates a new row in B's account. Sign-out pushes it and clears the phone. A's sign-in pulls A's own newest row. |

## Blocker 2: the publish guard failed open, and the launch retry skipped it

- **Fails open: closed.**
  - `checkBound` returns `'unknown'` when the check throws.
  - `publishFlow` keeps the paid record with its transactionId and returns `pending`. It does not send.
  - `boundElsewhere` treats only a 404 as "not bound". The server's 404s are `no-site` (no slug bound) and `not-found` (Apple doesn't know the transaction, so the publish would 404 too). Neither can reach another account's site.
  - A network error (status 0), a timeout or a 5xx all throw, so the guard fails closed.
- **Resume skipped the guard: closed for the scenario as written.** `resumePendingPublish` now checks the current site record after the transaction id lookup. If the check comes back blocked, the pending record is dropped. If it is unknown, the record is kept and the retry runs later.
- **Paid pending publish is not lost on a check error.** It is kept in both paths. It is dropped only on a definite `blocked`. That is the item 3 cost, which was known and is not a blocker.

## New or remaining findings

### N1. HIGH (must fix): Restore while a pending publish exists turns the resume guard off, so B's paid content overwrites A's live site

The resume guard checks the site record as it is when the retry runs, not the site the pending publish was paid for. `restore()` deliberately leaves the pending record alone. It also replaces the local site with the Apple ID's bound site, which has `slug` set, and `checkBound` returns `'ok'` for any record with a slug.

Scenario:
1. A's subscription has lapsed. B is signed in on A's phone and pays.
2. Superwall lags, so the pending record is saved with `transactionId: null`, and the screen shows UNCONFIRMED_MESSAGE. That message says "tap Publish again in a minute **or use Restore Purchases**". An `/api/ios/site` 5xx after paying leads to the same state.
3. B taps Restore (Settings, /start or the lapsed Edit card). `restore()` swaps in A's site: new draftId, owner B, `slug` = A's slug. The pending record still holds B's content.
4. On the next foreground or launch, `resumePendingPublish` finds the transaction, and `checkBound(cur)` sees a slug and returns `ok`.
5. `send(pending.data)` publishes B's content to A's live slug. `syncQuietly` only drops a pending record when there is a newer admin edit, so it does not stop this.

Fix, any one of:
- (a) In `restore()`, when the result is not `sameSite`, drop the pending record or refuse the restore while a pending record exists. The comment "paid content for this same subscription" stops being true once the local site is swapped.
- (b) Store whether the paid-for site was an account site or a slug site (its `slug` and `ownerUserId`) on the pending record. Run `checkBound` against that stored copy, not `loadSite()`.

Option (b) is the more robust fix. Either way, add a test: pending with no transaction id, then Restore swaps the local site, then resume must not send.

### N2. MEDIUM-HIGH: a signed-out Restore still keeps an owned draft's id

Sign-out keeps the local site when `pushSiteBeforeSignOut` returns false (offline, or a pending publish), so the site stays with `ownerUserId = A`.

A Restore made while signed out then runs with `uid` undefined, so `keepDraftId` is true. The restored site (the Apple ID's bound site) keeps A's account row id, and its `ownerUserId` is removed.

What happens next:
- **If A signs in:** `switchAccountSite` returns `same` because the site has no owner. The sync then overwrites A's account row with the restored site. That is the original blocker 1, reached through a different path.
- **If B signs in:** the upsert hits A's row, RLS rejects it, and the sync fails every time.

Fix: keep the draftId only for a never-owned draft, `keepDraftId = !!local && !local.deployedUrl && !local.ownerUserId`. That also covers the signed-in case.

### N3. LOW: resume fails open when there is no local site
`if (cur) { ...guard }` skips the check and sends when `loadSite()` returns null while a pending record exists. That combination should be rare, since `clearSiteAfterSignOut` only runs when nothing is pending. Fail closed instead: keep the pending record, or drop it.

### N4. LOW (copy): an entitled republish whose check failed shows UPDATING_MESSAGE but saves nothing to retry
When `paid` is false and the guard is `unknown`, the user sees "We'll finish publishing it shortly", but no retry is queued. This is safe. The message is wrong: it should say to try again.

### N5. LOW (note): Restore while signed in as B copies A's live site into B's account
The new row includes A's `deployed_url`. That is consistent with "a restored site belongs to the account signed in now", and the Apple ID holder controls the site anyway. Confirm that the web dashboard cannot redeploy or attach a domain to a `sites` row it doesn't hold the subscription for.

## Checked and fine
- No new path lets a site with a slug publish over a different site. The server publishes only to the slug bound to the transaction.
- A failed `getSession` in `restore()` leaves `uid` undefined, so the record is unowned. That is the same behaviour as before, apart from N2.
- Blocked in resume drops the pending record. Unknown in resume keeps it.
