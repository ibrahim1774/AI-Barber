# Re-review 3: 0354064 (N1 and N2 from rereview-2.md)

This was a read-only review of `git show 0354064` in /Users/ibrahim/abi-e2e. The targeted jest run passes: accountSwitchFixes, publish, restoreFlow and account, 4 suites and 107 tests. I checked the server side against `/Users/ibrahim/aibarber-bk/lib/ios/publishFlow.ts`.

**Verdict: fix first.** N1 and N2 are both closed. The commit also widened `checkBound` so it now runs on never-owned drafts. That opens a new money-losing path on the most common route, which is a first-time publish that fails part-way (R1).

## N1: Restore while a paid publish is pending: closed

- Every `savePendingPublish` in `publishFlow` now stores `target`, which is the paid-for site's `draftId`, `slug`, `deployedUrl` and `ownerUserId`.
- Resume builds the site to check from `pending.target` over the current record, so a site that Restore swapped in can no longer turn off the check. The new test covers this: transaction id null, then Restore, then resume returns blocked and sends nothing.
- If the pending record has a target but there is no local site, the check still runs on the target. N3 is fixed: when there is neither a target nor a local site, resume returns `pending` and does not send.
- Offline: `loadSite` failing is caught, and an exception from `boundElsewhere` gives `unknown`, so the record is kept. A failed transaction id lookup also keeps the record.
- A→B→A: the target travels with the record, so later account switches don't change what gets checked. No overwrite path found.
- **Older records without `target`** fall back to the current site, which is the old behaviour. N1 is still reachable for a record created before the update and then followed by a Restore. LOW: this is a one-time window during upgrade. To close it, fail closed (keep the record, don't send) when there is no target and `cur.slug` is set but `cur.transactionId` differs from the pending transaction id. You could also just accept the risk.
- N4 copy is fixed: an entitled republish whose check fails now shows CHECK_FAILED_MESSAGE.

## N2: signed-out Restore of an owned draft: closed

`keepDraftId = !!local && !local.deployedUrl && !local.ownerUserId`. A draft that A owns and that is restored while signed out gets a fresh `randomUUID()` and no owner. When A signs in, `switchAccountSite` returns `same` and the sync inserts a new row, so A's original row is never written. A never-owned draft keeps its id, which is the photo folder key. Tests cover both cases.

## R1. HIGH (must fix): the widened check blocks and drops a paid first publish whose send failed after the server bound the slug

Before this commit, `checkBound` only ran for `slug == null && ownerUserId`. It now runs for every site without a slug, which includes the signed-out first-time payer. That is the main funnel.

The server (`runIosPublish`) runs `bindSlug` and `writePending` before `deps.publish`. So a 502 `publish-failed`, a 5xx, a timeout or a lost response can all leave the transaction bound to a new slug while the app still holds `target.slug = null`.

1. A first-time payer is on a draft with no slug. `publishFlow` runs `checkBound`, gets a 404 `no-site`, and the result is `ok`. `send` runs, the server binds `cuts-xyz`, then Vercel fails with a 502, or the response is lost.
2. The app keeps the pending record, with `target.slug: null` and `deployedUrl: null`.
3. The retry, or the user tapping Publish again, runs `iosSite(tx)` and gets `{siteId: 'cuts-xyz'}`. `boundMatches({slug:null, deployedUrl:null}, …)` returns false, so the result is **blocked**.
4. The pending record is dropped. The user sees "This phone's Apple ID already runs a different website … subscribe with another Apple ID." If the deploy failed, the site never goes live, even though the user paid. After that, every Publish tap is blocked the same way, because the local site never learns its slug. Only Restore gets the user out, and the message no longer mentions Restore.

The same thing already happened for signed-in (owned) first publishes since eef7738, which rereview-2 missed. This commit extends it to every buyer.

Fix (any one):
- (a) In `publishFlow`, when the check answered "no site bound" (404), record that on the pending record, for example `target.freshBind: true`. On retry, accept the bound slug that now exists as this publish's own and skip the block. Better still, adopt that slug into the local site. Only a 404 at pay time proves the slug wasn't there before.
- (b) Have `boundElsewhere` and `iosSite` tell the app whether the bound slug was bound by this same transaction after the pending record's `createdAt`. That needs a server change.
- (c) Minimum: go back to `slug == null && ownerUserId` for the check. This leaves the owned case open, as it was before.

Add a test: first publish, `iosPublish` throws 502 after binding, then resume with `boundElsewhere` seeing the new slug. The retry must still send and must not drop the record.

## Checked and fine
- In `publishFlow`, `blocked` drops the record only when the user paid in this run. An entitled republish never queues anything.
- When the transaction id lookup is still lagging (null), the pending record is never dropped before it gets a transaction id.
- A target with a slug publishes to that slug. The server publishes only to the slug bound to the transaction, so a slug site can't be sent to another site.
