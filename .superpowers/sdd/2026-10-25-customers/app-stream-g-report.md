# App stream G: report (2026-10-25)
Repo /Users/ibrahim/abi-e2e, branch e2e-pressure, not pushed. tsc clean; full jest 142 suites, 1941 tests pass. Vendored files untouched.

## G1 (commit 1)
- Settings moved to src/app/(tabs)/settings/index.tsx with a Stack _layout; new settings/learn.tsx ("Learn how it works") opened from a Help-section row (tab bar stays; /settings still resolves).
- Page lists 7 features: edit site text/photos any time, customers book without an account, built-in calendar, sell products, custom domain, push notifications, team (src/lib/learnContent.ts).
- Video slot: LearnVideo (src/components/LearnVideo.tsx) plays a bundled mp4 registered in src/lib/learnVideos.ts (assets/tutorial/<slug>.mp4; Metro needs a static require, so the line is uncommented when a file is added); renders nothing when absent. Slugs: intro, editing, bookings, store, payments.
- Removed: Tutorial section and replay rows, TutorialEntry, /tutorial and /tutorial-topic screens, tutorialTopics, tutorialVideos, requestTour/takeTourRequest plumbing and its tests. First-run in-screen tours (TutorialLayer, useTour) kept.
- Tests: __tests__/learnHowItWorks.test.tsx; tutorial.test.tsx updated.

## Item 6 (commit 2)
- __tests__/visibleTextEditable.test.ts renders every page of luxe/prime/euphoria (single and multi-page, editable preview) and fails on any visible text outside a data-edit tap target. Result: no gaps. footerCredit is already vendored and editable (labels.footerCredit, max 60) in all three designs; test asserts the tap target and edited text.
- Intentionally not editable (allow list in the test): review quote, author and source line, numbers/ratings/years/numerals, avatar initials, and the generated "Copyright (c) year" stem.
- Renderer/server changes needed: none.
