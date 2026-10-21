# Phase 1: Section Editors and Share Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barbers edit their site's Services, Team, Hours, Gallery, About and Contact as simple forms (Services by tapping ready-made chips), and share their site through one Share sheet with pre-written messages and a QR code.

**Architecture:** App-only; no backend changes. Every editor is a pure "ops" module over `WebsiteData` (unit-tested) plus a sheet component. The Edit tab gains a **Sections** tool that opens a list of section cards; each card's sheet calls the Edit tab's existing `commit(change)` so the preview updates and **Publish** works exactly as today. The Share sheet replaces the plain Share button on the Live screen and Settings.

**Tech Stack:** Expo SDK 55, expo-router, React Native, Jest. New JS-only dependency: `react-native-qrcode-svg` (uses the already-installed `react-native-svg`).

**Spec:** `docs/superpowers/specs/2026-10-21-bookings-store-design.md` (§5.1 Sections, §6 Services, §8 Sharing). Phasing ruling: the spec's Phase 1 also listed "Get paid"; it moves to the Bookings plan because it needs the shop backend and the account gate, and has no use before bookings exist. Also deferred to the Bookings plan: the per-service **Bookable** / **Show on website** switches and per-barber services (they only mean something once there is a booking page). QR "Save to Photos / Print" is replaced by "Take a screenshot" to avoid new native modules.

## Global Constraints

- Branch `app` in `~/aibarber-ios`. Leave `src/web/` untouched (it is a byte-for-byte copy of the web repo).
- `npx tsc --noEmit` clean; `TZ=America/New_York npx jest` green.
- No EAS build. No simulator walk (Ibrahim deleted the simulator runtimes); verification is unit tests plus the next device build.
- No new native dependencies. `react-native-qrcode-svg` is the only new dependency.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Style: the app's dark/amber theme (`@/constants/theme`), existing `Sheet`/`SheetAction` from `@/components/EditSheet`, existing `Button`. Copy in plain words for non-technical barbers.
- Analytics: PostHog `track()` only, never AppsFlyer. No names, phones, emails or URLs in event properties.
- Edits never publish on their own. They change the draft; **Publish** pushes them live, as today.
- Data stays in today's `WebsiteData` shape. Times are stored as 24-hour `"HH:MM"` (the templates' `to12h` turns them into "9:00 AM"). Prices are stored as display strings (`"$30"`, `"$25.50"`); durations as `"30 min"`.

## Review Focus

1. **Imported prices that aren't plain numbers** ("$30+", "From $25", "Free"): opening and saving a service without touching the price must keep the original string exactly. (Task 1 test `keeps an unparseable price untouched`.)
2. **Markup characters in names** (`<`, `>`): the Design 1 template prints service titles and team names unescaped, so `<` or `>` would break the published page. Every section editor strips `<` and `>` from text on save. (Task 1 test `strips angle brackets`; Tasks 3–5 reuse `cleanText`.)
3. **Imported hours in other formats** ("9am", "By appointment", missing days): the Hours editor must open without crashing, show the original text for a day it can't parse, and only rewrite a day the barber changes. (Task 3 test `leaves unparseable days unchanged`.)
4. **Gallery slots used by other sections:** Design 1 renders only gallery indices 2–7 as "Our Work"; indices 0–1 feed other parts of the page. The Gallery editor must only touch the slots the current design renders. (Task 4 test `gallerySlots matches the design's rendered indices`.)
5. **Photo upload fails** (offline): the old photo stays, and the barber sees "Couldn't upload that photo. Check your connection and try again." (Task 4.)

---

### Task 1: Services ops and the ready-made library

**Files:**
- Create: `src/lib/sections/text.ts`, `src/lib/sections/services.ts`
- Test: `__tests__/sections/services.test.ts`

