# Web draft and paid publish recovery

Implementation is local and opt-in. It has NOT been activated on aibarber.org or the staging backend.

## Behavior

- Web-only canonical drafts use a server revision and conditional writes. Failed writes do not advance the client's merge baseline. Independent field edits merge after a CAS conflict. Merge baselines are private to each browser tab, and storage events refresh another open editor rather than replaying its stale fields. Conflicting edits keep the local copy in the editor until the user picks one; the remote copy is in the server's last-20 revision history. The browser's conflict snapshot is a single slot (the latest conflict overwrites it) and has no restore screen after a reload, so this is NOT a promise to retain both copies indefinitely. The database retains the last 20 acknowledged revisions.
- Existing signup fields and password policy are unchanged. Account adoption still runs before switching users; the subsequent draft upload runs in the background. Checkout waits for a real save acknowledgement, rejects unfinished uploads/transient images, and performs no client network work for an unchanged, acknowledged draft. A stale receipt is refreshed once rather than trapping the user in a retry loop.
- Checkout renders/validates the owned revision, stores an immutable publish submission, and attaches its Stripe session before returning a payable URL. Background save and the subscription payment are separate from deployment.
- Tagged subscription webhooks wake jobs. An authenticated cron reconciles Stripe and retries pending jobs when the browser is closed, including entitlement reconstruction after a missed webhook. A paid hosting subscription covers retrying/replacing a submitted website; retry never creates another charge.
- Each account/environment has a deployment lease. SQL serializes submission pointer updates against lease acquisition. Draft editing remains available during a deploy. New publication requests wait/retry while a publish is running. Old/superseded jobs do not replace newer submissions. Worker tokens prevent an expired invocation completing a replacement worker's record.
- The editor can show publishing failure while retaining its draft. Publish submits the current acknowledged revision; Retry publish retries the immutable submitted version. New edits stay unpublished until an explicit Publish. Live is shown after the server job confirms successful deployment.
- Offline/deletion actions suspend/cancel work before removal. Failed deletion can resume explicit work without resurrecting old jobs. Foreign keys remove drafts/jobs/history when the shared auth account is deleted.

## Separation and existing-data constraints

The new tables, routes, Stripe metadata and flags are web-only. No iOS purchase table, native config, auth password policy or iOS publishing route is changed. Shared account deletion remains the existing GLOBAL auth-account deletion behavior; it is not a promise of separate web/iOS account deletion.

Legacy builds stored web drafts with source='ios'. Do not blindly import those rows into the new web storage. `scripts/backfill-web-drafts.ts` is dry-run by default and copies only an exact URL match to a proven web_app_sites binding. Legacy unpublished drafts without provenance require review; keep their old rows and existing browser storage, and do not enable this rollout for affected users until migration/recovery is resolved. This is a release gate, not a claim that all legacy drafts have already migrated.

## Release gates and known limits (not fixed here)

- GATE (legacy drafts): with EXPO_PUBLIC_WEB_DRAFTS=1 the client reads only `/api/web-app/draft`, and no longer writes the legacy `sites` row on web. A user whose only unpublished web draft is in `sites` would sign in on a new browser and see an empty editor. Do not enable this for a user until the backfill/review of legacy drafts has covered them. Optional later fix: fall back to the legacy `sites` query when GET /draft returns null and save that row through the draft engine.
- The conflict snapshot is a single slot (see Behavior). Merge baselines are per tab, so a new tab or browser with a different local copy gets a whole-site conflict prompt rather than a merge.
- Local edits that have not been acknowledged by a PUT live only in browser storage.
- `GET /api/web-app/me` (display fields: kept subscription preference, cancelAtPeriodEnd, currentPeriodEnd) and the slots and luxe renderer changes are NOT behind WEB_APP_RELIABILITY; they take effect on merge. Visually check luxe at 768/834/1024 px before merging.
- Ship the matched web client BEFORE flipping WEB_APP_RELIABILITY on the server. With the flag on, only a publish-with-checkout needs a saved draft (`draftId` + `revision`); an old cached client that sends `publish: true` without them gets 400 `client_outdated`, and plain upgrades/domain checkouts are never blocked.
- Merge the server and client branches together (the client's `src/web/SOURCE` pins the server branch).
- Cron work is bounded: unlinked checkouts older than 1 hour and expired sessions are cancelled, a failing job is parked (cancelled, logged) after 20 attempts, queued/failed work is served before payment polling, and a batch is at most 10 rows. `POST /api/web-app/publish-status` honours the retry backoff and is limited to 6 per user per minute; draft PUT is limited to 120 per user per minute (per instance).
- Republish semantics: pressing Publish again for unchanged content that is already `live` re-queues and deploys again; taking the site offline clears the draft's `deployed_url`/`published_binding` and retires `live` submissions. A checkout creates its Stripe session before the earlier unpaid submission is superseded; a payment on a superseded session publishes the newest submission.

## Rollout order

1. Review/upload the feature branches to the explicitly approved GitHub destinations. An earlier automatic approval review rejected the server push as unverified private-code egress. Do not bypass it through a direct deployment.
2. Check the staging database migration history and backup/recovery process. Apply additive migration 025; verify all three tables, FK cascades, service-only permissions, archive trigger and submission RPC. Do not change shared auth URLs/password policy.
3. Dry-run `node --import tsx scripts/backfill-web-drafts.ts --mode=test`. Review unresolved legacy rows. Use `--apply` only for the reviewed mode; this does not overwrite existing canonical drafts or delete legacy data.
4. Deploy the server revision with WEB_APP_RELIABILITY off. Build/deploy the matched web client with EXPO_PUBLIC_WEB_DRAFTS=1 in the test environment, then (client first, server flag second) enable WEB_APP_RELIABILITY=1 on that staging backend. Existing WEB_APP_CHECKOUT, WEB_APP_ENTITLEMENTS, test Stripe key/prices, service role and CRON_SECRET are also required. The new cron runs each minute with maxDuration 300.
5. Exercise a real Stripe TEST checkout, close the tab before the return, confirm cron publication, then test editable failure recovery and a paid republish. Confirm the canonical row/intent/deployed HTML agree on ownership and content. Repeat from a clean mobile browser and test an actual auth reset link. Local simulated-service browser checks are not substitutes for these staging checks.
6. Only after staging and legacy recovery pass, review production activation separately. No real-money payment or production activation is part of the current local verification.

## Verification and practical limits

The committed tests use local PostgreSQL (PGlite) with the exact migration, plus simulated Stripe/deployment services. They cover CAS saves, immutable checkout snapshots, session persistence, data access isolation, retained history, browser-independent recovery, duplicate delivery, deployment retry, newer edits during publishing, stale submissions, missed webhook reconciliation and offline/deletion races. Client tests cover same-field choices, save/read failures, cached receipts, timeout rejection, asset gates and return-state recovery. The broader suites, client typecheck and web export are recorded in the accompanying review note. Local browser assertions cover 1280/1920/2560-pixel icon/layout sizing, editing during a failed publish, separate-field merge, a rejected save and recovery, paid republish without checkout, and restoration in a clean emulated mobile browser.

This does not guarantee zero failures. Offline edits need a successful upload before another device can see them. Clearing local storage before that acknowledgement can lose local-only changes. Stripe, email, storage and deployment outages can delay recovery. Unexpected external deployment completion after a killed invocation remains dependent on the deployment service and the existing stored-copy reconciliation. Safari/physical-device and post-rollout staging checks are still required.
