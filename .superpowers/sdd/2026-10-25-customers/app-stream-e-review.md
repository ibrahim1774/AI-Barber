# App stream E review (d7273fa E1, 018539d E2, 243cdeb F1)

Verdict: **fix first** (findings 1 to 3 hit the account-switch guarantees; finding 6 is an F1 money regression).

Verified OK:
- `public.sites` RLS (live DB, project lyjruphvzfwbtzfwfvwm): select/insert/update/delete all `auth.uid() = user_id`, and update has a matching with_check. No client query can read or claim another account's row by id or slug. `switchAccountSite` and `pullSiteFromAccount` both filter `user_id = <signed-in id>`. Adopt-on-sign-in only adopts rows the user owns.
- `/api/ios/publish` (AI-Barber origin/main `lib/ios/publishFlow.ts:203-222`) ignores the body `userId` and links an account only from a verified bearer, and only when the purchase has no account yet.
- Customers caches: `clearCustomersCache()` (it also clears the store cache) runs on signOut and on switch 'replaced'/'cleared'. Logs carry only error objects: no tokens, emails or user ids. The email in the empty-account notice is shown, never tracked.
- Forgot password: the copy reads the same whether or not an account exists, there is a 60 s resend cooldown, expired and wrong codes map to one message, `reset-password.tsx` reads nothing from the URL, and no token travels in a deep link.
- E2: Settings row matches the plan.

## Ranked defects

### 1. HIGH: sign-up skips the account switch, so a new account sees, and silently fails to save, the previous account's site
`src/lib/auth.ts:123-126`. `signUp` sets `userId` and calls `syncIfSignedIn()` directly. It never calls `afterSession`/`switchAccountSite`.
Scenario: A's site is still on the phone with `ownerUserId = A`. This happens when A's sign-out push failed (offline, or a pending publish, see #2) or when A's session simply expired (no `signOut()` ran). Someone creates account B. `syncSiteToSupabase` throws "site belongs to another account" (`account.ts:30`), and the error is swallowed as a warn at `account.ts:73`. B now sees A's site in the editor. Every later edit by B also fails to sync, with nothing shown, so B's work is never saved to B's account. Fix: route a signed-in signUp through `afterSession(id)`.

### 2. HIGH: a later sign-in wipes the previous account's unsynced edits and its paid pending publish
`src/lib/account.ts:248` and `account.ts:209-215`.
- `pushSiteBeforeSignOut` returns false when a pending publish exists **before** it syncs (`:248` comes before `:249`). A's latest edits are therefore never pushed, and the site stays on the phone owned by A.
- When anyone else then signs in, `switchAccountSite` calls `savePendingPublish(null)` and `clearSite()` (or replaces the site) without checking `updatedAt > syncedAt` or the pending publish.
Scenario: A edits, pays, and the publish is pending (Apple has not confirmed). A signs out, so nothing is pushed. B signs in. A's edits and A's paid publish are gone for good: they exist nowhere on the server. The same happens if A signs out offline. Fix: sync before the pending check. In the switch, if the local site has unsynced edits or a pending publish, refuse the destructive branch or warn ("This phone has unsaved changes from another account"). Don't silently wipe.

### 3. HIGH (Gap 3 is now reachable): B's site, loaded by the switch, publishes over A's live site
`account.ts:216-229` (the 'replaced' record has `slug: null`, `transactionId: null`), together with `publish.ts:288-310`. Publishing binds to the Apple ID's transaction, not the account. On A's phone (A's Apple subscription bound to A's slug), B signs in and gets B's site. `hasEntitlement()` is true, so tapping Publish sends B's content with A's transactionId. The server overwrites the site bound to that transaction, which is **A's live site**, and the local record then takes A's slug. Before E1, B's site never loaded, so this path could not happen. In the other direction, "Restore purchases" while B is signed in (`account.ts:374-380`) stamps A's Apple-bound site as owned by B, and `restoreFlow.ts:79` copies it into B's account. The plan only asked for this to be documented, but now that the switch loads B's site it causes data loss. At minimum: block publishing (or show a clear confirm) when the record has no slug and the Apple-bound site belongs to a different account or slug. The Settings copy for Gap 3 was also not done.

### 4. MEDIUM: a sign-in timeout races the still-running switch
`auth.ts:150-158`. `withTimeout` does not cancel `switchAccountSite`. After 6 s the code signs out locally and tells the user "A's copy kept", but the in-flight query (sent with B's token) can still finish. It then clears A's site and pending publish, or saves B's site with `ownerUserId = B`, on a phone that is now signed out. `emptyAccount` is never set. Scenario: slow network on sign-in. The user is told to sign in again while the phone silently holds B's site, or holds nothing. Fix: pass a cancel flag or generation token into `switchAccountSite` and check it before any write.

### 5. MEDIUM: a failed switch during password reset burns the one-time code
`auth.ts:296`, `forgot-password.tsx:81-84`. `verifyResetCode` calls `afterSession`. If the switch fails, the code signs out and throws `SWITCH_FAILED` before `onVerified` runs. The code is consumed, the password was never set, and the retry hits `verifyOtp` again: "That code is wrong or has expired". The user has to wait out the 60 s cooldown and get a new code. Fix: mark the code verified before the switch, or run the switch after `updateUser`, or keep the recovery session and retry only the switch.

### 6. MEDIUM (F1): the live-screen domain upsell ignores `known` and can push a second $39 domain
`src/app/live.tsx:31,91`. It uses `!hasDomain` alone. `useDomainOffer` starts at `{known:false, hasDomain:false}`, so a domain owner sees the box while status loads. In the "paid slot with no readable status" case the hook deliberately returns `known:false` ("do not push a second purchase from here", `useDomainOffer.ts`), and the box stays visible permanently. Settings gets this right (`settings.tsx:361`). Fix: `{known && !hasDomain && (...)}`. Minor: the title uses a hardcoded `'#fff'` and the border uses `colors.hair` where the plan said `colors.line`.

### 7. LOW-MEDIUM: the previous account's reminders survive a switch or sign-out
`account.ts:209-215` and `account.ts:258-262` never cancel scheduled publish reminders, which carry A's shop name (`reminders.ts:73-104`). `deleteLocalData` does cancel them (`account.ts:399`). After a switch, B's phone can show "finish <A's shop>" notifications, or A's after A signed out. Fix: call `cancelAllReminders` in both the clear and replace paths.

### 8. LOW (pre-existing, in scope for "switching"): booking push token never unregistered on sign-out
`src/lib/bookings/push.ts:50-70`. The server upserts the token per `expo_token` (`repo.ts upsertPushToken`), so it moves only when a new user who owns a shop registers. After A signs out, or B signs in without a shop, A's booking and order pushes (customer names and times) keep arriving on this phone. Fix: delete the token on sign-out.

### 9. LOW: the sign-out push can overwrite a newer web edit
`account.ts:249`. A blind upsert with no pull first (afterSession pulls first; sign-out doesn't). Scenario: A edits on aibarber.org after the phone's launch pull, then signs out on the phone. The stale phone copy replaces the web edit, and the phone copy is then deleted.

### 10. LOW: the empty-account notice is lost on the Bookings-setup return path
`afterSignIn.ts:22-26`. `takeEmptyAccountNotice()` is consumed, then `takePostAuthReturn()` returns early. The user lands back in Bookings setup with no site and no explanation.

Not checked: the Supabase "Reset password" template, which needs `{{ .Token }}`, a 6-digit OTP and an expiry of at least 10 min. The builder flagged it as NEEDS USER and it is still unverified. No device or Maestro run.
