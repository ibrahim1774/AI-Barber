# Publish wait: diagnosis

## What the user sees
The red line is the app's own text: PENDING_MESSAGE in src/lib/publish.ts ("Your payment went through. We're finishing your
website - it'll be live in a few minutes."). claim.tsx showed any non-offline `pending` outcome as a red error banner on the
sign-up form (old claim.ts: `{kind:'error', message: out.message}`), so the form came back with red text.

## Why the first attempt fails and the second works
Account creation worked; the first `POST /api/ios/publish` returned something transient and the publish was kept pending
(send() in publish.ts maps every non-final failure to `pending`):
- 404 `not-found` / 503 `apple-unavailable`: Apple's sandbox has not caught up with the fresh purchase (server verify,
  lib/ios/publishFlow.ts VERIFY_STATUS).
- 502 `publish-failed` / 503 `temporarily-unavailable`: first publish creates the Vercel project and deploys (lib/publishSite.ts);
  a failure while it settles.
- Client timeout: the publish is synchronous on the server (api/ios/publish.ts maxDuration 300 s; the deploy "takes minutes")
  but the app aborts at 100 s (api.ts SCRAPE_TIMEOUT_MS). The abort is status 0, shown as "waiting for connection" while the
  server is still deploying. A manual retry about a minute later finds the site live/idempotent (alreadyLive) and succeeds.
- 429 rate-limited.
Nothing retried automatically and the form re-appeared although a session and a pending publish existed.

## Fix (app only)
- publish.ts: `pending` outcomes carry `transient: true` for 0/404/408/425/429/5xx, non-API errors, garbled 200, failed
  transaction lookup. NOT transient: purchase-changed, plan-check, other 4xx. 409 other-account / account-has-site, 402, 400,
  401, site-updated unchanged (never retried).
- claim.ts: the runner retries transient/offline outcomes by itself (2 s doubling to 10 s, 3 min budget, one attempt at a time
  through the existing serial queue and `once` dedupe, stops on unmount), then returns `stalled` (calm text) or `waiting`.
- claim.tsx: once signed in the screen is "Publishing your site..." (spinner), never the form; after the wait one calm message
  and a single "Try again" (resumes the same pending publish: no second account, no paywall). Form shows only without a session
  (a refused session is signed out and returns to the form).

## Proposed server changes (not made)
1. api/ios/publish.ts / lib/ios/publishFlow.ts: answer 425 (or 503 `purchase-not-ready`) with `Retry-After` instead of 404
   `not-found` when Apple does not know a transaction that is < ~10 min old, so the app can tell "catching up" from "bogus".
2. Make publish return 202 + a status poll (or a `publishing` lock returning 409 `in-progress`) rather than holding the request
   up to 300 s; the app's 100 s abort then never races the deploy.
3. lib/publishSite.ts: retry the first-deploy/Vercel-project creation once server-side before returning 502 `publish-failed`.

## Unverified
Exact first-failure code not observed live (no server logs here); diagnosis is from the code paths above.
