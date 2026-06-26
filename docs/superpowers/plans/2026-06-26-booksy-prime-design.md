# /booksy Two-Design Switcher Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax. This repo has no UI unit-test harness; each task's "verify" is `npx vite build`, a Node/vite-node SSR smoke, and/or Playwright against the dev server — the same gates used for the landscaping design system.

**Goal:** Add a Design 1 (`luxe`, current) / Design 2 (`prime`, new port of PrimeHub's live EuphoriaBarberRenderer) switcher to the AI-Barber `/booksy` flow — pre-generate picker + in-editor floating switcher, keep-content re-skin.

**Architecture:** Both designs read the same `WebsiteData`; App.tsx dispatches the editor renderer on `data.template` (add a `'prime'` branch). New `components/PrimeWebsite.tsx` resolves a view-model from `WebsiteData`, renders the Euphoria-barber sections, reuses AI-Barber's `EditableText`/`compressImage`/`ImageOverlay`/`AIB_THEMES`, and exports `generatePrimeHTMLWithPlaceholders()` (renderToStaticMarkup against a placeholderized data copy) for deploy.

**Tech Stack:** Vite + React + TypeScript, Tailwind (CDN at deploy), react-dom/server, Newsreader + Inter fonts, lucide-react.

## Global Constraints
- Scope: `/booksy` only. Do NOT change `/generate`, homepage, `/free-barber` behavior.
- Build/dev require dummy env: `VITE_SUPABASE_URL=https://dummy.supabase.co VITE_SUPABASE_ANON_KEY=dummy`.
- Work in worktree `/tmp/aib-prime` (origin/main, branch `booksy-prime-design`), node_modules symlinked.
- `TemplateId` values: `'luxe' | 'euphoria' | 'prime'`. Default stays `'luxe'`.
- Reuse AI-Barber primitives; do NOT import PrimeHub code at runtime.
- Visual fidelity target: `primehub-barber-live.jpeg` (the live primehub.dev/barber design).
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Types — add `'prime'` + new optional fields

**Files:**
- Modify: `types.ts` (`TemplateId` line ~2; `WebsiteData` ~31-89)
- Modify: `lib/buildSiteFromScrape.ts` (`BuildOptions` ~28-36)

**Interfaces — Produces:** `TemplateId` includes `'prime'`; `WebsiteData.policy?: {title:string;body:string}`; `WebsiteData.pullQuote?: {text:string;accent?:string}`; `BuildOptions.template?: 'luxe'|'euphoria'|'prime'`.

- [ ] Edit `TemplateId` to `export type TemplateId = 'luxe' | 'euphoria' | 'prime';`
- [ ] Add to `WebsiteData`: `policy?: { title: string; body: string };` and `pullQuote?: { text: string; accent?: string };`
- [ ] Edit `BuildOptions.template?` union to include `'prime'`.
- [ ] Verify: `cd /tmp/aib-prime && VITE_SUPABASE_URL=https://dummy.supabase.co VITE_SUPABASE_ANON_KEY=dummy npx vite build` → succeeds (no type errors).
- [ ] Commit: `feat(booksy): add 'prime' template id + policy/pullQuote fields`

---

### Task 2: PrimeWebsite component — editor render

**Files:**
- Create: `components/PrimeWebsite.tsx`

**Interfaces — Consumes:** `WebsiteData` (Task 1), AI-Barber `EditableText`/`compressImage`/`ImageOverlay`/`ImagePlaceholder` patterns (copy the proven implementations from `GeneratedWebsite.tsx`), `AIB_THEMES` color resolution. **Produces:** `export default PrimeWebsite` with props `{ data, onBack, site?, onNavigateDashboard?, isPostPayment?, userId?, onCheckoutFlowChange?, hidePrepaymentBanner? }` (match `GeneratedWebsite`'s prop surface so App.tsx/GeneratePage wiring is uniform). Also `export function generatePrimeHTMLWithPlaceholders(siteData: WebsiteData): string` (filled in Task 5).

Build a faithful port of `EuphoriaBarberRenderer` reading `WebsiteData`. View-model resolution at top:
- `shopName=data.shopName`, `area=data.area`, `phone=data.phone`, `bookingUrl=data.bookingUrl || tel:+1<digits>`
- hero: `data.hero.heading/tagline/imageUrl`; about: `data.about.heading`, body `data.about.description[]`, `data.about.imageUrl`
- services `data.services` (use `s.price`, `s.title`, `s.duration`, `s.description`); reviews `data.reviews||[]`; `data.aggregateRating`; gallery `data.gallery||[]`; hours `data.hours||[]` rendered `closed? 'Closed' : `${open} – ${close}``; `data.policy`, `data.pullQuote`.
- accent: resolve `data.colorTheme` via AIB_THEMES (hex or slug), derive bright/deep with a `shadeHex` helper (port the 12-line helper).

Sections + conditionals (hide when empty): welcome bar, sticky nav, hero, about (+ stat ribbon when aggregateRating), services+policy (`services.length>0`; policy box when `data.policy`), gallery (`gallery.filter(Boolean).length>0`; edit mode shows ≤6 slots), reviews (`reviews.length>0`; aggregate box when aggregateRating), pull quote (when `data.pullQuote`), booking strip, hours+contact (`hours.length>0`), footer. NO team section. Scoped `<style>` block built from accent constants (template literal), like the source.

Editing: `isEditMode = !isPostPayment ? true : <existing GeneratedWebsite rule>` — match GeneratedWebsite's edit-mode gating exactly. All text via `EditableText` writing back through the same update mechanism GeneratedWebsite uses (the component holds `siteData` state synced from `data`, edits call a `update(path,val)` that triggers save when post-payment). Reuse GeneratedWebsite's publish/PrePaymentBanner + image-collection flow verbatim (same WebsiteData image fields: hero/about/gallery), only the section JSX differs.

- [ ] Create the file with all sections, scoped style, primitives, view-model, edit + publish flow.
- [ ] `generatePrimeHTMLWithPlaceholders` may be a stub returning `''` for now (Task 5 fills it) — but export it.
- [ ] Verify build: `... npx vite build` succeeds.
- [ ] Commit: `feat(booksy): PrimeWebsite (Design 2) component`

---

### Task 3: Wire the editor + preview dispatch

**Files:**
- Modify: `App.tsx` (editor dispatch ~1125-1145)
- Modify: `components/GeneratePage.tsx` (preview dispatch ~177-189; buildSiteFromScrape template arg ~119-127)

**Interfaces — Consumes:** `PrimeWebsite` default export (Task 2).

- [ ] App.tsx: lazy-import `PrimeWebsite`; add first branch `generatedData.template === 'prime' ? <PrimeWebsite {...sameProps}/> : euphoria ? ... : luxe`.
- [ ] GeneratePage.tsx: replace `useEuphoria` two-way with three-way (`prime`/`euphoria`/luxe), passing identical props incl. `hidePrepaymentBanner`.
- [ ] GeneratePage.tsx: change template arg to pass through `(siteData as any)?.template` when it's `'prime'|'euphoria'`, else `'luxe'`.
- [ ] Verify build succeeds.
- [ ] Commit: `feat(booksy): dispatch Design 2 in editor + preview`

---

### Task 4: Pre-generate picker (Design 1 / Design 2)

**Files:**
- Modify: `components/GenerateCustomizePrompts.tsx` (~280-317, next to color picker)
- Modify: `components/GeneratePage.tsx` (hold `template` state; pass to picker + seed it into `siteData.template` for the live preview + into buildSiteFromScrape)

**Interfaces — Consumes:** picker `onTemplateChange(t: TemplateId)` / `initialTemplate`. **Produces:** chosen template stamped onto generated `WebsiteData.template`.

- [ ] Add a compact two-option "Design" picker (Design 1 / Design 2) in the customize overlay, shown only for the booksy variant (same gating as the color picker — when its handler is provided). Selected state styled like the color swatches.
- [ ] GeneratePage holds `template` state (default `'luxe'`), passes `onTemplateChange`/`initialTemplate`, applies `template` to the preview `siteData` and to `buildSiteFromScrape({template})`.
- [ ] Verify build; Playwright: open `/booksy`, advance to the customize overlay, confirm picker toggles and the live preview re-skins.
- [ ] Commit: `feat(booksy): pre-generate Design 1/2 picker`

---

### Task 5: Deploy export — `generatePrimeHTMLWithPlaceholders`

**Files:**
- Modify: `components/PrimeWebsite.tsx` (implement the export)
- Modify: `services/templateRenderer.ts` (add `'prime'` branch)

**Interfaces — Produces:** `generatePrimeHTMLWithPlaceholders(siteData)` → full HTML string with `{{hero}}`/`{{about}}`/`{{gallery N}}` placeholders; `templateRenderer` routes `'prime'` to it.

- [ ] Implement export: clone siteData; set `hero.imageUrl='{{hero}}'`, `about.imageUrl='{{about}}'`, `gallery[i]='{{gallery'+i+'}}'`; `const body = renderToStaticMarkup(React.createElement(PrimeWebsite,{data:placeholderized,isEditMode:false,onBack:()=>{}}))`; wrap in the same document shell as `generateHTMLWithPlaceholders` (Tailwind CDN + Newsreader/Inter font links + base `<style>`). Import `renderToStaticMarkup` from `react-dom/server`.
- [ ] Ensure PrimeWebsite renders cleanly with `isEditMode:false` and no window/document access at render time (guard any browser-only code behind effects/handlers).
- [ ] templateRenderer.ts: add `if (siteData.template==='prime'){ const mod=await import('../components/PrimeWebsite'); return mod.generatePrimeHTMLWithPlaceholders(siteData); }` before the luxe fallback.
- [ ] Verify build; SSR smoke via vite-node: render `generatePrimeHTMLWithPlaceholders(sampleData)` and assert output contains `{{hero}}`, the shop name, a services row, and (with reviews present) a review; assert empty-data variant omits the reviews/hours/gallery sections.
- [ ] Commit: `feat(booksy): Design 2 deploy export via renderToStaticMarkup`

---

### Task 6: Floating in-editor switcher

**Files:**
- Create: `components/BooksyDesignSwitcher.tsx`
- Modify: `App.tsx` (render it in the booksy editor branch only)

**Interfaces — Consumes:** `{ current: TemplateId, onSelect:(t:TemplateId)=>void, color?:string, onColorSelect?:(hex:string)=>void }`. Mirror `LandscapingDesignSwitcher`: desktop left-center panel, mobile bottom pill; z-index 78. `onSelect` flips `generatedData.template` via the editor update path and shows an ~850ms loading overlay.

- [ ] Create switcher (Design 1 / Design 2 buttons; optional color swatches reusing AIB_THEMES). Loading overlay on design change.
- [ ] App.tsx: in the booksy editor branch only (booksy site → `activeSite`/`generatedData` with booksy origin), render `<BooksyDesignSwitcher current={generatedData.template||'luxe'} onSelect={t=>updateGeneratedData({...generatedData,template:t})} .../>`. Confirm it's NOT rendered for `/generate`.
- [ ] Verify build; Playwright: generate a booksy site, switch Design 1↔2 via the bubble, confirm content (shopName, a service, a review) persists and the layout changes; confirm switcher absent on `/generate`.
- [ ] Commit: `feat(booksy): floating Design 1/2 switcher in editor`

---

### Task 7: Final verification + PR

- [ ] Full Playwright pass on `/booksy`: picker → generate Design 2 → in-editor switch both ways → content preserved → empty sections hidden (no reviews data ⇒ no reviews section).
- [ ] Confirm `/generate` + homepage unchanged (no picker/switcher, still luxe/euphoria only).
- [ ] `npx vite build` clean.
- [ ] Push branch, open PR with summary + screenshots; squash-merge after user OK.

## Self-Review notes
- Spec coverage: picker (T4), switcher (T6), prime component+sections+conditionals (T2), deploy (T5), dispatch (T3), types/fields (T1), testing (each task + T7). Covered.
- Type consistency: `template:'prime'`, `policy`, `pullQuote`, `generatePrimeHTMLWithPlaceholders`, `PrimeWebsite` default export used consistently across tasks.
- Risk: PrimeWebsite must mirror GeneratedWebsite's edit/publish/image-collection flow precisely — port from it rather than from PrimeHub to avoid drift. SSR-safety required for T5.
