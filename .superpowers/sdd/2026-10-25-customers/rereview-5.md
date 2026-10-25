# Re-review 5: R1b fix (staged on e2e-pressure, not yet committed)

This was a read-only review. HEAD is still 6cdc643, and the R1b fix is **staged but not committed** (`src/lib/publish.ts`, `__tests__/accountSwitchFixes.test.ts`). I reviewed `git diff --cached`. The accountSwitchFixes and publish suites pass: 2 suites, 57 tests.

As asked, I only looked at places that clear or overwrite the pending (freshBind) record. I report only two kinds of issue: a paid publish that gets dropped, and one account overwriting another account's live site.

**Verdict: fix first. This is a one-line fix.** The R1b scenario itself is closed. One branch of the new code can still overwrite the carried record and strip its `freshBind` flag.

## R1b as reported: closed

- `publishFlow` loads the existing record first. When it has `target.freshBind` and the same `draftId`, it becomes `carry`.
- **Paid re-tap.** The record saved before the check keeps `carry.transactionId` and `freshBind: true`. `owned` is then true when the looked-up id equals the carried one, so the guard is skipped and the flow saves and sends with `freshBind`. A failed send keeps the record.
- **No transaction id found.** The flow returns `pending` and the carried record stays intact. A test covers this.
- **Entitled re-tap (`paid = false`).** When the record is owned, it is sent without a check. When it is not owned, the `blocked` and `unknown` branches don't write anything.

## Every place that clears or overwrites the record

| Site | When | Verdict |
|---|---|---|
| `send`: success | confirmed live | OK |
| `send`: 409 site-updated | the server copy is adopted (the site is live) | OK |
| `send`: 402 | subscription inactive | OK (not a paid publish) |
| `send`: 400 bad-request | malformed payload | OK (as before) |
| `adoptAndSave` (adminSync) | the server copy is adopted | OK (the server holds the live site) |
| `resumePendingPublish`: expired (7 days) / no transaction / blocked | `freshBind` skips the check, so `blocked` can't happen for it | OK |
| `account.ts:225` switchAccountSite | runs only after a guard that throws if anything is pending | OK |
| `account.ts:426` deleteLocalData | the user deleted their data | OK |
| `publishFlow`: paid pre-check save | carries the transaction id and `freshBind` | OK |
| `publishFlow`: `blocked` + paid | restores `carry` | OK |
| `publishFlow`: post-check save before send | `freshBind` is set only when the guard is `fresh` | see R1c (the not-owned case) |
| **`publishFlow`: `unknown` + paid** | **writes a new record with no `freshBind` and the new transaction id** | **R1c** |

## R1c. MEDIUM (fix first, one line): the `unknown` branch wipes the carried record when the transaction id has changed

`owned` needs `carry.transactionId === transactionId`. The id comes from `pickLatestTransactionId`, which returns the newest active transaction's `transactionId`. That id changes when the subscription renews, and when a second product (bookings or store) is bought later. Records live for up to 7 days.

1. The first send fails after the server binds `cuts-xyz` to T1. The record has `{T1, freshBind}`.
2. Later the user re-taps while `hasEntitlement()` is false. The paywall resolves `purchased`, and the latest id is now T2.
3. `owned` is false, so `checkBound(T2)` runs. The check throws, which gives `unknown`.
4. Line 356 saves `{ transactionId: T2, target: targetOf(site) }`. **This loses `carry` and its `freshBind`.**
5. The next resume finds no `freshBind`, so it runs `checkBound(T2, site)`. If T2 resolves on the server to the same subscription, `cuts-xyz` is bound, and a local site with no slug or URL doesn't match it. The result is `blocked`, `savePendingPublish(null)` runs, and the paid publish is dropped.

This path is narrow: it needs the id to change, the entitlement mirror to read false, and the check to fail. When the id has changed, the `ok` and `fresh` branches also replace `carry` with a T2 record (`fresh` keeps `freshBind`). That puts a site live under T2 rather than dropping it.

**Fix:**
- **Minimum:** on line 356, use `if (paid) await deps.store.savePendingPublish(carry ?? { ...current object... })`. That matches the `blocked` branch.
- **Better (route (a) from rereview-4):** when `carry` is present, send `carry.transactionId` with no lookup comparison and no check, exactly as resume does. That removes the dependence on the id staying the same.

Test to add: a carried `{T1, freshBind}` record, a re-tap where `latestTransactionId` returns T2, `boundElsewhere` throws, and the paywall says `purchased`. Then assert that `loadPendingPublish()` still matches `{ transactionId: 'T1', target: { freshBind: true } }`.

## Cross-account overwrite: none found

- `carry` needs the same `draftId`. Switching accounts throws while anything is pending (`account.ts:204`), and Restore doesn't reuse a draft id owned by an account. So a carried record can't end up attached to a different account's site.
- The no-check send (`owned`) only happens with the same transaction id as the record that was saved when nothing was bound. The server publishes only to the slug bound to that transaction, which is the one this payer's own send created.
- **Hardening (low, not reachable today):** `owned` is also true when `carry.transactionId == null`. Any current transaction would then skip the ownership check. No code path stores `freshBind` with a null id: the flag is set only in the save after the check, which always has an id, and resume fills the id before saving. Dropping the `== null` arm would keep it that way if that changes.
