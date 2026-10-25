# Re-review: fixes 6ff3782 / 179ac67 and editor stream (bb5708b, 7e21350, 4372d18, 549ca53)

Branch e2e-pressure, read-only review. Targeted jest (25 suites, 221 tests) passes. No device or simulator run.

**Verdict: fix first.** Items 1 and 2 below are small and must land before ship. Everything else can ship.

## Status of the high findings

| Finding | Status |
|---|---|
| E1: sign-up switches account | **Fixed.** `signUp` now goes through `afterSession` (auth.ts:126). |
| E2: B's sign-in never wipes A's unsynced edits or paid pending publish | **Fixed.** `switchAccountSite` refuses with UNSAVED_OTHER_ACCOUNT when a pending publish exists or `accountSyncedAt < updatedAt` (account.ts:203). This happens before any write, and the caller signs out again. Sign-out now pulls, pushes and stamps before the pending check. Records from older builds have no `accountSyncedAt`, so they are refused, which is the safe direction. |
| E3: B's site cannot publish over A's live site | **Partly fixed.** The Publish tap is guarded. Two bypasses remain (item 2), and the Restore half is still open (item 1). |
| F1/E6: live.tsx domain box respects `known` | **Fixed** (`domainKnown && !hasDomain`). |
| D1: 'owes' excludes refunded orders | **Fixed.** `owedCents` counts only unsettled orders, as total minus paid. See item 7 for 'deposit'. |
| D2: stale buyers cleared | **Mostly fixed.** One narrow gap remains (item 6). |
| E4 timeout race, E5 reset code, E7 reminders, E9 pull before push, E10 notice | Fixed. E5 adds a new gap (item 4). |

## Ranked findings

### 1. HIGH (must fix): the new "blocked" message sends B to Restore purchases, and that overwrites B's account site with A's site
`publish.ts` BOUND_ELSEWHERE_MESSAGE says "To use that website, tap Restore purchases."
Restore while B is signed in (`account.ts restore()`) works like this:
- It is not `sameSite`.
- B's switched-in site has no `deployedUrl`, so the restore **keeps B's draftId** (`draftId: local && !local.deployedUrl ? local.draftId : randomUUID()`).
- It sets `ownerUserId = B`, and `restoreFlow.ts:79` then runs `syncIfSignedIn` to upsert onto `sites.id = B's draftId`.

As a result, B's account row (B's only copy of their site) is overwritten with A's site. This was the skipped half of E3, and the new copy now points users straight at it.

Condition: the draftId is reused only when B's switched-in record has no `deployedUrl`, that is, when B's account site was never published. That is the common case for a second account.

Fixes:
- (a) **Must fix, copy only:** change the message so it does not suggest Restore while signed in to another account.
- (b) **Should fix:** in `restore()`, ask before replacing a signed-in draft of a different site, or use a narrower test. Don't just switch to `randomUUID()` whenever `ownerUserId` is set. The restore deliberately keeps the draftId of a user restoring over their own signed-in draft, because it is the photo folder key, so a blanket new id would change that behaviour.

### 2. MEDIUM-HIGH (must fix): the publish guard can be bypassed
`publish.ts:313` and `paywall.tsx:362`.
- **Fails open:** `boundElsewhere(...).catch(() => false)`. A failed or timed-out `/api/ios/site` then lets the publish go ahead with A's transactionId.
- **Resume path skips the guard:** `resumePendingPublish` (_layout.tsx:200) calls `send()` with no `boundElsewhere` check. Scenario: A's Apple subscription has lapsed, B signs in on A's phone and pays. The pending publish is saved with `transactionId: null`. Superwall lags, so the tap returns 'pending'. The launch or foreground retry then sends B's content with A's transactionId and **overwrites A's live site**.

Fix:
- Do **not** treat every error as blocked. A signed-in user's normal first publish also has `slug == null && ownerUserId`, and for a fresh subscription `/api/ios/site` answers 404 `no-site`. Treat `ApiError` with `status === 404` or `code === 'no-site'` as "not bound, go ahead". Treat network and 5xx errors as "don't send yet": return `pending` so the retry comes later, not `blocked`.
- Run the same check in `resumePendingPublish`. That path only has `pending.data`, so load the current site record to read `slug` and `ownerUserId`.

### 3. MEDIUM: B can pay before being blocked
The guard runs after the paywall. If A's subscription lapsed, B buys on A's Apple ID, which renews A's subscription bound to A's site. B is then told "subscribe with another Apple ID", and the pending publish is dropped. When a transaction id is already known, the bound check should run before `showPaywall`.