**Interfaces:**
- Produces:
  - `cleanText(s: string): string` in `text.ts`: trims and removes `<` and `>`.
  - In `services.ts`:
    - `SERVICE_LIBRARY: { group: string; items: { title: string; duration: number; icon: ServiceItem['icon'] }[] }[]`
    - `DURATIONS = [15, 30, 45, 60, 90] as const`
    - `formatPrice(input: string): string | null`
    - `durationLabel(min: number): string`, returning `"30 min"`, `"1 hr"`, `"1 hr 30 min"`
    - `parseDuration(s?: string): number | null`
    - `newService(title: string, duration: number, icon: ServiceItem['icon']): ServiceItem`
    - `updateService(d: WebsiteData, i: number, patch: ServiceDraft): WebsiteData`
    - `addService(d: WebsiteData, s: ServiceItem): WebsiteData`
    - `removeService(d: WebsiteData, i: number): WebsiteData`
    - `moveService(d: WebsiteData, i: number, dir: -1 | 1): WebsiteData`
    - `type ServiceDraft = { title: string; price: string; duration: number | null; description: string; imageUrl: string }`

- [ ] **Step 1: Write the failing tests** in `__tests__/sections/services.test.ts`.
  - `formatPrice`:
    - `'30'` → `'$30'`
    - `'$25.5'` → `'$25.50'`
    - `'1,200'` → `'$1,200'`
    - `''` → `null`
    - `'abc'` → `null`
  - `durationLabel`: 15 → `'15 min'`; 60 → `'1 hr'`; 90 → `'1 hr 30 min'`.
  - `parseDuration`: `'45 min'` → 45; `'1 hr 30 min'` → 90; `'about an hour'` → null.
  - `SERVICE_LIBRARY` groups are exactly `['Haircuts', 'Beard', 'Combos', 'Extras']`, with these items:
    - **Haircuts:** Haircut, Fade, Skin fade, Taper, Buzz cut, Kids cut, Senior cut, Line up, Hair design
    - **Beard:** Beard trim, Beard shape-up, Hot towel shave, Razor line
    - **Combos:** Haircut + beard, Cut + shave
    - **Extras:** Shampoo, Facial, Eyebrows, Hair colour, Braids, Locs retwist, Scalp treatment
  - `newService('Fade', 30, 'scissors')` has `title 'Fade'`, `duration '30 min'`, `price` undefined, and `subtitle ''`, `description ''`, `imageUrl ''`.
  - `updateService` with `price: '35'` sets `'$35'`. With `price: ''` it removes the `price` key. **`keeps an unparseable price untouched`**: an item with `price: 'From $25'`, saved with `price: 'From $25'`, keeps `'From $25'`.
  - **`strips angle brackets`**: a title of `'<b>Fade</b>'` saves as `'bFade/b'`.
  - `removeService` / `moveService` return new objects (input not mutated), and move at the edges is a no-op.

