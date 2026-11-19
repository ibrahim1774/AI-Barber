# One account: what the app must do (contract for the 1.2 app builders)

Written from the server handlers on branch `1acct/wave-c`. Every status and error code below was checked against the handler that sends it. Plain English, no prices, no links to the web app inside the app for a web payer.

## 1. Who the app is talking to

Send these on every request to the endpoints below:

- `Authorization: Bearer <Supabase access token>`.
- `X-PB-Build: <build number>` (any non-empty text). This is how the server knows the caller is the native app. A browser never sends it. Builds 55 and 1.1 do not send it and keep working exactly as before. Without the header the server treats you as a browser, so do not leave it out in 1.2.

## 2. Site mode: what the app does in each

Ask `GET /api/shop/plan` (bearer). With the plan answer switched on the response has `capabilities.siteMode`, one of:

| siteMode | Who | What the app does |
|---|---|---|
| `account` | A web account the rollout covers, AND the draft engine is really usable on the server (`WEB_APP_RELIABILITY`, `WEB_APP_CHECKOUT` and `WEB_APP_ENTITLEMENTS` all on); otherwise the same account is `web-only` | Uses the draft store and the drafted publish (sections 3 and 4). The draft is the only copy that is edited. No old iOS publish, no old Restore. |
| `web-only` | A web account the rollout does not cover yet, including while the switch is fully off | No editing, no autosave, no paywall, no publish. Show the "your website is managed on the web" text. Every draft, publish and kept-copy call answers 403 `not-account-mode`. |
| `device` | Apple accounts, two-site accounts, and accounts with nothing yet | Today's behaviour exactly: the phone copy, `/api/ios/publish`, `/api/ios/site`, the Apple paywall. |

Rules:

- `siteMode: "unknown"`: the server switch is on but it could not read this account just now. The answer still has the old fields and no `kind` and no `site`. Treat it exactly like a failed plan answer: "Checking your plan. Try again." No paywall, no editor. Never read it as `device`, and never read a missing `siteMode` as `device` for an account that earlier said `account` or `web-only`. (A missing `siteMode` means the server switch is off, which is the old world.)
- If the plan answer fails and nothing is stored for this account: show "Checking your plan. Try again." with a Try again button. No paywall, no editor, no autosave. If an earlier answer is stored, use it until a fresh one arrives.
- `device` without a server answer is only for a signed-out phone.
- A web account is never `device`. If the answer says `web-only` the app must not fall back to the Apple flow.

## 2b. Sign-in outages answer 503, not 401 (when the switch is on)

With `AUTH_OUTAGE_503=1` the web-app endpoints (draft, publish, publish-status, kept-copy, take-offline, delete-account, me, checkout, portal, price-group, contact-phone, session, upload-proxy, domain, service-copy) tell two cases apart:

- The sign-in service says the token is not valid (401 or 403 from it): the endpoint answers 401 `unauthorized`. The user is signed out.
- The sign-in service could not be asked or did not answer properly (network error, 5xx, 429): the endpoint answers 503 `temporarily-unavailable`. The user is still signed in. Show a retry, never the sign-in screen, and do not clear the stored session.

With the switch off (today) both cases are 401, so the app cannot tell them apart.

## 3. Drafts (account mode only)

`GET /api/web-app/draft` returns `{ draft }` (null when there is none). `PUT /api/web-app/draft` with `{ id, site_data, expectedRevision }` returns `{ draft, seoProblems }`.

| Status and code | Meaning | What the app does |
|---|---|---|
| 200 | Saved, or an identical save | Keep the returned `revision`. |
| 400 `invalid_draft` | Bad shape, or data URL images | Fix the data; images must be uploaded and sent by URL. |
| 401 `unauthorized` | No or bad token | Sign in again. |
| 403 `not-account-mode` | The account is not in account mode | Stop using drafts, go by `siteMode`. |
| 404 `not_found` | The draft engine is off on this server | Treat as unavailable, do not retry in a loop. |
| 409 `draft_changed` (body has the current `draft`) | Another device or tab saved first | Ask which list to keep, then save again with the new revision. |
| 413 `draft_too_large` (`maxBytes`) | Over 1 MB | Nothing to retry; reduce the data. |
| 429 `rate_limited` | Too many saves (about 120 a minute) | Wait the `Retry-After` seconds. |
| 503 `temporarily-unavailable` or `save_unavailable` | The server could not decide or save | Try again later; never fall back to the old route. |

