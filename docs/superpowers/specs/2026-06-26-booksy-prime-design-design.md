# /booksy Two-Design Switcher — Design Spec

**Date:** 2026-06-26
**Repo:** AI-Barber (aibarber.org), worktree off `origin/main` (HEAD `a13ac77`, PR #91)
**Scope:** The `/booksy` subpage ONLY. `/generate`, homepage, `/free-barber` are untouched.

## Goal

Give `/booksy` two switchable generated-site designs (like PrimeHub's landscaping system): a pre-generate picker AND an in-editor floating switcher. Switching keeps all content and just re-skins, with a brief loading icon. Whatever design is active at publish is what ships and stays editable in the dashboard.

- **Design 1 = `template:'luxe'`** — the current `/booksy` default (`GeneratedWebsite.tsx`). Unchanged.
- **Design 2 = `template:'prime'`** (new) — a faithful port of PrimeHub's **`EuphoriaBarberRenderer`**, the live primehub.dev/barber "Premium Cuts" design (dark canvas, gold accent, Newsreader serif italic headings, Inter body).

Sections that were pulled (scraped) render; sections without data are hidden (no empty sections). Design 2 natively shows reviews, hours, services-with-prices, and a gallery — each conditional on data presence.

## Architecture

Both designs read the **same `WebsiteData` object**, guaranteeing lossless switching (no re-scrape) — the landscaping shared-model pattern. App.tsx already dispatches the editor renderer on `data.template`; we add a third branch.

```
TemplateId = 'luxe' | 'euphoria' | 'prime'
data.template === 'prime'  →  <PrimeWebsite ... />        (new)
data.template === 'euphoria' →  <EuphoriaWebsite ... />   (existing)
else                       →  <GeneratedWebsite ... />    (existing, Design 1)
```

`PrimeWebsite.tsx` is one focused component file that (a) resolves a local view-model from `WebsiteData`, (b) renders the Euphoria-barber sections, (c) writes edits back to `WebsiteData` paths, and (d) exports `generatePrimeHTMLWithPlaceholders()` for deploy.

## Component: `components/PrimeWebsite.tsx`

Reuses AI-Barber's existing primitives — `EditableText` (`{text, onSave, className, tagName}`), `compressImage(file)`, `ImageOverlay`, `ImagePlaceholder` — and AI-Barber's `AIB_THEMES` color system, NOT PrimeHub's. Visual fidelity target: the live primehub.dev/barber screenshot (`primehub-barber-live.jpeg`).

### Visual language (from EuphoriaBarberRenderer)
- **Fonts:** Newsreader (serif, italic display headings), Inter (sans body). Google Fonts injected in the deploy `<head>` and present in the SPA.
- **Palette (default gold/black):** `BG #0a0a0a`, `BG_2 #111`, `BG_3 #161616`, text `CREAM #f0ece4`, muted `#9a958e`/`#6e6962`, accent gold `#d4a64a` (+ bright `#e8c074`, deep `#a87f30`). Accent recolors from the picked color via a `shadeHex()` light/dark derivation. Booking-strip section inverts to cream background / dark text.
- **Buttons:** `border-radius:2`, uppercase 11–12px, 0.25em tracking. Primary = gold bg / dark text; ghost = gold border / cream text.
- **Motifs:** hero radial+linear dark gradient overlay; dashed gold dividers in the price table; drop-cap on the About body; 12-col gallery mosaic with mixed aspect ratios; pull-quote with flanking gold rules; fade-up on hero.

### Sections, in order (each editable; conditionals honor "keep pulled sections")
1. **Welcome bar** — gold eyebrow strip: "Welcome" + area (+ "★ rating · N reviews" if `aggregateRating`). Always.
2. **Sticky nav** — shop name crest + nav anchors (About/Services/Gallery/Visit) + gold "Book Now". Always.
3. **Hero** — full-bleed `hero.imageUrl` + gradient; badge, shop-name headline (gold serif italic), `hero.tagline` subtext, primary "Book an Appointment" + ghost "View Services"; optional rating chip. Always.
4. **About** — eyebrow + "Craft, character, and community" heading, drop-cap body from `about.description[]`, optional stat ribbon (rating/reviews when `aggregateRating`), side image `about.imageUrl`. Always.
5. **Services + Policy** — price table from `services[]` (name + optional duration/badge + optional description + right-aligned price). Hidden if no services. Policy box ("Before you arrive") from new `policy?{title,body}` (seeded default, editable).
6. **Gallery ("The Work")** — 6-tile 12-col mosaic from `gallery[]`. Hidden if no photos; edit mode shows up to 6 upload slots.
7. **Reviews ("What clients are saying")** — aggregate summary box (when `aggregateRating`) + review cards (avatar initial, name, date, stars, comment) from `reviews[]`. Hidden if no reviews.
8. **Pull quote** — from new `pullQuote?{text,accent?}` (seeded default, editable).
9. **Booking strip** — cream "Ready for your next cut?" CTA. Always.
10. **Hours + Contact ("Find the chair")** — left: address/area, phone, optional online-booking line; right: "Hours of Service" from `hours[]` (adapt `{day,open,close,closed}` → "9am – 7pm" / "Closed"). Hours hidden if none.
11. **Footer** — crest + area. Always.

No team/staff section (the design has none). `staff[]` is preserved in `WebsiteData` and still renders in Design 1.

### Data mapping (WebsiteData → design slots)
| Slot | WebsiteData field |
|---|---|
| shop name / nav / footer | `shopName` |
| area / welcome bar | `area` |
| phone / booking CTA | `phone`, `bookingUrl` (fallback `tel:`) |
| hero headline / subtext / image | `hero.heading` / `hero.tagline` / `hero.imageUrl` |
| about heading / body / image | `about.heading` / `about.description[]` / `about.imageUrl` |
| services price table | `services[]` (title/name, price, duration?, description?) |
| reviews + aggregate | `reviews[]`, `aggregateRating` |
| gallery mosaic | `gallery[]` |
| hours | `hours[]` |
| policy box | `policy?` (new optional field) |
| pull quote | `pullQuote?` (new optional field) |
| accent color | `colorTheme` (hex or AIB_THEMES slug) |

### New optional `WebsiteData` fields
`policy?: { title: string; body: string }` and `pullQuote?: { text: string; accent?: string }`. Optional → Design 1 ignores them; lossless switching preserved. Seeded with the live-site defaults when a Design 2 site is generated so the design looks complete, and editable inline.

## Wiring points (exact)
- **types.ts:2** — `TemplateId` add `'prime'`; add `policy?`/`pullQuote?` to `WebsiteData`.
- **App.tsx ~1125–1145** — editor dispatch: add `template==='prime'` → `<PrimeWebsite ...>` (same props GeneratedWebsite receives: `data, onBack, site, onNavigateDashboard, isPostPayment, userId, onCheckoutFlowChange`).
- **components/GeneratePage.tsx ~177** — preview dispatch: add prime branch (with `hidePrepaymentBanner` like the others).
- **components/GenerateCustomizePrompts.tsx ~280–317** — add a compact **Design 1 / Design 2 picker** next to the existing (booksy-only) color picker. Picker sets `template`; flows into generation.
- **lib/buildSiteFromScrape.ts:28–45** — `BuildOptions.template` add `'prime'`; default stays `'luxe'`.
- **services/templateRenderer.ts** — add `if (template==='prime') return generatePrimeHTMLWithPlaceholders(siteData)`.
- **Floating switcher** — new component rendered in the booksy editor at **z-index 75–80** (above EditorToolbar=70, below modals=150). Desktop left-center, mobile bottom pill above the pre-payment banner — mirror landscaping's `LandscapingDesignSwitcher`. Sets `data.template` via the editor's update callback, shows ~850ms loading overlay, applies color instantly.

## Deploy / persistence
`template` already rides generate → publish → dashboard. `generatePrimeHTMLWithPlaceholders(siteData)`:
1. Clone siteData; replace image fields with deploy placeholders: `hero.imageUrl→{{hero}}`, `about.imageUrl→{{about}}`, `gallery[i]→{{gallery i}}`.
2. `const body = renderToStaticMarkup(<PrimeWebsite data={placeholderized} isEditMode={false} />)` (react-dom/server is available).
3. Wrap in the document shell (Tailwind CDN + Newsreader/Inter font links + base style) — mirror `generateHTMLWithPlaceholders`'s shell. The component's scoped `<style>` is captured inside `body`.
4. Existing `/api/deploy-site` swaps `{{...}}` tokens with uploaded image URLs. Image-collection step (base64 → upload) reuses the same WebsiteData image fields the luxe path already walks (`hero`, `about`, `gallery[]`).

Single source of truth: no parallel hand-written HTML string builder.

## Testing
From the `origin/main` worktree, build with dummy Supabase env (`VITE_SUPABASE_URL=https://dummy.supabase.co VITE_SUPABASE_ANON_KEY=dummy`). `npx vite build` must pass.
Playwright on `/booksy`:
- Picker selects Design 2 → generate → preview is the Prime design.
- In-editor floating switch Design 1↔2 preserves content (shop name, services, reviews survive).
- Empty sections don't render when data absent (e.g. no reviews → no reviews section); present data shows.
- Visual fidelity check vs `primehub-barber-live.jpeg`.
- Deploy HTML smoke: `generatePrimeHTMLWithPlaceholders` returns valid HTML containing the `{{...}}` placeholders and the sections.

## Non-goals
- No changes outside the booksy flow.
- No team/staff section in Design 2.
- No re-scrape on switch.
