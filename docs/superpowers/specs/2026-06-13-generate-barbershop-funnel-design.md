# Design: `/generatebarbershop` Funnel

**Date:** 2026-06-13
**Repo:** AI-Barber (aibarber.org)
**Author:** Ibrahim + Claude
**Status:** Approved — ready for implementation plan

## Goal

Add a new fast-conversion funnel at `/generatebarbershop` that lets a visitor generate a barbershop website from either a shop name OR a Booksy / Fresha / Square / Vagaro / StyleSeat link, then collects only the most essential follow-up details (service area, then phone) via a small docked bar that updates the live preview on every keystroke. After Stripe checkout, the existing post-payment flow takes over: deploy, show the live URL, prompt signup, hand off to the dashboard.

## Non-goals

- Do NOT touch any existing subpage. `/`, `/booksy`, `/free-barber`, `/new`, `/primebarber`, `/recover` must continue to work exactly as today, with their existing components untouched.
- No new pricing tiers. Uses the same monthly/yearly plans the rest of the site uses.
- No new Vercel functions, env vars, or Supabase columns.
- No Squire (squire.com) support unless explicitly added later. "Squire" mentioned in the original spec is interpreted as "Square" — the existing scraper.
- No Apify changes.

## Hard constraints

- **Isolation.** Every new file lives at a new path. No edits to existing components/services/routes beyond the minimum needed to mount the new route. Specifically:
  - `App.tsx`: add one lazy import + one early-return for the new path. Nothing else.
  - `lib/dealMode.ts`: add `GENERATE_BARBERSHOP_PATH` + `isGenerateBarbershopPath()` helper.
  - No changes to `EuphoriaWebsite.tsx`, `PrePaymentBanner.tsx`, `LoadingScreen.tsx`, `GeneratorForm.tsx`, `NewLeadQuizForm.tsx`, `PrimeBarberLanding.tsx`, the API endpoints, the renderer, the pixel code, or the deploy flow.
- Never show error states during generation. Any scrape failure or >5s scrape timeout falls back silently to name-based generation.
- The docked bar appears on reveal, asks one question at a time, and auto-hides once both answered. Dismissible via X.
- The site preview reflects bar inputs on every keystroke. No second "Generate" click.

## Route + entry

- New route: `/generatebarbershop`
- `vercel.json` already SPA-rewrites non-extension paths to `/index.html`, so the route just needs an early-return in `App.tsx` similar to the existing `/recover` path.

## Page state machine

`GenerateBarbershopFunnel.tsx` owns three states:

```
       (typed shopName OR bookingUrl submitted)
input ─────────────────────────────────────────▶ generation
                                                    │
                          (success OR 5s timeout OR scrape error)
                                                    ▼
                                                 reveal
```

| State | UI | Behavior |
|---|---|---|
| `input` | Centered hero: `<h1>Generate your FREE barbershop website in seconds</h1>` + one input (`shopName`) + primary CTA "Generate my website". Below it, an accelerator card: "⚡ Have a Booksy, Squire, Fresha, Square, Vagaro, or StyleSeat link? Paste it and we'll build from your real services & photos" + one input (`bookingUrl`) + secondary CTA "Generate from my link". | Submitting either field transitions to `generation`. The page does NOT collect phone, area, or anything else at this stage. |
| `generation` | Reuse `LoadingScreen` look but with funnel-specific stepped messages. Name path: 3 fake-progress steps ~1s each. Link path: scrape via `/api/import-scrape` with a 5s wall-clock timeout. | If link-path returns within 5s and succeeds → use `buildSiteFromScrape` to merge scrape + typed name into `WebsiteData`. If it times out or returns an error → silently fall back to name-only `generateContent({shopName, area: '', phone: ''})`. User sees the same theater either way. |
| `reveal` | `EuphoriaWebsite` rendered full-screen, scrollable. `DetailCollectionBar` docked center-bottom-but-not-too-large. `PrePaymentBanner` sticky at very bottom. | The funnel passes `siteData` + `setSiteData` down so the bar's keystrokes update the preview live. EuphoriaWebsite's existing in-place editing remains available for everything else. |

## New components — exactly two

