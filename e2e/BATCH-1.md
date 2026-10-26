# E2E batch 1 (HEAD 1e221f4, sim abi-pm17 iPhone 17 Pro Max, stub + fresh Metro on 8091)

Build note: no new native build. package.json/app.json/ios inputs are unchanged since the existing Debug dev-client in
/Users/ibrahim/builds/pb-sim (built 02:32); JS comes from Metro at HEAD. Free disk was 3.4 GB at start (not 6), so a full
xcodebuild was skipped to stay above the 2 GB guard. The old Metro (pid 40678, started 02:11) served a STALE bundle (old
Address/services form); I started a fresh Metro on 8091 (_launch.yaml and start-metro.sh now take that port).
DISK GUARD TRIPPED at 258 MB free after creating a second simulator (iPhone 11 Pro); sim deleted, Metro and Maestro driver killed, own raw output removed. Free now 1.7 GB. Run stopped.

| Test | Result | Evidence (e2e/shots/) | Notes |
|---|---|---|---|
| T1 Start Back | PASS | t1_booking_back, t1_google_back, t1_scratch_back, t1_cancel_dialog, t1_after_cancel | '< Back' top-left on all three; returns to start. 'Cancel and go back?' appears during a running generation (booking link, stub import hung); Keep going stays, Cancel and go back returns. The scratch build finishes too fast to catch locally. Flow t1_start_back.yaml |
| T2 Scratch | FAIL (S2) | t2_form, t2_keypad, t2_build_reachable, t2_site_mid, t2_site_low, t2_menu | PASS: 3 fields (name, local service area, phone), no address/services picker, Done bar dismisses keypad, Build reachable, Gallery ('The Look') + Services ('What we offer') present, no reviews. FAIL: no 'Book Now' anywhere: hero says 'Call Now', menu is Home/Services/Contact. Suspect src/web/lib/render/labels.ts:137 (primeNavBook shows only when primeBook, i.e. with a booking link). Note: 6 colour swatches sit under the fields (not a field). Flow t2_scratch.yaml (Book Now step is optional) |
| T8 Settings | PARTIAL / FAIL (S2) | t8_settings_top, t8_intro_a/b, t8_cards_1..6, t8_offline_dialog, t8_delete_dialog | PASS: 'Learn how it works' highlighted (NEW) card is first on Settings; page opens; all 8 players present (intro, editing, no-account, calendar, store, domain, notifications, team); offline + delete dialogs open and were cancelled. Intro frames change after Replay (a/b differ). Editing verified playing via Replay in a probe. FAIL: tapping the video ('Play video') did not start playback (intro and editing, 3 tries; badge 'Tap to play' stays), only 'Replay' starts it; suspect src/components/LearnVideo.tsx:47-49 (toggle after the video has ended). Other 6 not individually motion-verified. A11y: 'Replay'/'Play video' inside cards are not reachable by label (card has accessibilityLabel at src/app/(tabs)/settings/learn.tsx:21). Flow t8_settings.yaml |
| T9 Layout | NOT RUN | t9_bookings, t9_store (blank: inconclusive) | Run on pm17 only, headers rendered blank in capture; iPhone 11 Pro never ran (disk guard). Flow t9_headers.yaml |
| T11 Sign-in/forgot | NOT RUN | none | Stopped by disk guard before starting. Needs QA credentials from review notes. |
