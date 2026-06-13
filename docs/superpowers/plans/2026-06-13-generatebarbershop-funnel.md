# /generatebarbershop Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `/generatebarbershop` funnel page that lets a visitor generate a barbershop website from either a shop name or a Booksy/Fresha/Square/Vagaro/StyleSeat link, then collects service area and phone via a floating bar that updates the live preview on every keystroke, then hands off to the existing post-payment + dashboard flow unchanged.

**Architecture:** One new page component (`GenerateBarbershopFunnel`) that owns a 3-state machine (`input → generation → reveal`) and reuses `services/geminiService.generateContent`, `lib/buildSiteFromScrape`, and `components/EuphoriaWebsite`. One new floating bar component (`DetailCollectionBar`) that the funnel passes change callbacks to. Minimal additive edits to `App.tsx` (lazy import + one early-return block, mirrors the existing `/recover` pattern) and `lib/dealMode.ts` (one constant + one helper). Every existing subpage is untouched.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, `services/geminiService.ts` (Gemini), `/api/import-scrape` (Apify-backed scraper), existing `lib/buildSiteFromScrape.ts`.

---

## File Structure

**New files:**
- `components/GenerateBarbershopFunnel.tsx` — page component, owns phase + siteData, orchestrates generation, mounts EuphoriaWebsite + DetailCollectionBar on reveal.
- `components/DetailCollectionBar.tsx` — controlled floating bar, two questions (area then phone), keystroke `onChange`, auto-hide on completion, X dismissal.

**Modified files (minimal additive):**
- `lib/dealMode.ts` — add `GENERATE_BARBERSHOP_PATH` and `isGenerateBarbershopPath()` (same pattern as `RECOVER_PATH` / `isRecoverPath`).
- `App.tsx` — add lazy import for `GenerateBarbershopFunnel`; add one early-return block before existing path checks (same shape as the `/recover` early-return).

**Untouched:** every other file in the repo.

---

## Task 1: Add `/generatebarbershop` path constant + helper

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/lib/dealMode.ts`

- [ ] **Step 1.1: Read current file**

Run: `cat /Users/ibrahim/AI-Barber/lib/dealMode.ts`
Expected: see existing constants `FREE_BARBER_PATH`, `BOOKSY_PATH`, `PRIMEBARBER_PATH`, `RECOVER_PATH` plus their `isXPath` helpers.

- [ ] **Step 1.2: Append the new constant + helper just below the `isRecoverPath` block**

Edit `/Users/ibrahim/AI-Barber/lib/dealMode.ts`. Find the line that contains:

```ts
export function isRecoverPath(pathname?: string): boolean {
```

Locate the closing `}` of that function. Immediately after it, append:

```ts

// `/generatebarbershop` — fast-conversion funnel. Single-input hero
// for shop name, accelerator below for Booksy/Fresha/Square/Vagaro/
// StyleSeat link. See docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md
export const GENERATE_BARBERSHOP_PATH = '/generatebarbershop';

export function isGenerateBarbershopPath(pathname?: string): boolean {
  const p = (pathname ?? window.location.pathname).replace(/\/+$/, '');
  return p === GENERATE_BARBERSHOP_PATH;
}
```

- [ ] **Step 1.3: Verify the file still type-checks**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty output (no new errors; pre-existing capture-lead/supabase errors filtered out).

- [ ] **Step 1.4: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add lib/dealMode.ts && git commit -m "feat(routes): add GENERATE_BARBERSHOP_PATH + isGenerateBarbershopPath helper

Mirrors the existing RECOVER_PATH / isRecoverPath shape so App.tsx
can short-circuit to the new funnel without touching any other route.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 2: Create funnel skeleton (input phase only — visuals, no submit logic)

**Files:**
- Create: `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`

- [ ] **Step 2.1: Create the file with the input-phase scaffolding**

Write `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`:

```tsx
import React, { useState } from 'react';
import { Sparkles, ArrowRight, Zap } from 'lucide-react';
import type { WebsiteData } from '../types';

type Phase = 'input' | 'generation' | 'reveal';

interface GenerateBarbershopFunnelProps {
  // No props yet — the funnel is self-contained until Task 7 wires the
  // EuphoriaWebsite handoff for the reveal phase. Auth + dashboard wiring
  // is done by App.tsx's existing post-payment flow.
}

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';