### 1. `components/GenerateBarbershopFunnel.tsx`

- Owns `phase: 'input' | 'generation' | 'reveal'`, `shopName`, `bookingUrl`, `siteData`.
- Renders one of three views per phase.
- Generation orchestrator implements the 5s timeout race:
  ```
  if (bookingUrl) {
    const scrapePromise = fetch('/api/import-scrape', { method: 'POST', body: { url: bookingUrl } });
    const timeoutPromise = new Promise(r => setTimeout(() => r({ __timeout: true }), 5_000));
    const winner = await Promise.race([scrapePromise.then(r => r.json()), timeoutPromise]);
    if (winner.__timeout || !winner.ok) {
      // silent fall-through to name-path
    } else {
      siteData = buildSiteFromScrape(winner, { manual: { shopName } });
    }
  }
  if (!siteData) siteData = await generateContent({ shopName, area: '', phone: '' });
  ```
- On `reveal`, mounts `<EuphoriaWebsite siteData={siteData} ... />` with the bar and CTA overlaid.

### 2. `components/DetailCollectionBar.tsx`

- Center-docked, fixed bottom (sits above the `PrePaymentBanner` sticky CTA).
- Sized to feel like an inline assistant — single-line height, ~max-w-md, rounded, soft shadow. Not modal.
- Internal state: `step: 0 | 1 | 'done'`.
- Question 0: "Where's your shop located?" with text input.
- Question 1: "What's your phone number?" with tel input.
- Progress: small pill `1 of 2`, `2 of 2`. No giant progress bar.
- On every keystroke, fires `onChange({ field: 'area' | 'phone', value })` so the parent updates `siteData` and the renderer re-paints.
- "Next" button advances to step 1; submitting step 1 sets `step='done'` and triggers a slide-down animation. The bar unmounts after the animation.
- X dismisses immediately, keeping whatever was typed.

## Helper additions

- `lib/dealMode.ts`: add `GENERATE_BARBERSHOP_PATH = '/generatebarbershop'` and `isGenerateBarbershopPath()` — same pattern as `isRecoverPath`.
- `App.tsx`: add a lazy import for `GenerateBarbershopFunnel`, add an early-return when `isGenerateBarbershopPath()` matches (mirrors the existing `/recover` early-return). No other changes.

## Reuse map

