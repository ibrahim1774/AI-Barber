# Admin site edits: change, replace or republish any app customer's site without their phone

**Ask (Ibrahim, 2026-10-21):** "make sure the site is done and published in a way where I can edit the site easily, fix any functionality issues, implement anything easily through the Vercel URL and through Claude if they have some kind of internal app issue… I mean changing or replacing or republishing any website without their phone."

## Today
- Every app customer's site content is stored server-side in GCS `pending-sites/{slug}.json` (`{ siteId, savedAt, data: { siteData, imageUrlMap, deployedUrl, … } }`), written on each iOS publish (`lib/ios/publishFlow.ts`, `lib/publishSite.ts` read/writePendingSite).
- Each site is its own Vercel project/alias, deployed by `lib/deploySite.ts` from the rendered HTML (`lib/render/{luxe,prime,euphoria}.ts`).
- `ios_purchases` links `original_transaction_id` → `site_slug`, `user_id`, product/tier.
- The web admin (`/admin`, `components/AdminDashboard.tsx`, `api/admin-overview.ts`) is gated to `ADMIN_EMAIL = ibrahim3709@gmail.com` via a Supabase bearer token. It covers web customers only.
- The app keeps its own copy of the site and sends it on every publish, so a server-side edit would be overwritten by the barber's next publish.

## Goals
1. **Find** any app site by shop name, slug/site address, customer email, or transaction id.
2. **Change**: edit fields (name, phone, address, hours, services and prices, about text, booking link, accent/template, images by URL) and republish.
3. **Replace**: overwrite the whole siteData (e.g. a regenerated site) and republish.
4. **Republish**: one site, or every app site (after a template/renderer fix), from the stored copy, with the tier link rules applied exactly as a normal publish.
5. **Never lost to the phone**: an admin edit bumps a version; the app adopts the newer server copy before the barber edits or publishes, with a one-line notice ("Your site was updated by AI Barber support.").
6. **Usable by Claude**: a CLI with the same operations plus a runbook, so a future Claude session can do it from "fix the hours on Fade Lab's site".

## Non-goals
- No customer-facing changes beyond the sync notice. No change to how barbers publish.
- No custom domains, no per-site code forks: every site still renders from the shared templates.

## Design (decided)
- **Server core** `lib/admin/sites.ts` (pure, dependency-injected like the rest of `lib/`):
  - `findSites(query)` → rows `{ slug, shopName, email, deployedUrl, template, tier, active, publishedAt, version }` joining `ios_purchases`, auth users (email) and the pending copy.
  - `getSite(slug)` → stored `siteData` (image URLs restored), `deployedUrl`, `version`.
  - `updateSite(slug, { patch? | replace?, note })` → validates (same validation as publish), applies the tier link rules for the purchase's current tier, renders, deploys to the SAME project/alias, writes the pending copy with `version + 1`, `editedBy: 'admin'`, `editedAt`, keeps the previous copy as `pending-sites-history/{slug}/{version}.json` (rollback), records `ab_events`/console audit.
  - `republish(slug)` and `republishAll({ dryRun, limit })` → render from the stored copy with current templates; never changes content; skips revoked/taken-down rows; returns per-site results.
  - `rollback(slug, version)`.
- **Admin API** `api/admin/sites.ts` (GET search/get, POST update/replace/republish/republish-all/rollback), auth = the same ADMIN_EMAIL bearer check as `api/admin-overview.ts` (share one helper), rate-limited, `maxDuration` long enough for republish-all batches.
- **Admin UI**: an "App sites" tab in `components/AdminDashboard.tsx`: search box → list → site panel with a preview link (deployedUrl), quick fields, a JSON editor for full replace, Republish, Rollback, and a "Republish all app sites" button with dry run first.
- **CLI** `scripts/admin-sites.mjs` (service-role env from `vercel env pull`), commands: `find`, `show`, `set <slug> <path>=<value>…`, `replace <slug> <file.json>`, `republish <slug>`, `republish-all [--dry-run]`, `rollback <slug> <version>`, all calling `lib/admin/sites.ts`.
- **Version on the iOS path**: `/api/ios/publish` writes `version + 1` and `editedBy: 'owner'`; `GET /api/ios/site` returns `version` and `editedBy`/`editedAt`. A publish carrying an older `baseVersion` than the stored admin version is rejected with `409 site-updated` + the server copy, so a phone that missed the sync can never silently overwrite an admin edit.
- **App**: store `serverVersion` on the site record; on launch, on Edit tab focus, and before publish, call `GET /api/ios/site`; if the server version is newer and was edited by admin, adopt the server siteData (keep the barber's Book-button choice inputs) and show the notice once; send `baseVersion` on publish; on `409 site-updated`, adopt and tell the barber to review and publish again.
- **Runbook** `docs/RUNBOOK-app-sites.md` in AI-Barber + a pointer line in the repo's CLAUDE.md (create if missing): how to find a site, edit, replace, republish one/all, roll back, and what the app does.

## Constraints
- Admin auth only via ADMIN_EMAIL bearer token (server) or service-role env (CLI). Never expose the service role to the browser.
- All writes keep a history copy first (rollback must always be possible).
- Republish-all is batched, idempotent and resumable; dry run by default in the UI.
- No migrations needed unless an audit table is unavoidable (prefer `ab_events`).
- Existing tests stay green; TDD for the new core.