- [ ] **Step 2: Run:** `TZ=America/New_York npx jest __tests__/sections/services.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement** `text.ts` and `services.ts` to the signatures above.
  - **Price rule:** a typed price that parses as a number (digits, optional `$`, commas, up to 2 decimals) is reformatted. A price equal to the stored string is kept as-is. Anything else is stored trimmed, through `cleanText`.
  - **Defaults:** library durations follow the spec (Haircut 30, Fade 30, Skin fade 45, Beard trim 15, Haircut + beard 45, Kids cut 30, Line up 15; others 30). Icons: Haircuts/Combos `'scissors'`, Beard `'razor'` (Hot towel shave `'mustache'`), Facial `'face'`, other Extras `'sparkles'`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** with the message `Services ops and ready-made service library`.

### Task 2: Sections entry and Services editor

**Files:**
- Create: `src/components/sections/SectionsSheet.tsx`, `src/components/sections/ServicesSheet.tsx`
- Modify: `src/components/PublishBar.tsx` (add the `onSections` tool), `src/app/(tabs)/edit.tsx` (add `'sections' | 'services'` to `SheetKind`; wire sheets to `commit`)
- Test: `__tests__/sections/sectionsList.test.ts`

**Interfaces:**
- Consumes: Task 1 `services.ts`; `pickAndUploadPhoto(folder, onPicked?)` from `src/lib/photos.ts`; `commit(change: (d: WebsiteData) => WebsiteData)` in `edit.tsx`.
- Produces:
  - `sectionCards(d: WebsiteData): { key: SectionKey; title: string; summary: string }[]` in `src/lib/sections/list.ts`.
  - `type SectionKey = 'services' | 'team' | 'hours' | 'gallery' | 'about' | 'contact'`.
  - The `SectionsSheet` props: `{ visible; data: WebsiteData; onOpen(key: SectionKey): void; onClose(): void; onDismiss?(): void }`.
  - Each section sheet's props: `{ visible; data: WebsiteData; onChange(next: WebsiteData): void; onClose(): void; onDismiss?(): void }`. Tasks 3–5 follow this shape.

- [ ] **Step 1: Write the failing test.** `sectionCards` returns the six cards in the order Services, Team, Hours, Gallery, About, Contact. The summaries are:
  - Services: `"3 services"` (singular `"1 service"`; `"None yet"` when empty).
  - Hours: `"Open 5 days"`, or `"Not set"` when there are no hours.
  - Team: `"2 people"`, or `"Not set"`.
  - Gallery: `"4 of 6 photos"`, counted from Task 4's `gallerySlots`. Until Task 4 lands, use the design's slot count: Design 1 → 6 slots (indices 2–7); Design 2 → indices 0–5.
  - About: the shop name.
  - Contact: the phone, or `"Not set"`.

- [ ] **Step 2: Run** `TZ=America/New_York npx jest __tests__/sections/sectionsList.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `list.ts`, then the UI.
  - **PublishBar:** tools in the order **Sections · Text · Photos · Colour**, then Publish. They must fit a 375 pt-wide screen without truncation; shorten the hints if needed.
  - **SectionsSheet:** a list of tappable cards, each showing its title and summary.
  - **ServicesSheet:**
    - The list of services: title, price, duration. Each row has up/down move buttons.
    - **Add a service** shows the library as tappable rounded rectangles (chips) grouped under headers, plus **Add your own**.
    - Tapping a chip adds the service and opens its form with the price field focused.
    - The form has:
      - Name.
      - Price: numeric keypad, `$` prefix shown.
      - Length: chips 15 / 30 / 45 / 60 / 90.
      - Description: optional, 2 lines.
      - Photo: optional; **Add photo** / **Change** via `pickAndUploadPhoto('services')`.
      - **Save** and **Delete** buttons. Delete asks "Remove {name} from your site?".
    - Every change calls `onChange`, which `edit.tsx` routes through `commit`.
  - Hide the tab bar while these sheets are open, the same way the existing sheets do.
  - **Events:** `sections_opened`; `section_opened {section}`; `service_added {source: 'library' | 'custom'}`; `service_removed`.

- [ ] **Step 4: Run** the full suite, `TZ=America/New_York npx jest`, plus `npx tsc --noEmit`. Expected: PASS and clean.

- [ ] **Step 5: Commit** with the message `Sections tool and Services editor`.

### Task 3: Hours editor

**Files:**
- Create: `src/lib/sections/hours.ts`, `src/components/sections/HoursSheet.tsx`
- Modify: `src/components/sections/SectionsSheet.tsx` / `edit.tsx` wiring
- Test: `__tests__/sections/hours.test.ts`

**Interfaces:**
- Produces:
  - `DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']`
  - `defaultHours(): NonNullable<WebsiteData['hours']>`: Tue–Sat `'09:00'`–`'18:00'`; Sun and Mon closed.
  - `TIME_OPTIONS: string[]`: `'06:00'` to `'22:00'` in 30-minute steps.
  - `timeLabel(hhmm: string): string`: `'09:00'` → `'9:00 AM'`; anything else is returned unchanged.
  - `editableHours(d): HoursRow[]`: always 7 rows in `DAYS` order. Days from existing data are matched by day name, case-insensitive, prefix (`'Mon'` matches Monday). Missing days are closed.
  - `setDay(d, day, patch: { closed?: boolean; open?: string; close?: string }): WebsiteData`