| Capability | Source | Modifications |
|---|---|---|
| Scrape ingest (5 platforms) | `api/import-scrape` (existing endpoint) | None |
| Scrape → WebsiteData merge | `lib/buildSiteFromScrape.ts` (existing) | None |
| Name-only generation | `services/geminiService.ts:generateContent` (existing) | None |
| Site renderer + inline editor | `components/EuphoriaWebsite.tsx` (existing) | None — the funnel passes `siteData` and the editor handles section-level edits |
| Sticky launch CTA + embedded Stripe | `components/PrePaymentBanner.tsx` (existing) | None |
| Stripe success URL building | `api/create-checkout-session.ts` (existing) | None — same `?stripe_session=…&plan=…` |
| Post-payment deploy + Purchase pixel | `App.tsx:handleStripeReturn` (existing, today's pixel-fire-before-deploy fix lives here) | None |
| Post-deployment modal + signup | `components/PostDeploymentModal.tsx`, `components/AuthModal.tsx` (existing) | None |
| Dashboard + Supabase upsert | `handleAuthSuccess` → `upsertSiteToSupabase` (existing) | None |

## Live keystroke update mechanics

`GenerateBarbershopFunnel` holds the single source of truth for `siteData`. `DetailCollectionBar` is fully controlled. When the bar emits `onChange({field: 'area', value: 'Beverly Hills, CA'})`, the funnel does:

```
setSiteData(prev => ({ ...prev, area: value }))
```

`EuphoriaWebsite` already re-renders when its `siteData` prop changes (this is how its inline editor works). Result: typing in the bar visibly updates the contact strip + footer of the preview in real time. Same for phone.

## Post-payment flow (no new code)

1. Visitor clicks "Launch My Site" in the sticky `PrePaymentBanner`.
2. `PrePaymentBanner` calls `onPrepareCheckout(planSlug)` → `preparePendingSite` writes the pending site to GCS + localStorage and returns a `clientSecret` for embedded Stripe.
3. Stripe checkout opens embedded. On success Stripe redirects to `${origin}?stripe_session={CHECKOUT_SESSION_ID}&plan=monthly`.
4. `App.tsx` mount-time `useEffect` detects `stripe_session` → calls `handleStripeReturn(sessionId, plan)`.
5. `handleStripeReturn` verifies the session, fires the Purchase pixel (Meta + TikTok, browser + CAPI) BEFORE the deploy (per today's fix at `App.tsx:5de4d56`), then deploys the site via `/api/deploy-site`.
6. On deploy success, `PostDeploymentModal` opens with the actual `*.vercel.app` URL, copy button, and "Save my site to my account" CTA.
7. CTA opens `AuthModal` in signup mode → `handleAuthSuccess` upserts the SiteInstance to Supabase under the new `user_id` → routes to dashboard.
8. Dashboard shows the site card; "Edit My Site" opens the existing editor with the full `WebsiteData`; edits persist via the existing `saveSite` flow.

None of steps 4–8 are new code. They are the exact path every existing entry point uses.

## Test plan

Manual verification (no automated tests in this codebase pattern):

1. Visit `/generatebarbershop` → hero loads, both inputs present, no error states visible.
2. Type a shop name only → submit → see stepped progress → site reveals with that shop name in hero/footer/contact strip.
3. Paste a real Booksy URL → submit → see "Found your Booksy ✓ Importing 8 services ✓ Adding your photos ✓" within 5s → site reveals with scraped services, photos, address.
4. Paste a deliberately broken URL → silently falls back after 5s → site reveals with name-only content. No alert/banner shown.
5. On reveal, the docked bar appears with "Where's your shop located?". Type → contact strip in preview updates per-keystroke.
6. Click Next → "What's your phone number?". Type → footer / contact strip phone updates per-keystroke.
7. Submit phone → bar slides down and unmounts. Sticky launch CTA stays at the bottom.
8. X the bar mid-flow → bar disappears; whatever was typed remains applied.
9. Click Launch My Site → embedded Stripe modal opens.
10. Complete checkout with a test card on the preview deploy → post-payment screen shows the real `*.vercel.app` URL, signup modal opens with email locked.
11. Sign up → land in dashboard → site card shows correct deployed URL.
12. Edit My Site → editor opens with all content prefilled → edit any section → save → confirm Supabase row updated.
13. Visit each of `/`, `/booksy`, `/free-barber`, `/new`, `/primebarber`, `/recover` → verify zero regressions (each renders + functions as before).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Touching `App.tsx` introduces a regression in an existing path | Add the new path's early-return BEFORE all existing path checks, in a single 3-line block, mirroring the `/recover` pattern. Diff should be < 10 lines in `App.tsx`. |
| `EuphoriaWebsite` was designed for the legacy `/` flow and may behave oddly when receiving `siteData` from a different parent | Pass the same `WebsiteData` shape; preview-only mode is already used by `/booksy` and `/free-barber` so the props contract is proven. |
| 5s timeout cuts off a slow-but-valid scrape | 5s matches the spec. If real users hit this often we can extend post-launch. The fallback is graceful. |
| `DetailCollectionBar` z-index conflicts with PrePaymentBanner sticky CTA | Bar sits at `bottom: 88px` (above the CTA's ~72px height). Both use `z-50` and `z-40` respectively. |

## Out-of-scope follow-ups (do NOT implement now)

- Squire (squire.com) scraper.
- Multi-language hero copy.
- A/B test variant of the hero.
- Saving the typed shopName to session storage so a reload preserves state.
- Adding `/generatebarbershop` to the homepage nav.

## File inventory

**New files:**
- `components/GenerateBarbershopFunnel.tsx`
- `components/DetailCollectionBar.tsx`

**Modified files (minimal edits only):**
- `App.tsx` — one lazy import + one early-return block.
- `lib/dealMode.ts` — one constant + one helper.

**Untouched:** every other file in the repo, including all existing components, services, API endpoints, scrapers, and shared utilities.
