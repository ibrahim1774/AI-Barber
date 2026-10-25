# App stream, vendor + A5 report (2026-10-25)

Repo /Users/ibrahim/abi-e2e, branch e2e-pressure, not pushed. tsc clean; full jest: 141 suites, 1942 tests pass.

## V1 (re-vendor)
~/AI-Barber pulled to main 9f36a35 (PR #260). scripts/sync-web.sh (no SYNC_REF): src/web/SOURCE = 9f36a35. Diff touches only src/web/** (SOURCE, labels, shell, site, luxe, prime, euphoria: the footerCredit label). __tests__/footerCredit.test.ts: footerCredit is a tap target for all three designs, title "Footer credit", max 60, default "Built by Prime Barber".

## A1
Server-only publish guard (drops /book when bookings are off) is merged. No renderer file changed for it; the vendored renderer is the merged main and every existing renderer/golden-style app test (ctaButtons completeness, preview, editor) passes unchanged.

## A5 (was not covered by A2-A4)
- BookButtonPicker: options renamed "Booking link" / "Built-in scheduler" (detail copy per plan); new optional "Edit link" row.
- SetupHub: Edit link opens the same ButtonSheet in Book mode (main Book label key), saves via applyButtonChange + updateSiteRecord, offers the update prompt; tracks book_target_set (no URL).
- setupPrompt: bookings-off cases add the reason line (BOOKINGS_OFF_OWN / BOOKINGS_OFF_HIDDEN).
- Tests: __tests__/setupBookTarget.test.tsx (new); updated setupPrompt, bookButtonPicker, setupHubChoice tests.

## Not done
No simulator pass; no EAS build.