export const GenerateBarbershopFunnel: React.FC<GenerateBarbershopFunnelProps> = () => {
  const [phase, setPhase] = useState<Phase>('input');
  const [shopName, setShopName] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [siteData, setSiteData] = useState<WebsiteData | null>(null);

  // Unused for now — wired in Task 5/6. Hook is here so the state
  // machine is in place from the first commit.
  void phase;
  void siteData;
  void setSiteData;
  void setPhase;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 md:px-8 py-12"
      style={{ background: BG, color: 'white', fontFamily: SANS }}
    >
      <div className="w-full max-w-lg">
        {/* HERO */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-4"
            style={{ background: 'rgba(232,192,116,0.12)', border: `1px solid rgba(232,192,116,0.35)` }}
          >
            <Sparkles size={11} style={{ color: GOLD }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
              Free barbershop website
            </span>
          </div>
          <h1
            className="text-3xl md:text-4xl font-black tracking-tight leading-[1.05] mb-3"
            style={{ color: 'white', letterSpacing: '-0.02em' }}
          >
            Generate your{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              FREE
            </span>{' '}
            barbershop website in seconds
          </h1>
        </div>

        {/* NAME INPUT */}
        <form
          className="mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            // Submit handler wired in Task 4.
          }}
        >
          <label className="block text-[10px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Barbershop name
          </label>
          <input
            type="text"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="The Gentlemen's Lounge"
            required
            className="w-full px-4 py-3 bg-transparent text-white placeholder-white/30 text-[14px] outline-none transition-colors mb-3"
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 font-black uppercase tracking-[0.22em] text-[11px] transition"
            style={{ background: GOLD, color: '#0a0a0a', border: '1px solid transparent', fontFamily: 'inherit' }}
          >
            <span>Generate my website</span>
            <ArrowRight size={14} />
          </button>
        </form>

        {/* ACCELERATOR */}
        <div
          className="p-4 rounded"
          style={{ background: 'rgba(232,192,116,0.04)', border: `1px solid rgba(232,192,116,0.18)` }}
        >
          <div className="flex items-start gap-2 mb-3">
            <Zap size={14} style={{ color: GOLD }} className="shrink-0 mt-0.5" />
            <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Have a <strong style={{ color: 'white' }}>Booksy, Fresha, Square, Vagaro,</strong> or{' '}
              <strong style={{ color: 'white' }}>StyleSeat</strong> link? Paste it and we'll build from your real
              services & photos.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Submit handler wired in Task 4.
            }}
          >
            <input
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="booksy.com/your-shop"
              className="w-full px-3 py-2.5 bg-transparent text-white placeholder-white/30 text-[13px] outline-none transition-colors mb-2"
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '4px',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 font-bold uppercase tracking-[0.22em] text-[10px] transition"
              style={{
                background: 'transparent',
                color: GOLD,
                border: `1px solid ${GOLD}`,
                fontFamily: 'inherit',
              }}
            >
              <span>Generate from my link</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GenerateBarbershopFunnel;
```

- [ ] **Step 2.2: Verify the file type-checks**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty (no new errors).

- [ ] **Step 2.3: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/GenerateBarbershopFunnel.tsx && git commit -m "feat(funnel): scaffold GenerateBarbershopFunnel input phase

Hero with single shopName input + accelerator card with bookingUrl
input. Submit handlers stubbed; wired in Task 4. Phase state machine
in place from this commit so subsequent tasks only flesh out the
state transitions, not the structure.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 3: Mount funnel via App.tsx early-return + verify route renders

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/App.tsx`

- [ ] **Step 3.1: Find the existing `/recover` early-return block in App.tsx**

Run: `grep -n "isRecoverPath\|RecoverPage" /Users/ibrahim/AI-Barber/App.tsx | head -10`
Expected: locate the `import { ... isRecoverPath ... }` from `lib/dealMode` and the early-return block that calls `<RecoverPage />`.

- [ ] **Step 3.2: Add the lazy import next to RecoverPage's lazy import**

Read the surrounding context first. Then add this line directly below the existing `const RecoverPage = lazy(...)` line:

```tsx
const GenerateBarbershopFunnel = lazy(() => import('./components/GenerateBarbershopFunnel.tsx').then(m => ({ default: m.GenerateBarbershopFunnel })));
```

- [ ] **Step 3.3: Add `isGenerateBarbershopPath` to the `lib/dealMode` import**

Find the existing import like:

```tsx
import { isBooksyPath, isFreeBarberPath, isPrimeBarberPath, isRecoverPath } from './lib/dealMode.ts';
```

Append `isGenerateBarbershopPath` to it:

```tsx
import { isBooksyPath, isFreeBarberPath, isPrimeBarberPath, isRecoverPath, isGenerateBarbershopPath } from './lib/dealMode.ts';
```

- [ ] **Step 3.4: Add the early-return block immediately AFTER the existing isRecoverPath early-return**

Locate the existing block that returns `<RecoverPage ... />` wrapped in `<Suspense>`. Add this directly after it:

```tsx
  if (isGenerateBarbershopPath()) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GenerateBarbershopFunnel />
      </Suspense>
    );
  }
```

- [ ] **Step 3.5: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 3.6: Build to verify nothing broke**

Run: `cd /Users/ibrahim/AI-Barber && npm run build 2>&1 | tail -15`
Expected: `✓ built in ...` with no errors. Dist files written.

- [ ] **Step 3.7: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add App.tsx && git commit -m "feat(routes): mount /generatebarbershop funnel via App.tsx early-return

Mirrors the existing /recover pattern: lazy import + Suspense boundary
+ an early-return block before the rest of App.tsx's routing logic.
Diff is intentionally small — no other paths affected.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 4: Wire submit handlers + transition to generation phase (visual theater)

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`

- [ ] **Step 4.1: Add the `generation` phase view**

Open `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`. Replace the existing `return (...)` block with a phase-switching return:

```tsx
  // Theatrical progress steps shown during the generation phase. Both
  // paths show the same general arc; the messages diverge by source so
  // the visitor sees the system "doing something" with their input.
  const [progressStep, setProgressStep] = useState(0);
  const [progressSource, setProgressSource] = useState<'name' | 'link'>('name');

  const nameSteps = ['Writing your services...', 'Designing your pages...', 'Finalizing your site...'];
  const linkSteps = ['Found your booking page', 'Importing your services', 'Adding your photos'];
  const steps = progressSource === 'link' ? linkSteps : nameSteps;

  if (phase === 'generation') {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-5 py-12"
        style={{ background: BG, color: 'white', fontFamily: SANS }}
      >
        <div className="w-full max-w-md text-center">
          <Sparkles size={28} style={{ color: GOLD }} className="mx-auto mb-6 animate-pulse" />
          <h2 className="text-xl md:text-2xl font-black tracking-tight mb-8" style={{ letterSpacing: '-0.01em' }}>
            Building your{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              barbershop site
            </span>
          </h2>
          <ul className="space-y-3 text-left">
            {steps.map((s, i) => (
              <li
                key={s}
                className="flex items-center gap-3 text-[14px]"
                style={{ color: i <= progressStep ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)' }}
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                  style={{
                    background: i < progressStep ? GOLD : 'transparent',
                    border: `1px solid ${i <= progressStep ? GOLD : 'rgba(255,255,255,0.18)'}`,
                    color: '#0a0a0a',
                  }}
                >
                  {i < progressStep ? '✓' : ''}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (phase === 'reveal') {
    // Mounted in Task 7. For now, render a placeholder so this branch
    // doesn't error if hit during integration testing.
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: BG, color: 'white', fontFamily: SANS }}>
        <p>Reveal phase — wired in Task 7.</p>
      </div>
    );
  }

  // Default: input phase
  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 md:px-8 py-12"
      style={{ background: BG, color: 'white', fontFamily: SANS }}
    >
      {/* ... existing input-phase markup from Task 2 unchanged ... */}
    </div>
  );
```

When merging this block into the existing file, KEEP the existing input-phase markup verbatim under the `// Default: input phase` comment — do not delete it.

- [ ] **Step 4.2: Wire both submit forms to enter generation phase**

In the existing `<form onSubmit={...}>` for the name input, replace the placeholder with:

```tsx
onSubmit={(e) => {
  e.preventDefault();
  if (!shopName.trim()) return;
  setProgressSource('name');
  setProgressStep(0);
  setPhase('generation');
  void runNameGeneration(shopName);
}}
```

In the accelerator's `<form onSubmit={...}>`, replace with:

```tsx
onSubmit={(e) => {
  e.preventDefault();
  if (!bookingUrl.trim()) return;
  setProgressSource('link');
  setProgressStep(0);
  setPhase('generation');
  void runLinkGeneration(bookingUrl, shopName);
}}
```

Both `runNameGeneration` and `runLinkGeneration` will be defined in Task 5 and Task 6 respectively. For now, add stubs at the top of the component:

```tsx
  // Stubs — real implementations land in Task 5 (name) and Task 6 (link).
  const runNameGeneration = async (_name: string) => { console.log('[funnel] name path stub'); };
  const runLinkGeneration = async (_url: string, _typedName: string) => { console.log('[funnel] link path stub'); };
```

- [ ] **Step 4.3: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 4.4: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/GenerateBarbershopFunnel.tsx && git commit -m "feat(funnel): phase switching + theatrical generation view

Both submit handlers transition to phase='generation' and call
stub orchestrators. Generation view shows three sequential steps
with check-mark progression. Reveal phase is a placeholder until
Task 7 wires EuphoriaWebsite.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 5: Name-path generation (calls generateContent + advances theater)

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`

- [ ] **Step 5.1: Import generateContent**

Add to the imports at the top of the file:

```tsx
import { generateContent } from '../services/geminiService';
import type { ShopInputs } from '../types';
```

- [ ] **Step 5.2: Replace the runNameGeneration stub**

Find the stub:

```tsx
const runNameGeneration = async (_name: string) => { console.log('[funnel] name path stub'); };
```

Replace with:

```tsx
  // Advance the theatrical progress on a fixed cadence so visitors see
  // motion even when the network call completes quickly. Total wall
  // clock ~3s. Resolves AFTER the real generateContent so callers can
  // await both before flipping to reveal.
  const advanceProgress = (totalSteps: number, perStepMs = 900) =>
    new Promise<void>((resolve) => {
      let i = 0;
      const id = setInterval(() => {
        i += 1;
        setProgressStep(i);
        if (i >= totalSteps) {
          clearInterval(id);
          resolve();
        }
      }, perStepMs);
    });

  const runNameGeneration = async (name: string) => {
    const inputs: ShopInputs = { shopName: name, area: '', phone: '' };
    // Race: don't transition to reveal until BOTH the Gemini call and
    // the theatrical progress have finished. Visitors should never see
    // an empty site or a stalled progress list.
    const [data] = await Promise.all([
      generateContent(inputs).catch((err) => {
        // Hard error from Gemini — surface a console log and fall back
        // to a minimum-viable WebsiteData. Per spec we NEVER show error
        // states to the visitor mid-funnel.
        console.error('[funnel] generateContent failed:', err);
        return null;
      }),
      advanceProgress(3),
    ]);
    if (!data) {
      // Catastrophic Gemini failure — bounce back to input so the
      // visitor can retry. This is the only place we leave the funnel.
      setPhase('input');
      return;
    }
    setSiteData(data);
    setPhase('reveal');
  };
```

- [ ] **Step 5.3: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 5.4: Verify in browser**

Run: `cd /Users/ibrahim/AI-Barber && npm run dev &` then open `http://localhost:3000/generatebarbershop` in a browser.
Expected: hero loads → type "Test Shop" → click "Generate my website" → see 3 progress steps tick over ~3s → land on "Reveal phase — wired in Task 7." placeholder.

Stop the dev server (Ctrl+C).

- [ ] **Step 5.5: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/GenerateBarbershopFunnel.tsx && git commit -m "feat(funnel): name-path generation via generateContent

Submits shopName + empty area/phone to the same Gemini service the
homepage uses. advanceProgress paces the visible theater so the
visitor sees motion even on fast network. Both the Gemini call and
the 3-step animation must finish before we flip to reveal.

If Gemini fails catastrophically, the funnel bounces back to input
silently — no error banner shown.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 6: Link-path generation with 5s timeout + silent fallback

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`

- [ ] **Step 6.1: Import buildSiteFromScrape**

Add to the existing imports:

```tsx
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
```

- [ ] **Step 6.2: Replace the runLinkGeneration stub**

Find:

```tsx
const runLinkGeneration = async (_url: string, _typedName: string) => { console.log('[funnel] link path stub'); };
```

Replace with:

```tsx
  const runLinkGeneration = async (url: string, typedName: string) => {
    // Race: the scrape against a 5-second wall-clock timeout. On
    // success we use the scrape; on timeout OR error we silently fall
    // back to name-path generation using either the typed name OR
    // a name derived from the URL.
    const fallbackName = typedName.trim() || deriveNameFromUrl(url);

    const scrapePromise = (async () => {
      const resp = await fetch('/api/import-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!resp.ok) throw new Error(`scrape ${resp.status}`);
      return resp.json();
    })();

    const timeoutPromise = new Promise<{ __timeout: true }>((resolve) =>
      setTimeout(() => resolve({ __timeout: true }), 5_000),
    );

    const winner = await Promise.race([
      scrapePromise.catch((err) => ({ __error: err })) as Promise<any>,
      timeoutPromise as Promise<any>,
    ]);

    if (winner?.__timeout || winner?.__error || !winner) {
      console.warn('[funnel] link path fallback to name path:', winner?.__error || 'timeout');
      // Silent fall-through. Same theater, name path.
      setProgressSource('name');
      await runNameGeneration(fallbackName);
      return;
    }

    // Scrape returned a payload. buildSiteFromScrape merges scraped
    // fields with the typed name (manual override wins).
    let data;
    try {
      data = buildSiteFromScrape(winner, { manual: { shopName: fallbackName, area: '', phone: '' } });
    } catch (err) {
      console.warn('[funnel] buildSiteFromScrape threw, falling back to name path:', err);
      setProgressSource('name');
      await runNameGeneration(fallbackName);
      return;
    }

    await advanceProgress(3);
    setSiteData(data);
    setPhase('reveal');
  };

  // "https://booksy.com/en_us/the-gentlemens-lounge" → "The Gentlemens Lounge"
  const deriveNameFromUrl = (raw: string): string => {
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname.split('.')[0];
      return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Barbershop';
    } catch {
      return 'Barbershop';
    }
  };
```

- [ ] **Step 6.3: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 6.4: Verify in browser (real link path)**

Run: `cd /Users/ibrahim/AI-Barber && npm run dev &` then `http://localhost:3000/generatebarbershop`.
Type a real Booksy URL into the accelerator → click "Generate from my link". Expected: within ~5s, lands on reveal placeholder. Open browser DevTools → Network tab → confirm one POST to `/api/import-scrape`.

Then test fallback: paste `https://example.com/not-real` → expected: silent fallback runs name-path with name derived from URL, reaches reveal in ~3s after the 5s timeout, no error visible.

Stop the dev server.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/GenerateBarbershopFunnel.tsx && git commit -m "feat(funnel): link-path generation + 5s timeout silent fallback

Races /api/import-scrape against a 5-second wall-clock timer. On
success we hand the payload to buildSiteFromScrape (same merge
function /booksy uses). On timeout or scrape error we silently run
the name path with a name derived from the URL — never show the
visitor an error.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 7: Reveal phase — mount EuphoriaWebsite

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`

- [ ] **Step 7.1: Add EuphoriaWebsite lazy import + auth context**

Add to imports at the top:

```tsx
import { Suspense, lazy } from 'react';
import { useAuth } from '../contexts/AuthContext';

const EuphoriaWebsite = lazy(() => import('./EuphoriaWebsite').then((m) => ({ default: m.EuphoriaWebsite })));
```

Also adjust the existing `import React, { useState } from 'react';` to include `Suspense` and `lazy` (or import them separately as above — pick the form that matches existing files in this repo).

- [ ] **Step 7.2: Wire `useAuth` inside the component**

Below the existing `useState` calls, add:

```tsx
  const { user } = useAuth();
```

- [ ] **Step 7.3: Replace the reveal-phase placeholder with the actual mount**

Find the existing block:

```tsx
if (phase === 'reveal') {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: BG, color: 'white', fontFamily: SANS }}>
      <p>Reveal phase — wired in Task 7.</p>
    </div>
  );
}
```

Replace with:

```tsx
  if (phase === 'reveal' && siteData) {
    return (
      <Suspense fallback={<div style={{ background: BG, minHeight: '100vh' }} />}>
        <EuphoriaWebsite
          data={siteData}
          onBack={() => {
            // Returning from the editor resets to input so the visitor
            // can try a different name / link. Existing pending site in
            // GCS/localStorage persists — it's keyed on siteId not on
            // funnel state, so no cleanup needed here.
            setPhase('input');
            setSiteData(null);
            setProgressStep(0);
          }}
          userId={user?.id ?? null}
          isPostPayment={false}
        />
      </Suspense>
    );
  }