- [ ] **Step 1: Write the failing tests.**
  - `defaultHours` has exactly 7 rows, with Monday and Sunday `closed: true`.
  - `timeLabel('13:30')` → `'1:30 PM'`.
  - `editableHours` on `[{ day: 'Mon', open: '9am', close: '5pm' }]` returns 7 rows, where Monday is `open '9am'`, `close '5pm'`, not closed.
  - **`leaves unparseable days unchanged`:** `setDay(d, 'Tuesday', { open: '10:00' })` on data whose Monday is `'By appointment'` keeps Monday's strings byte-identical.
  - When the data had no `hours`, `setDay` first seeds `defaultHours()`.
  - A close time earlier than the open time is rejected: the function returns the data unchanged.

- [ ] **Step 2: Run** the hours tests. Expected: FAIL.

- [ ] **Step 3: Implement.** `HoursSheet` shows 7 rows, one per day.
  - Each row has an **Open / Closed** switch.
  - When open, the row shows two time buttons. Tapping one opens a list of `TIME_OPTIONS` (shown with `timeLabel`) in a small sheet. If the stored value isn't in the list, show it at the top as-is.
  - A **Copy Tuesday to all open days** link.
  - Event: `section_saved {section: 'hours'}`.

- [ ] **Step 4: Run** the full suite and tsc. Expected: PASS and clean.

- [ ] **Step 5: Commit** with the message `Hours editor`.

### Task 4: Team and Gallery editors

**Files:**
- Create: `src/lib/sections/team.ts`, `src/lib/sections/gallery.ts`, `src/components/sections/TeamSheet.tsx`, `src/components/sections/GallerySheet.tsx`
- Modify: the `SectionsSheet` / `edit.tsx` wiring
- Test: `__tests__/sections/teamGallery.test.ts`

**Interfaces:**
- Produces, in `team.ts`:
  - `addMember(d, m: { name: string; role?: string; photo?: string }): WebsiteData`
  - `updateMember(d, i, m): WebsiteData`
  - `removeMember(d, i): WebsiteData`
  - `moveMember(d, i, dir): WebsiteData`
  - All text goes through `cleanText`; an empty name is rejected (data returned unchanged).
- Produces, in `gallery.ts`:
  - `gallerySlots(d): number[]`: the indices the current design renders. Design 1 (`template` `'luxe'` or unset): `[2, 3, 4, 5, 6, 7]`. Design 2 (`'prime'`): `[0, 1, 2, 3, 4, 5]`.
  - `setGalleryPhoto(d, index, url): WebsiteData`
  - `clearGalleryPhoto(d, index): WebsiteData`: sets `''`, padding the array so that indices before it are kept.

- [ ] **Step 1: Write the failing tests.**
  - **`gallerySlots matches the design's rendered indices`** for both designs. Read the indices from `src/web/lib/render/luxe.ts`'s `GALLERY_PORTFOLIO_INDICES` and from prime's `.slice(0, 6)` to confirm them.
  - `clearGalleryPhoto` on index 4 of a 3-item array pads to length 5, leaving indices 0–2 unchanged.
  - Team add / remove / move keeps the other members.
  - An empty name is rejected.
  - Text is cleaned (no `<`, `>`).

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **TeamSheet:**
    - A list of people: photo circle, name, role. **Add a person** opens a form with photo, name and role (e.g. "Barber", "Owner"), plus **Save** and **Remove**.
    - On Design 2, show the note: "Your team shows on Design 1. Design 2 doesn't have a team section yet."
  - **GallerySheet:**
    - A grid of the design's slots. An empty slot shows **+ Add photo**.
    - Tapping a filled slot offers **Replace** or **Remove**.
    - Uploads use `pickAndUploadPhoto('gallery')`.
  - On upload failure, keep the old photo and show the alert "Couldn't upload that photo. Check your connection and try again."
  - Events: `section_saved {section}`.

