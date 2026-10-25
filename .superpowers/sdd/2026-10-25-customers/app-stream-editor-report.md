# App stream, editor side: report (2026-10-25)

Repo /Users/ibrahim/abi-e2e, branch e2e-pressure, not pushed. tsc clean; full jest: 136 suites, 1908 tests pass.
Vendored renderer untouched (src/web/SOURCE still ea3c927). No renderer change was needed for anything below.

## Commits (one per task, each ends with the Co-Authored-By line)
1. B1  Editor preview: hamburger menu opens, entries switch page, long press edits the label
2. A2  Book target: link rules and choice helpers
3. A3  Editor: registry of call-to-action buttons
4. A4  Editor: tap a button to edit its text and link; Book buttons choose link or scheduler

## B1
- editorScript.ts: burger label toggles #ab-nav-toggle; tap on a .ab-nav-list / .ab-foot-pages link posts {type:'nav', href} and closes the menu; 600 ms press with <10 px movement posts the existing `edit` for the entry's label (timer on pointerdown, so it does not rely on a click after a long press); the "More" <details> toggles; in-page #anchors scroll.
- previewBridge.ts: `nav` message accepted only if href is in pageHrefsFor(data) (page files from buildPageSet + /book + /shop, max 200 chars). shouldAllowPreviewRequest unchanged. No new window globals.
- editable.ts pageForHref; SitePreview onNavigate; edit.tsx onPreviewNav (page switch via setWantedPage; /book and /shop open the button sheet through navLabelKey for the design). track('preview_nav', {page key}).
- Deviation: a `#` anchor that contains editable text (e.g. "View services") still edits its text rather than scrolling, so CTA editing is not lost on single-page sites. Menu `#` entries and plain `#` links scroll.
- Tests: previewNav.test.ts, editorMenu.test.ts (jsdom, real EDITOR_JS).

## A2
- src/lib/linkRules.ts (normalizeBookingLink: https only, no http/javascript/data/vbscript/file, no quotes/angle/backtick/whitespace, no userinfo, host needs a dot, rejects Prime Barber's own page, "//evil.com"; normalizePhone: 7-15 digits, phone characters only; normalizeAddress). Hand-parsed, no `new URL` (Hermes).
- bookingChoice.ts: schedulerLive (shared by resolveLinks), bookTargetStatus (live | bookings-off | no-plan | not-linked | unknown, plus fallback link|none), setOwnLink. bookingPrefs/migrateBooking/resolveLinks behaviour unchanged.
- Tests: linkRules.test.ts, bookTarget.test.ts (includes the commitRecord/syncOwnLink round trip both ways).

## A3
- src/lib/ctaButtons.ts: CTA_KINDS, ctaKindOf, MAIN_BOOK_KEY, routeTap. Added navShop/primeNavShop/euNavShop (shop) beyond the plan's list.
- Completeness test renders luxe/prime/euphoria, single and multi page, bookingUrl in {/book, booksy, none}, every page, and asserts every Book/tel:/maps anchor holds a registered label (or `phone`/`contact.address`). It also asserts the scan really sees book, call and (multi-page) directions anchors. It found no gaps.
- Prime's phone link is data-edit="phone" and stays the plain phone box, as the plan allows.

## A4 (done here because the sheet is the stated behaviour; it needed no new renderer)
- ButtonSheet.tsx: Button text for all; Book = "Booking link" / "Built-in scheduler" radios (applies to every Book button), URL field, warnings per bookTargetStatus with Open Setup / See plans, double-booking and team notes; Call = phone field; Directions = address; Shop read-only; in-site text only. Errors use the plan copy. An unchanged saved link is not re-validated, so an older http link does not block a text edit.
- buttonChange.ts applyButtonChange: one commitRecord for text + phone/address + Book (withChoice(setOwnLink(...))).
- edit.tsx: routeTap decides button sheet vs text box for preview taps and All-fields rows (bookingUrl now opens Book mode). track('button_sheet_opened',{kind}), track('book_target_set',{target}); no URL/phone/address in analytics. Open Setup -> /bookings-setup; See plans -> useUpgrade('bookings_upgrade').run().

## Not done / remaining
- A5 (SetupHub bookings-off prompt, BookButtonPicker rename + "Edit link" row opening ButtonSheet, setupPrompt copy) is app-only but outside the requested scope: not started.
- A1 (server publish guard: drop /book when bookings_enabled is false) is server PR #260 (book-target) and is not vendored; nothing in this branch depends on it. After it merges: V1 = scripts/sync-web.sh (SYNC_REF only if the merge SHA is not yet main), confirm src/web/SOURCE, re-run jest; S1 footer credit is separate.
- Not run: simulator pass of the plan's manual checks (burger, long press on a real WKWebView, each CTA in each design, A->B->A across all Book buttons). Long press depends on WKWebView delivering pointer events (iOS 13+); worth one device check.
- No Maestro flow asserted the old Book-button text sheet (grep found none).
