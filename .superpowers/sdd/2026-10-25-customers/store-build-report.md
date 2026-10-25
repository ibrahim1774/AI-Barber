# Store build report (2026-10-25)
- Commit 2ef7db0 (e2e-pressure): app.json ios.privacyManifests NSPrivacyTracking=true, tracking domains appsflyersdk.com + appsflyer-skadnetwork.com (only SDK that tracks; no Meta SDK in app; PostHog/RevenueCat/Superwall not declared). expo-image-picker microphonePermission=false. Test __tests__/appConfig.test.ts. tsc clean, jest 121 suites/1782 tests pass.
- NSPrivacyCollectedDataTypes not added to app manifest (ASC answers govern; avoided over-declaring).
- Build: /Users/ibrahim/builds/pb-store.ipa, 1.0.0 (18), Apple Distribution cert (existing dist.p12) + AIBarber_AppStore profile (no devices). Verified in ipa: NSPrivacyTracking true, domains present, no mic string. No new certs.
- credentials.json temporarily pointed at App Store profile, then restored to ad hoc (backup also at ~/.aibarber-signing/credentials.adhoc.json). eas.json unchanged (ASC key args injected temporarily for submit, then reverted).
- eas submit uploaded OK (needs ASC API key in eas.json submit profile in non-interactive mode). ASC API: build 18 processingState VALID. Not attached to version, not submitted for review.
