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
| `account` | A web account the rollout covers | Uses the draft store and the drafted publish (sections 3 and 4). The draft is the only copy that is edited. No old iOS publish, no old Restore. |
| `web-only` | A web account the rollout does not cover yet, including while the switch is fully off | No editing, no autosave, no paywall, no publish. Show the "your website is managed on the web" text. Every draft, publish and kept-copy call answers 403 `not-account-mode`. |
| `device` | Apple accounts, two-site accounts, and accounts with nothing yet | Today's behaviour exactly: the phone copy, `/api/ios/publish`, `/api/ios/site`, the Apple paywall. |

Rules:

- If the plan answer fails and nothing is stored for this account: show "Checking your plan. Try again." with a Try again button. No paywall, no editor, no autosave. If an earlier answer is stored, use it until a fresh one arrives.
- `device` without a server answer is only for a signed-out phone.
- A web account is never `device`. If the answer says `web-only` the app must not fall back to the Apple flow.

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

- 409 `use-account-publish`: the account is a web account (mode `account` or `web-only`). Never use these routes for it. Go by `siteMode`.
- 503 `temporarily-unavailable`: the mode could not be decided. Try again later.
- Otherwise the route answers as before.

`POST /api/ios/publish` can answer **409 `account-has-site`** with `{ slug, reason }`:

- `reason: "web-account"`: this account already has (or is publishing) a website on the web. `slug` is that address, or an empty string when it has none yet. Do not say the account has a live website when `slug` is empty.
- `reason: "other-apple-id"`: the account's website belongs to a subscription bought with a different Apple ID. `slug` is that website's address.
- `reason: "mixed"`: the account would hold two websites. `slug` may be empty.
- In all cases the new subscription was not used and nothing changed on the website. Builds that only know `account-has-site` keep working: they read `slug`, and anything but `reason: "shop"` counts as "site".

## 7. Plan check and shop setup

- `POST /api/shop/plan` `{ transactionId }`: 200 with the current plan when the purchase may not be tied to this account (nothing is linked; the answer is the plan as it was). 503 `temporarily-unavailable` when the server could not decide: show a retry, never "no plan".
- `POST /api/shop/setup`: 503 `temporarily-unavailable` is answered before anything is created, so a retry is safe. When the purchase may not be tied, the shop is still set up and `shop.purchaseLinked` is `false`.
- `GET /api/shop/plan` also returns `kind` (`web`, `apple`, `mixed`, `neither`), `site`, and `capabilities.siteMode` when the plan answer is on.

## 8. Switches and the order they go on

All default to off. With every switch off the server behaves exactly as before.

1. Migrations 038, 039, 040 and 041 applied (nobody applies them without the owner's go).
2. Backfill (`scripts/one-account-backfill.ts`, dry run first, then `--apply --yes-production`) and the re-count script.
3. `ACCOUNT_PLAN_V2=1`: the plan answer gains `kind`, `site`, `capabilities.siteMode`.
4. `ONE_SITE_GUARD=alert` for about a week, then `1`. Alert records and alerts only; `1` refuses.
5. `WEB_APP_ENTITLEMENTS`, `WEB_APP_CHECKOUT`, `WEB_APP_RELIABILITY` on (the draft, publish and kept-copy endpoints need them).
6. `ACCOUNT_DRAFTS_IOS=allowlist` with `ACCOUNT_DRAFTS_IOS_USERS`, then `all`. Must be deployed before any 1.2 phone exists. Until it covers an account that account is `web-only`.
7. `DRAFT_PUT_KEEPS_LIVE_URL=1`: a save no longer writes an old live address back. Turn it on before account mode goes wide.
8. `GATE_ANY_SOURCE=1`: Move and checkout follow the account kind.