```

- [ ] **Step 7.4: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 7.5: Verify in browser**

`npm run dev` → `/generatebarbershop` → generate a site → expected: see EuphoriaWebsite render with hero, services, gallery, etc. Sticky "Launch My Site" CTA visible at bottom (it's mounted inside EuphoriaWebsite per the existing pattern). Inline editing on hero text should work because EuphoriaWebsite owns that behavior.

- [ ] **Step 7.6: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/GenerateBarbershopFunnel.tsx && git commit -m "feat(funnel): mount EuphoriaWebsite on reveal

Passes the generated WebsiteData to the same renderer /booksy and the
homepage use. Inherits the sticky PrePaymentBanner, the inline editor,
the preparePendingSite flow, and the post-payment Stripe handoff
without any changes to EuphoriaWebsite itself.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 8: Create DetailCollectionBar skeleton (visuals + step state, no parent wiring yet)

**Files:**
- Create: `/Users/ibrahim/AI-Barber/components/DetailCollectionBar.tsx`

- [ ] **Step 8.1: Write the file**

Write `/Users/ibrahim/AI-Barber/components/DetailCollectionBar.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { ArrowRight, X } from 'lucide-react';

export interface DetailCollectionBarProps {
  // Fires on every keystroke so the parent funnel can update siteData
  // and the live preview re-renders without a second "Generate" click.
  onChange: (field: 'area' | 'phone', value: string) => void;
  // Fires when both fields are filled and the bar auto-hides, OR when
  // the visitor X's the bar. Parent unmounts the bar in response.
  onClose: () => void;
  initialArea?: string;
  initialPhone?: string;
}