### 4. MEDIUM: the E5 fix leaves an orphan session with A's site on the phone
With `deferSwitch`, `verifyResetCode` signs B in (the recovery session) without switching. If `setNewPassword` then fails (weak password or offline) and the user leaves the screen, B stays signed in. The switch never runs, and nothing at launch runs it either. B sees A's site, and B's edits silently fail to sync, because `syncSiteToSupabase` throws for a site owned by someone else. This is the E1 symptom coming back through the reset path. No data is lost, since nothing is written under B. Fix: if `setNewPassword` fails after a fresh verify, run the switch anyway (it is safe now that it refuses when there are unsaved changes), or sign out locally.

### 5. MEDIUM (E8 skipped, fix soon, not a blocker): A's booking and order pushes keep arriving after sign-out
The pushes carry customer names and times. This needs a server endpoint to delete the token, plus clearing the `bookings.pushToken.v1` stamp on sign-out. Barbershops sharing an iPad make this realistic, so it should go in the next release. The client fix is trivial once the endpoint exists.

### 6. LOW-MEDIUM: stale buyers can remain when `loadMyShop` fails
`useStoreCustomers` (and `useCustomers`) clear the list only after `loadMyShop()` resolves to a different shop. If `loadMyShop` throws after an account switch, the catch keeps `'ready'`, and A's buyers stay on screen. Fix: key the clear on `currentUserId()` changing, or clear in the catch when `shown.current` was not confirmed for this session.

### 7. LOW: 'deposit' orders count as settled, so the remaining balance is never in "Owes"
`SETTLED` includes `'deposit'`. A deposit order owes `total - deposit` at pickup, but `owedCents` adds 0 for it and `unpaidOrders` leaves it out. This understates rather than overstates, so it is safe to ship. Decide whether "Owes" should include deposit balances.

### 8. LOW: the Call sheet will not save a text-only edit when the site has no phone number
`normalizePhone('')` fails. The same happens in Directions when there is no address. This is a UX papercut.

### 9. LOW: the Book sheet cannot clear an own link
Choosing 'own' with an empty field gives an error. `url: null` is never produced. Clearing is still possible from All fields.

### 9b. LOW (copy): sign-up can now throw UNSAVED_OTHER_ACCOUNT after the account was created
When that happens, the user is signed out with a new account and an error message. The message should say that the account was created and that they should sign in once the other account's changes are saved.

### 10. LOW (skipped copy, fine to ship): Settings copy for Gap 3, D5 (refetch on focus), D6 (customer id can change), D7 (tour copy)
These are copy, cost or edge-case items with no data or money risk. Ship them later.

## Editor stream (B1, A2–A4): no blocking defects

- **Link injection:** `normalizeBookingLink` only ever outputs `https://<rest>`.
  - `javascript:`, `data:`, `vbscript:`, `file:` and `http:` are rejected. The `host:port` exception cannot smuggle in a scheme: `javascript:1` becomes host `javascript`, which has no dot, so it is rejected.
  - Quotes, angle brackets, backticks, backslashes, whitespace and control characters are rejected, and so are `user@`, a leading `//` or `/`, and the site's own Prime Barber link.
  - Phone input allows only `+0-9 ().-` with 7–15 digits, so the `tel:` href is safe. Address input rejects `<>` and control characters, and the renderer applies `encodeURIComponent` to the maps query.
  - An unchanged legacy link is kept as is, and the renderer's `safeHref` still filters it.
- **Preview bridge:** `nav` is accepted only for an href in `pageHrefsFor(data)`, which is built from the data and not from the DOM, and is at most 200 characters. `shouldAllowPreviewRequest` is unchanged, the label long-press uses the existing whitelisted `edit` path, and no new globals are added.
- **Call Now** has no scheduler choice: the sheet shows the Book options only for `kind === 'book'`, and the Call save only touches `phone`.
- **Published bytes:** `src/web` is untouched (SOURCE still ea3c927), and `resolveLinks` is behaviourally identical (it now uses the `schedulerLive` predicate). The button sheet goes through `savePathValue`, which drops a label equal to the default or empty, so an unchanged save leaves `labels` alone. The Book choice is re-resolved by `resolveLinks` at publish time. A save with no changes therefore publishes the same page.
- Not verified: the WKWebView long press and the burger on a real device, as the report already notes.