## 4. Drafted publish (account mode only)

`POST /api/web-app/publish` with this body and nothing else that matters:

```
{ draftId, revision, baseVersion?, republish?, bookingChoice, ownBookingUrl }
```

- `draftId` and `revision`: the saved draft revision to publish. Required. Never send `siteData`; the server ignores the phone's own copy and uses the saved draft.
- `baseVersion`: the server version the app last saw, as today.
- `republish: true`: only when the barber deliberately republishes a site that was taken offline.
- `bookingChoice`: always send it. One of `own`, `aibarber`, `call` (the same names as the app's `BookingChoice`). Anything else is a 400.
- `ownBookingUrl`: the barber's own booking link as an absolute `https` address, or an empty string when they have none. An unusable link (not http or https, has a user name or password, has spaces, is over 2048 characters, or points at one of our own sites) is dropped as if it was empty. It does not fail the publish.

The server decides the Book and Shop buttons from the plan, the shop and the store switch, and refreshes the team cards from the live team (drops removed or inactive members, never adds). `aibarber` with bookings off or no open shop falls back to `ownBookingUrl` when one was sent, else no Book button.

| Status and code | Meaning | What the app does |
|---|---|---|
| 200 `{ siteId, deployedUrl, republished, version, editedBy, editedAt }` | Live | Store the version. |
| 400 `invalid_booking_fields` | `bookingChoice` is not one of the three | App bug; fix the value. |
| 400 `invalid_draft`, 400 with `reason: logo-folder` | The saved draft cannot be rendered | Ask the barber to fix it. |
| 401 `unauthorized` | Sign in again | |
| 402 `subscription-inactive` | No paid or free web plan | Show the plan text; no paywall link for a web payer. |
| 403 `not-account-mode` | Not in account mode | Go by `siteMode`. |
| 403 `phone-required` | A free account needs its phone number saved first | Ask for the number. |
| 409 `use-drafted-publish` | Sent without `draftId` and `revision` | App bug. |
| 409 `publish_in_progress_or_draft_changed` | The named revision is not the saved one, or a publish is running | Reload the draft, then publish again. |
| 409 `site-updated` (with `site`) | The server copy changed since `baseVersion` | Show the server copy to review, as on the web. |
| 409 `slug-owned` (may carry `reason: account-has-site`) | The address cannot be given to this account | Show a "contact support" style message; do not retry. |
| 429 `rate-limited` | Too many requests | Wait `Retry-After`. |
| 503 `publish_retry_required` (`intentId`) | The publish is queued and will finish on the server | Show "Publishing. Check again shortly." and refresh later. Do not publish again at once. |
| 503 `temporarily-unavailable` | Lookup failed, or the draft engine is off | Try again later. Never send the phone's copy another way. |
| 404 `not_found` | Web plans are off on this server | Unavailable. |

## 5. Kept copies

`POST /api/account/kept-copy` with `{ kind, siteData, slug?, sourceVersion? }`. `kind` is `phone-draft` or `account-copy-before-replace`. Use it to set aside a whole-site copy instead of overwriting something. Same content again is a success. The server keeps 50 copies per account for 90 days.

| Status and code | Meaning |
|---|---|
| 200 `{ ok: true, stored }` | Stored, or already there (`stored: false`). Either way it is safe. |
| 400 `invalid_kept_copy` | Bad kind or body. |
| 401 `unauthorized` | Sign in again. |
| 403 `not-account-mode` | Only account mode may store copies. |
| 404 `not_found` | Feature is off here. |
| 413 `kept_copy_too_large` (`maxBytes`) | Over 1 MB. |
| 429 `rate_limited` | About 30 a minute. |
| 503 `kept_copy_unavailable` | Could not store now. Do not discard the copy on the phone until a call succeeds. |

## 6. Old iOS routes with the header

`POST /api/ios/publish` and `POST /api/ios/site` (Restore), sent WITH `X-PB-Build`:

- 409 `use-account-publish`: the account is a web account (mode `account` or `web-only`). Never use these routes for it. Re-read the mode (`GET /api/shop/plan`) and go by `siteMode`; do not retry the old route. This answer only exists while `ACCOUNT_PLAN_V2=1`. With it off these routes answer exactly as for a call without the header, whatever the app sends, so the app and the server always agree on whether modes exist.
- 503 `temporarily-unavailable`: the mode could not be read (with `ACCOUNT_PLAN_V2=1`). Try again later. A missing or unknown Stripe key never causes this for an Apple account: the server treats the caller as `device` on these old routes.
- Otherwise the route answers as before.

**Delete and take offline: ONE route each, for every account (6a).** With `ACCOUNT_PLAN_V2=1` AND `X-PB-Build` the app calls only `POST /api/ios/delete-account` and `POST /api/ios/take-offline`. There is no route hopping and no `use-account-delete` or `use-account-take-offline` answer any more. The server picks the right action for the account and reports what it did. Without the header, or with `ACCOUNT_PLAN_V2` off, both routes answer exactly as before, with none of the new fields below.

`POST /api/ios/delete-account` (bearer; optional body `{ transactionId?: string }`). Deletes the account whatever its kind. Any live card plan (web, two-site, or an Apple account that also has one) is cancelled first, whatever `APP_DELETE_CANCELS_WEB` and `WEB_APP_ENTITLEMENTS` say. All the account's sites go down and are purged (web sites, and Apple sites tied to its purchases). Send `transactionId` (the Apple transaction the phone has) if you have one: when Apple confirms it and the purchase was published signed out (no account on it), that site is taken down and purged too. A transaction that does not verify, or one that belongs to this account anyway, changes nothing; if Apple cannot be reached the call is 503 and nothing is done.

What happens, in this order, and what a failure leaves behind:
1. Reads (503 `temporarily-unavailable`, nothing done): the account's Apple purchases, its kind and Stripe history, and the optional transaction.
2. Stripe is asked what to cancel (read only). It is skipped, with no owner alert, only when the account has no Stripe history (no customer, no web plan), is an Apple account or has no site, AND Stripe says the user has no Checkout session (a payer whose webhook has not landed has no local row yet). If Stripe cannot be asked for the sessions, the normal path decides. A refusal here is 500 `delete-failed`, nothing done.
3. A publish in progress: 409 `{ error: 'publish-in-progress' }`, nothing done. Wait for the publish to settle and try again.
4. The shop is closed: upcoming bookings are cancelled and customers emailed, refunds started. If a later step fails, this may already have happened.
5. The card plan and the domain subscription are cancelled. If a Stripe call fails here: 500 `{ error: 'delete-failed', retryable: true, cardCancelFailed: true }`. The account and its sites are still there and a retry is safe, but bookings may already be cancelled and some subscriptions may already be cancelled.
6. Every site goes down, then is purged, then the account is deleted. A failure here is 500 `delete-failed` (no `cardCancelFailed`). If a card plan or domain subscription was already cancelled, the body also carries `cardPlanCanceled: true`: tell the owner the card plan is already cancelled and to try again. Some sites may already be offline; a retry finishes the job.
- 200 `{ deleted: true, ..., outcome: { cardPlanCanceled: boolean, appleSubscriptionActive: boolean } }`. `cardPlanCanceled` is true when any Stripe subscription was cancelled, the site plan or the domain subscription (it does not say which). `appleSubscriptionActive` is true when the account has any linked Apple purchase, in any environment, that is not known to be refunded or expired (it stays true after a site was taken offline, because Apple keeps billing), or when the body `transactionId` verified, or when the one-site guard recorded a purchase of this user that it refused to tie to the account. An expired purchase whose site the server still watches (no takedown recorded yet) also counts, because Apple may be retrying billing or in a grace period. Once the site was taken down the server cannot see a billing retry, so a purchase that Apple is still retrying after that may not be reported: the reminder text should say "if you still have a subscription". It only drives a reminder: if true, tell the user to cancel the Apple subscription in iPhone Settings, then Subscriptions; deleting the account does not cancel it.
- Every refusal at the closeShop stage (planning refusals, the shop could not be closed) is 500 `{ error: 'delete-failed', retryable: true }`; `cardCancelFailed: true` is added when it was a failed Stripe call. A publish in progress is the exception: 409 `publish-in-progress`, no `retryable`. Failures after the shop was closed (step 6) carry no `retryable`.
- `cardCancelFailed` is true only for a failed Stripe call on an account that has something to cancel. App text: "We couldn't delete your account right now. Try again later." Any other 500 `delete-failed` (a database error, a subscription this server cannot reach): show a plain "Try again later." Do not use `retryable` to tell the cases apart: some old failures also send it.
- 401 as today (no bearer, or a bearer that is not valid). 409 `move-in-progress` as today. Delete never answers 429: it is not rate limited.

`POST /api/ios/take-offline` (bearer; body `{ transactionId?: string, expect?: 'keep' | 'purge' }`). `transactionId` is the Apple transaction the phone has, if any. Send `expect` always: `keep` means the user was told nothing is deleted, `purge` means the user confirmed content will be deleted.
- Web account (kind `web`): the web site(s) go offline, the saved copy, photos and phone number are kept, the live address is forgotten (draft engine on or off). No transaction is needed. If the app sends one and Apple confirms it is bound to a site this caller may remove (its own, or one published signed out), that Apple site is taken offline instead, as in the next line; a transaction that does not verify, has no site or belongs to another account is ignored.
- Apple or no-site account with a valid transaction: today's behaviour for the Apple site: content is purged unless the server keeps it (`SAFE_TAKE_OFFLINE=1`).
- Two-site account (kind `mixed`): with a transaction, the Apple site as above; without one, the web site, kept.
- If you sent `expect: 'keep'` but this call would purge: 409 `{ error: 'confirm-purge' }`, nothing done. This holds for any build that sends `X-PB-Build`, even when `ACCOUNT_PLAN_V2` is off, so a phone holding a stale mode is never purged after "Nothing is deleted". Ask the user to confirm, then call again with `expect: 'purge'`. `expect: 'purge'` when content will be kept simply proceeds. No `expect`: treated as `purge` for an Apple site (today), proceeds for the web site.
- 200 `{ ..., outcome: { site: 'web' | 'apple', contentKept: boolean, otherSiteLive: boolean, domainDetached: boolean, domainReattachesOnPublish: boolean } }`. (`outcome.site` is unrelated to the `site` field of the plan answer.)
- Custom domain: `domainDetached` is true when the site had a custom domain, which this call detached from the website (it stays paid and stays the owner's). `domainReattachesOnPublish` is true when publishing again brings the domain back by itself: always for an Apple site; for a web site only when the server keeps content on take offline for it (`SAFE_TAKE_OFFLINE=1`). When it is false the domain stays detached until the owner adds the same name again in Settings; that is free (it is their own detached name, no new purchase). Word the message from these two fields.
- Publishing again after a web take offline is accepted: the site comes back at the same address with the saved copy ("Publish again to bring it back"). A second web take offline on a site already offline answers 200 again, not 404; 404 `no-site` only when the account has no web site at all. Say what happened from `outcome`: "Nothing is deleted" only when `contentKept` is true. If `otherSiteLive` is true say the account's other website is still live (a two-site account takes down only the site you asked for).
- Exact answers the app's test double must reproduce: a bearer that is no longer valid, on a purchase linked to an account, is 403 `not-owner` (no bearer at all is 403 `sign-in-required`). A web account that names a transaction while Apple cannot be reached is 503 `{ error: 'apple-unavailable' }`; if the purchase database cannot be read it is 503 `{ error: 'temporarily-unavailable' }`. Nothing is done in either case.
- The Apple site's own checks come first, before `confirm-purge`: a missing transaction is 400 `bad-request`, a transaction with no site is 404 `no-site`, someone else's purchase is 403, so nobody is asked to confirm a purge that would then be refused.
- Rate limit: every caller is limited before the body is read: 429 `rate-limited` (Retry-After 60), or 503 `temporarily-unavailable` when the limiter store is down. A bearer that is no longer valid is treated as signed out: a purchase with no account can still be removed, a purchase linked to an account is 403 `not-owner` (no bearer at all: 403 `sign-in-required`).
- 404 `no-site` (nothing to take down), 409 `publish-in-progress` (nothing touched; wait for the publish to settle, try again), 400 `bad-request` for an invalid `expect` or, for an Apple account, a missing transaction, 503 `temporarily-unavailable` (a read failed, nothing done), 500 `remove-failed`.
- After a web take offline the same address is reused by the next normal publish; a custom domain that was detached must be reconnected by the barber.

`POST /api/ios/site` still answers a web account 409 `use-account-publish` (publish and sync only). Do not call it before take offline when the mode is web.

`POST /api/ios/publish` can answer **409 `account-has-site`** with `{ slug, reason }`:

- `reason: "web-account"`: this account already has (or is publishing) a website on the web. `slug` is that address, or an empty string when it has none yet. Do not say the account has a live website when `slug` is empty.
- `reason: "other-apple-id"`: the account's website belongs to a subscription bought with a different Apple ID. `slug` is that website's address.
- `reason: "mixed"`: the account would hold two websites. `slug` may be empty.
- The body also carries `planLive` for `web-account` and `mixed` (false = the account's web plan has ended; absent on address-conflict answers and `other-apple-id`, treat as true) and `accountEmail`: the signed-in caller's OWN email (never anyone else's), when it can be read. Use it to say which account already has the plan. It is only present for Production purchases. Show the same two texts as for `blockedPurchase` in section 7 (one for `web-account` and `mixed`, one for `other-apple-id`).
- In all cases the new subscription was not used and nothing changed on the website. Builds that only know `account-has-site` keep working: they read `slug`, and anything but `reason: "shop"` counts as "site".

## 6b. The web routes for the same two actions

`POST /api/web-app/take-offline` and `POST /api/web-app/delete-account` still accept a native caller with a web account (a `device` caller gets 403 `not-account-mode`), but the app no longer uses them: use the single routes in 6a. The web's own take offline and delete are unchanged.

## 6c. Get paid (Stripe onboarding) return page

`POST /api/shop/stripe/onboard` takes an optional JSON body `{ "client": "ios" | "web" }`. `ios` returns to the iOS return page, `web` to the web app. Leave it out and today's rule applies unchanged. Any other value (including a URL) is 400 `bad-request`. The app should always send its own value. Other answers are as before: 200 `{ url }`, 401, 404 `no-shop`, 409 `stripe-account-unavailable`, 502 `stripe-error`.

## 6d. Which switch makes each header-based gate active

| Route and gate | Active when | Notes |
|---|---|---|
| `/api/ios/publish`, `/api/ios/site` (409 `use-account-publish`) | `ACCOUNT_PLAN_V2=1` | Off: identical to a header-less call, no reads. The only gate on a route that device mode uses. |
| `/api/web-app/draft`, `/api/web-app/publish` (403 `not-account-mode`, 409 `use-drafted-publish`) | Header present (routes need `WEB_APP_CHECKOUT`, `WEB_APP_RELIABILITY`) | The app calls these only in `account` mode, so a device-mode app never reaches them. |
| `/api/account/kept-copy` (403 `not-account-mode`) | Header-independent: always requires account mode | Account mode only. |
| `/api/ios/delete-account`, `/api/ios/take-offline` (single routes, new fields) | `ACCOUNT_PLAN_V2=1` and `X-PB-Build` | Otherwise exactly today's answers. |
| `/api/web-app/take-offline`, `/api/web-app/delete-account` (403 `not-account-mode` for `device`) | Header AND `ACCOUNT_PLAN_V2=1` | Left working; the app does not use them. With `ACCOUNT_PLAN_V2` off a call that carries the header behaves exactly as a browser call. |

A 1.2 app in device mode, with every switch off, gets exactly today's answers from every route it uses.

## 7. Plan check and shop setup

- `POST /api/shop/plan` `{ transactionId }`: 200 with the current plan when this Apple purchase may not be used by the signed-in account (nothing is linked; the answer is the plan as it was). When `ONE_SITE_GUARD=1` the 200 also has `blockedPurchase: { reason, accountEmail?, planLive? }` (`reason` is `web-account`, `other-apple-id` or `mixed`; `accountEmail` is the caller's own email). `GET /api/shop/plan` carries the same `blockedPurchase` (with the guard at `1`), plus `originalTransactionId`, for as long as the account has a refused Production purchase that is still live at Apple and not tied to the account. Key "shown once" by `originalTransactionId`. `blockedPurchaseChecked: true` appears whenever the server actually looked and got an answer (the guard at `1`): on the GET whether or not it found a refused purchase, and on a POST refusal. It is absent when the lookup failed or the guard is not `1`. Clear the Settings row ONLY on `blockedPurchaseChecked: true` with no `blockedPurchase`; if the field is absent keep what you showed. It is independent of `ACCOUNT_PLAN_V2`. It is gone once that purchase expires, is refunded, or is used by any account or shop. `planLive` always comes from one rule (a live card plan or Free), whether `ACCOUNT_PLAN_V2` is on or not; if it cannot be read it is `true`. The POST answer carries `originalTransactionId` too. Only Production purchases ever produce it. It is absent when the purchase was tied, when the guard is not `1`, and for old builds' answers, so it is the clear signal that this Apple purchase was not used. Only Production purchases carry this field and the email (a Sandbox purchase never does). Show by `reason`:

- `web-account` and `mixed`: "This account ({email}) already has a Prime Barber plan. This Apple subscription was not used. So that you are not charged twice, cancel it in iPhone Settings, then Subscriptions." Leave out "({email})" when `accountEmail` is missing.
- `other-apple-id`: "Your website belongs to a subscription bought with a different Apple ID. This subscription was not used. So that you are not charged twice, cancel it in iPhone Settings, then Subscriptions. Then resubscribe with the original Apple ID, or contact support." Do not say this account has a plan.
- `web-account` or `mixed` with `planLive: false`: the web plan on the account has ended. Show: "This account ({email}) has a website from a Prime Barber plan on the web that has ended. This Apple subscription was not used. So that you are not charged for it, cancel it in iPhone Settings, then Subscriptions." Do not say the account has a plan, and do not name any web address. `planLive` is `true` or absent otherwise; treat absent as true.

Emails: with `ONE_SITE_GUARD=1` and a Production purchase the server also emails the account once per purchase and account for `web-account` (the "already has a plan" letter, or the "plan has ended, renew it" letter when `planLive` is false) and for `other-apple-id`. It sends no email for `mixed` (the owner is alerted only).

503 `temporarily-unavailable` when the server could not decide: show a retry, never "no plan".
- `POST /api/shop/setup`: 503 `temporarily-unavailable` is answered before anything is created, so a retry is safe. When the purchase may not be tied, the shop is still set up and `shop.purchaseLinked` is `false`.
- `GET /api/shop/plan` also returns `kind` (`web`, `apple`, `mixed`, `neither`), `site`, and `capabilities.siteMode` when the plan answer is on.
- Free and the kind: with `FREE_IS_WEB=1`, a Free account (price group `free`) with no site is a `web` account (so `siteMode` is `account` or `web-only`, and the app shows no Apple paywall). An Apple address still wins. Revoking Free (admin `revoke-free`) puts a never-published account back to `neither`; an account that already published a web site stays `web` (the existing published-address rule). With the switch unset Free is not read for the kind.

## 8. Switches and the order they go on

All default to off. With every switch off the server behaves exactly as before.

1. Migrations 038, 039, 040 and 041 applied (nobody applies them without the owner's go).
2. Backfill (`scripts/one-account-backfill.ts`, dry run first, then `--apply --yes-production`) and the re-count script.
3. `WEB_APP_ENTITLEMENTS`, `WEB_APP_CHECKOUT` and `WEB_APP_RELIABILITY` on (the account routes, the draft, publish and kept-copy endpoints need them). **These must be on BEFORE `ACCOUNT_PLAN_V2`**, so that the app is never told a web account's mode while the account routes do not exist. If the order is wrong the server stays safe: the plan answer says `web-only` (never `account`) until they are on, and delete and take offline do not depend on them (6a).
3a. `APP_DELETE_CANCELS_WEB=1`, BEFORE `ACCOUNT_PLAN_V2` (and keep it on through any rollback, step 9): an older phone that deletes a web account through the Apple route then cancels its card plan.
4. `ACCOUNT_PLAN_V2=1`: the plan answer gains `kind`, `site`, `capabilities.siteMode`, and the single delete and take-offline routes (6a) switch on, with `/api/ios/publish` and `/api/ios/site` refusing web accounts (409 `use-account-publish`).
5. Re-run the backfill immediately before `ONE_SITE_GUARD=alert`: dry run, review `wouldRemoveStale` (each row is printed with user, environment and slug), apply (with `--yes-production`), then dry-run again and require ZERO `slug-held` and ZERO `differs`. A purchase moved to another account while the guard was off leaves a stale Apple address row on the old account; the backfill now removes such a row (the purchase no longer belongs to that account) and inserts the new owner's. Then `ONE_SITE_GUARD=alert` for about a week, then `1`. Alert records and alerts only; `1` refuses.
6. `ACCOUNT_DRAFTS_IOS=allowlist` with `ACCOUNT_DRAFTS_IOS_USERS`, then `all`. Must be deployed before any 1.2 phone exists. Until it covers an account that account is `web-only`.
7. `DRAFT_PUT_KEEPS_LIVE_URL=1`: a save no longer writes an old live address back. Turn it on before account mode goes wide.
7a. `FREE_IS_WEB=1` (after `ACCOUNT_DRAFTS_IOS` and `DRAFT_PUT_KEEPS_LIVE_URL`, before step 10): a Free account with no published site counts as a web account for the app, so it sees no Apple paywall. Legacy comped customers get there through the admin action `grant-free` (email; refuses an account that holds an Apple address); `revoke-free` (only for an account whose group is exactly `free`) undoes it. It never takes a published site offline, and the lapse sweep skips Free sites (`lib/webApp/lapse.ts`), so after revoking a published comp an admin must take the site offline by hand; a republish then gets 402. `grant-free` also refuses (409) a price-test group (`has-price-group`), a card-plan payer (`has-paid-plan`), and a live Apple purchase or shop link (`apple-account`). Free alone never refuses an Apple purchase tie: an older phone (1.1, ignores `siteMode`) can still buy and tie an Apple purchase on a Free account with no site, which then becomes an Apple account by the existing rule; a published address or card plan still refuses as today. One extra price-group read per kind answer only while the switch is on; a failed read fails closed (plan answer `siteMode: "unknown"`, native gates 503).
8. `GATE_ANY_SOURCE=1`: Move and checkout follow the account kind.
9. Delete and take offline from the app (6a) work in ANY switch order: each is one route that does the right thing for the account, so there is no window where an account has no working delete. They need only `ACCOUNT_PLAN_V2=1` (and the header) for the new fields. **Keep `APP_DELETE_CANCELS_WEB=1` on through any `ACCOUNT_PLAN_V2` rollback**: after a rollback a web payer on 1.2 sees the 1.1 Apple wording until the plan answer carries a mode again, and that is harmless while `APP_DELETE_CANCELS_WEB` is on: a web account deleted through the Apple route still has its card plan cancelled.
10. **1.2 is live in the App Store.** The steps below depend on it: the app's single routes, its `expect` field and its wording from `outcome` exist only in 1.2. (Older phones keep working with every step above: without the header, answers are as before.)
11. `SAFE_TAKE_OFFLINE=1`, after 10 and after `ACCOUNT_PLAN_V2`: "take my website offline" keeps the stored copy and photos instead of deleting them. For the app this means an Apple take offline no longer needs `confirm-purge` (nothing would be purged, `contentKept` is true), a web site's `domainReattachesOnPublish` becomes true, and `lib/publishSite.ts` stops sweeps and old checkout paths from re-publishing a removed site (only the owner's own publish brings it back). Turn it on only when the app words its messages from `outcome`.
12. `AUTH_OUTAGE_503=1`: sign-in outages answer 503 instead of 401 (section 2b). Turn it on together with the 1.2 app, which handles the 503 correctly; older builds treat a 503 as a plain failure.