const GOLD = '#e8c074';
const BG_BAR = 'rgba(20,20,20,0.92)';

export const DetailCollectionBar: React.FC<DetailCollectionBarProps> = ({
  onChange,
  onClose,
  initialArea = '',
  initialPhone = '',
}) => {
  const [step, setStep] = useState<0 | 1>(0);
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const [closing, setClosing] = useState(false);

  // Auto-hide after both filled. We require BOTH non-empty so a
  // visitor who advances to step 1 without typing in step 0 isn't
  // auto-dismissed before they fill anything.
  useEffect(() => {
    if (step === 1 && area.trim() && phone.trim()) {
      const t = setTimeout(() => {
        setClosing(true);
        const t2 = setTimeout(() => onClose(), 350);
        return () => clearTimeout(t2);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [step, area, phone, onClose]);

  return (
    <div
      className="fixed left-1/2 z-50 px-4 py-3 rounded-lg backdrop-blur-md transition-all duration-300"
      style={{
        bottom: closing ? '-100px' : '88px',
        transform: 'translateX(-50%)',
        background: BG_BAR,
        border: `1px solid rgba(232,192,116,0.35)`,
        boxShadow: '0 12px 32px -6px rgba(0,0,0,0.55)',
        maxWidth: 'min(92vw, 460px)',
        width: '100%',
        opacity: closing ? 0 : 1,
        fontFamily: '"Manrope", "Inter", system-ui, sans-serif',
      }}
    >
      {/* Header row: progress pill + close */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.22em] px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(232,192,116,0.18)', color: GOLD }}
        >
          {step === 0 ? '1 of 2' : '2 of 2'}
        </span>
        <button
          type="button"
          onClick={() => onClose()}
          aria-label="Dismiss"
          className="text-white/40 hover:text-white/80 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {step === 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (area.trim()) setStep(1);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            autoFocus
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              onChange('area', e.target.value);
            }}
            placeholder="Where's your shop located?"
            className="flex-1 px-3 py-2 bg-transparent text-white placeholder-white/40 text-[13px] outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '4px' }}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition"
            style={{ background: GOLD, color: '#0a0a0a', borderRadius: '4px' }}
          >
            Next <ArrowRight size={11} />
          </button>
        </form>
      )}

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="tel"
            autoFocus
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              onChange('phone', e.target.value);
            }}
            placeholder="What's your phone number?"
            className="flex-1 px-3 py-2 bg-transparent text-white placeholder-white/40 text-[13px] outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '4px' }}
          />
        </form>
      )}
    </div>
  );
};