- [ ] **Step 4: Run** the full suite and tsc. Expected: PASS and clean.

- [ ] **Step 5: Commit** with the message `Team and Gallery editors`.

### Task 5: About and Contact editors

**Files:**
- Create: `src/lib/sections/aboutContact.ts`, `src/components/sections/AboutSheet.tsx`, `src/components/sections/ContactSheet.tsx`
- Modify: the `SectionsSheet` / `edit.tsx` wiring
- Test: `__tests__/sections/aboutContact.test.ts`

**Interfaces:**
- Produces:
  - `aboutFields(d): { shopName: string; tagline: string; about: string }`. `about` is `about.description` joined with a blank line.
  - `setAbout(d, f): WebsiteData`: splits `about` on blank lines into `about.description`, sets `hero.tagline` and `shopName`, and rejects an empty shop name.
  - `contactFields(d): { phone: string; address: string; email: string }`
  - `setContact(d, f): WebsiteData`: writes `phone`, `contact.address` and `contact.email`. An email without `@` is rejected; an empty email is allowed.

- [ ] **Step 1: Write the failing tests.**
  - Round-trip: `setAbout(d, aboutFields(d))` deep-equals `d` for a site with two paragraphs.
  - An empty shop name is rejected.
  - Text is cleaned.
  - An invalid email is rejected.
  - An empty email clears the field.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement** the two simple forms: **Save** plus inline error text.
  - **About:** Shop name, Tagline (1 line), About your shop (multiline).
  - **Contact:** Phone (phone keypad), Address, Email.
  - Event: `section_saved {section}`.

- [ ] **Step 4: Run** the full suite and tsc. Expected: PASS and clean.

- [ ] **Step 5: Commit** with the message `About and Contact editors`.

### Task 6: Share sheet and QR code

**Files:**
- Create: `src/lib/share.ts`, `src/components/ShareSheet.tsx`, `src/components/QrScreen.tsx`
- Modify: `src/app/live.tsx` (the Share button opens `ShareSheet`), `src/app/(tabs)/settings.tsx` (the link card's Share button opens `ShareSheet`, plus a new **Share your site** row); `package.json` (`npx expo install react-native-qrcode-svg`)
- Test: `__tests__/share.test.ts`

**Interfaces:**
- Produces:
  - `type ShareKind = 'website'`. It stays a union so the Bookings and Store plans can add `'booking' | 'shop'`.
  - `shareMessage(kind: ShareKind, shopName: string, url: string): string`. For `'website'`: `` `Check out ${shopName}'s new website: ${url}` ``. An empty shop name gives `` `Check out our new website: ${url}` ``.
  - `ShareSheet` props: `{ visible; shopName: string; links: { kind: ShareKind; url: string }[]; source: 'live' | 'settings'; onClose(): void }`.

- [ ] **Step 1: Write the failing tests.** `shareMessage` for both cases. The message contains the URL exactly once.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **ShareSheet:** one big row per link ("Website link", showing the host).
    - Tapping a row calls `Share.share({ message })`, which opens the iPhone share sheet (Messages, WhatsApp, AirDrop, Instagram, Mail, Copy).
    - Below the rows:
      - **Show QR code**, which opens `QrScreen`.
      - **Copy link**, which shows "Copied" for 2 s.
      - **Copy for your Instagram bio**, which copies the URL and shows "Copied. Paste it into your Instagram bio."
  - **QrScreen:** a full-screen white card with the QR code (about 260 pt), the shop name, and the line "Scan to see our website". Below it: "Take a screenshot to save or print it." A **Done** button closes it.
  - **Entry points:** Live and Settings keep their Open and Copy buttons. Their Share button now opens `ShareSheet`.
  - **Events:** `share_sheet_opened {source}`, `share_link_tapped {kind}`, `qr_opened`, `share_copy_tapped`. No URLs in the properties.

- [ ] **Step 4: Run** the full suite and tsc. Expected: PASS and clean.

- [ ] **Step 5: Commit** with the message `Share sheet with pre-written messages and QR code`.