export default DetailCollectionBar;
```

- [ ] **Step 8.2: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 8.3: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/DetailCollectionBar.tsx && git commit -m "feat(funnel): DetailCollectionBar component

Center-docked floating bar, two questions sequentially (area then
phone — most-sensitive last per spec). Progress pill 1/2 → 2/2.
Auto-hides 600ms after both fields non-empty. X dismisses immediately.
Not wired into the funnel yet — that's Task 9.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 9: Wire DetailCollectionBar into funnel (live keystroke updates)

**Files:**
- Modify: `/Users/ibrahim/AI-Barber/components/GenerateBarbershopFunnel.tsx`

- [ ] **Step 9.1: Import the bar + track visibility**

Add to imports:

```tsx
import { DetailCollectionBar } from './DetailCollectionBar';
```

Below the existing `useState` calls, add:

```tsx
  const [showBar, setShowBar] = useState(true);
```

When `phase` transitions to `'reveal'`, `showBar` is already true. When `phase` transitions away or the user dismisses, the bar unmounts.

- [ ] **Step 9.2: Define the keystroke handler**

Add inside the component, above the return blocks:

```tsx
  const handleBarChange = (field: 'area' | 'phone', value: string) => {
    setSiteData((prev) => {
      if (!prev) return prev;
      if (field === 'area') return { ...prev, area: value };
      return { ...prev, phone: value };
    });
  };
```

- [ ] **Step 9.3: Update the reveal-phase return to overlay the bar**

Find the existing reveal-phase block from Task 7:

```tsx
if (phase === 'reveal' && siteData) {
  return (
    <Suspense fallback={...}>
      <EuphoriaWebsite ... />
    </Suspense>
  );
}
```

Replace with:

```tsx
  if (phase === 'reveal' && siteData) {
    return (
      <>
        <Suspense fallback={<div style={{ background: BG, minHeight: '100vh' }} />}>
          <EuphoriaWebsite
            data={siteData}
            onBack={() => {
              setPhase('input');
              setSiteData(null);
              setProgressStep(0);
              setShowBar(true);
            }}
            userId={user?.id ?? null}
            isPostPayment={false}
          />
        </Suspense>
        {showBar && (
          <DetailCollectionBar
            onChange={handleBarChange}
            onClose={() => setShowBar(false)}
            initialArea={siteData.area || ''}
            initialPhone={siteData.phone || ''}
          />
        )}
      </>
    );
  }
```

- [ ] **Step 9.4: Type-check**

Run: `cd /Users/ibrahim/AI-Barber && npx tsc --noEmit 2>&1 | grep -v "capture-lead.ts\|lib/supabase.ts" | head -5`
Expected: empty.

- [ ] **Step 9.5: Verify in browser — keystroke propagation**

`npm run dev` → `/generatebarbershop` → generate from a shop name. Once reveal mounts:
1. Bar shows at bottom with "Where's your shop located?"
2. Type "Beverly Hills, CA" character-by-character. EuphoriaWebsite's contact strip + footer should reflect the area in real time.
3. Click "Next".
4. Type a phone like "555-123-4567". Footer / contact phone updates per-keystroke.
5. ~600ms after both filled, the bar slides down + unmounts.
6. Sticky "Launch My Site" button at the bottom remains visible.

If keystroke updates DON'T propagate, EuphoriaWebsite is likely caching the initial `data` prop in its own state — read `EuphoriaWebsite.tsx` to confirm it has a `useEffect(() => setEditedData(data), [data])`. If it doesn't, that's an upstream issue out of scope for this funnel; document it for a follow-up rather than monkey-patching.

- [ ] **Step 9.6: Verify the X dismissal**

Reload `/generatebarbershop`, regenerate, when bar shows click the X icon → expected: bar slides away immediately, no fields cleared, sticky CTA remains.

- [ ] **Step 9.7: Commit**

```bash
cd /Users/ibrahim/AI-Barber && git add components/GenerateBarbershopFunnel.tsx && git commit -m "feat(funnel): wire DetailCollectionBar to live siteData state

handleBarChange lifts the bar's per-keystroke values into the funnel's
siteData. EuphoriaWebsite re-renders on every prop change so the
visitor sees their typing flow into the contact strip + footer
without a second 'Generate' click.

Bar mounts only during phase='reveal' and is dismissible at any
time without losing already-typed values.

Refs: docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md"
```

---

## Task 10: Regression sweep + push branch + open PR

**Files:** none (verification + git only)

- [ ] **Step 10.1: Run the existing build to catch any lurking issue**

Run: `cd /Users/ibrahim/AI-Barber && npm run build 2>&1 | tail -20`
Expected: `✓ built in ...` with no errors. Bundle sizes printed.

- [ ] **Step 10.2: Manually verify every existing subpage still works**

Run dev server: `cd /Users/ibrahim/AI-Barber && npm run dev`. Open each in turn:

1. `http://localhost:3000/` — homepage GeneratorForm loads.
2. `http://localhost:3000/booksy` — Booksy import form loads.
3. `http://localhost:3000/free-barber` — free-barber landing loads.
4. `http://localhost:3000/new` — NewLeadQuizForm loads.
5. `http://localhost:3000/primebarber` — PrimeBarber landing loads.
6. `http://localhost:3000/recover` — recovery page loads.
7. `http://localhost:3000/generatebarbershop` — new funnel loads.

Each should mount without console errors. If any one shows a regression, halt and trace the cause back to the App.tsx early-return ordering before continuing.

- [ ] **Step 10.3: Push the branch**

Run:
```bash
cd /Users/ibrahim/AI-Barber && git push
```

Expected: branch `generatebarbershop-funnel` updated on `origin`.

- [ ] **Step 10.4: Open a PR for review**

Run:
```bash
cd /Users/ibrahim/AI-Barber && gh pr create --title "feat: /generatebarbershop funnel" --body "$(cat <<'EOF'
## Summary

- New `/generatebarbershop` fast-conversion funnel
- Single-input hero (shop name) plus accelerator card accepting Booksy / Fresha / Square / Vagaro / StyleSeat links
- Theatrical 3-step generation with 5s scrape timeout + silent fallback to name-path
- Reveal mounts the existing EuphoriaWebsite renderer with a center-docked DetailCollectionBar that updates the live preview on every keystroke (area then phone, most-sensitive last)
- Uses the existing PrePaymentBanner sticky CTA, embedded Stripe, post-payment handleStripeReturn (with today's Purchase-pixel-before-deploy fix), PostDeploymentModal, AuthModal signup, and dashboard handoff — no changes to any of those paths
- Only two new files; App.tsx + lib/dealMode.ts get minimal additive edits

## Refs

- Spec: `docs/superpowers/specs/2026-06-13-generate-barbershop-funnel-design.md`
- Plan: `docs/superpowers/plans/2026-06-13-generatebarbershop-funnel.md`

## Test plan

- [ ] Visit `/generatebarbershop` → hero loads
- [ ] Name-path: type "Test Shop" → generate → reveal in ~3s with that name visible
- [ ] Link-path success: paste a real Booksy URL → scrape pulls services + photos within 5s
- [ ] Link-path silent fallback: paste a broken URL → silently falls through to name path after 5s, no error visible
- [ ] DetailCollectionBar: keystrokes in area / phone update the preview live
- [ ] Bar auto-hides ~600ms after both fields non-empty
- [ ] X dismisses the bar immediately without clearing fields
- [ ] Launch My Site (sticky CTA inside EuphoriaWebsite) opens embedded Stripe modal
- [ ] Complete a test-mode checkout → land on `/?stripe_session=...` → existing handleStripeReturn fires Purchase pixel before deploy → PostDeploymentModal opens with real `*.vercel.app` URL
- [ ] Signup modal opens with Stripe email pre-filled → create account → land in dashboard → site card visible
- [ ] Edit My Site → editor opens with all content → save → Supabase row updates
- [ ] Regression: `/`, `/booksy`, `/free-barber`, `/new`, `/primebarber`, `/recover` all still mount and function as before

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 10.5: Verify Vercel preview deploy**

Watch Vercel dashboard → the PR triggers a preview deployment. Once it goes "Ready" (~60s):
1. Open the preview URL + append `/generatebarbershop`
2. Walk through the whole funnel end-to-end with a Stripe **test** card (`4242 4242 4242 4242`)
3. Confirm Purchase event in Meta Events Manager test events tab
4. Confirm a new row appears in Supabase `sites` table linked to your test user

If any step fails on preview, fix on the same branch, push, re-test on the next preview deploy. Do NOT merge to `main` until every test-plan item passes.

---

## Self-review notes

**Spec coverage:**
- Hero + accelerator → Task 2
- Theatrical generation → Task 4 (visual) + Tasks 5/6 (orchestration)
- Silent 5s fallback → Task 6
- Reveal full-screen scrollable → Task 7
- Docked bar with sequential questions + progress + auto-hide + dismissible → Tasks 8/9
- Live keystroke updates → Task 9
- Sticky Launch CTA → inherited via EuphoriaWebsite (Task 7) — no new code
- Post-payment flow → entirely inherited via existing App.tsx handleStripeReturn (no task needed; tested in Step 10.5)
- Isolation from existing subpages → enforced by App.tsx early-return ordering (Task 3) and verified in Step 10.2

**Type consistency:**
- `runNameGeneration(name: string)` and `runLinkGeneration(url: string, typedName: string)` signatures consistent between stubs (Task 4) and implementations (Tasks 5/6)
- `setProgressStep`, `setProgressSource`, `setSiteData`, `setPhase` all defined in Task 4, consumed identically through Tasks 5/6/7/9
- `DetailCollectionBarProps` (`onChange`, `onClose`, `initialArea`, `initialPhone`) declared in Task 8 and consumed identically in Task 9
- `WebsiteData` shape used for `siteData` matches `services/geminiService.generateContent` return type, `buildSiteFromScrape` return type, AND `EuphoriaWebsite`'s `data` prop type — all import from `types.ts`
