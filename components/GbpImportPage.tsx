import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { ShopInputs, WebsiteData } from '../types.ts';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape.ts';
import { extractFirstUrl, isSupportedBookingHost } from '../lib/supportedBookingHost.ts';
import { BRAND_SWATCHES, DEFAULT_SWATCH } from '../lib/brandSwatches.ts';

// AI-Barber homepage importer. Ported from PrimeHub's
// components/GbpImportPage.tsx (the /barber "gate" variant).
//
// PORT NOTES — what changed and why:
//
//  • PrimeHub's component is multi-tenant: `homeMode`, `homeNiche`,
//    `nicheImporter`, `forceBooksyMode` and `barberGate` select between
//    20+ trade subpages. AI-Barber is barber-only and this component
//    renders on exactly one route ("/"), so every one of those props is
//    gone and the code behaves as if PrimeHub's `barberGate` were
//    permanently true. The NICHES / NicheSlug dependency is gone with
//    them — there is nothing left to branch on.
//
//  • PrimeHub stamps a `pricingTier` ('barber9' | 'niche10' | 'home9' |
//    'booking15') onto its GeneratorInputs. That vocabulary does NOT
//    exist in AI-Barber and its checkout would mis-price anyone carrying
//    it, so the field is deleted outright — not renamed, not defaulted.
//
//  • PrimeHub emits GeneratorInputs { industry, companyName, location,
//    phone, brandColor, bookingUrl, sourceUrl, pricingTier }. This emits
//    AI-Barber's ShopInputs { shopName, area, phone, bookingUrl,
//    colorTheme } via lib/buildSiteFromScrape.ts — see `toShopSite()`.
//
//  • PrimeHub's inline 3-field "no booking link" form is dropped: with
//    the gate always on, its own "No booking link?" affordance routes to
//    the business-name branch instead, and AI-Barber's GeneratorForm is
//    the real manual form (reached via onUseManualForm).
//
// Two branches behind one question:
//   "Yes, I have a booking link" → POST /api/import-scrape  (existing,
//      proven AI-Barber route: Booksy / theCut / Fresha / Square /
//      StyleSeat / Vagaro / Goldie / Setmore)
//   "No, I don't have one"       → /api/places-autocomplete (typeahead)
//      → /api/find-business (pick your listing) → /api/import-business
//      (Google Business Profile scrape)
// Both land in buildSiteFromScrape() and hand App a PREBUILT
// WebsiteData, so generateContent() never runs over real scraped data.

interface Props {
  // Same signature as GeneratorForm's onGenerate, so App can hand both
  // components the identical handleGenerate.
  onImported: (inputs: ShopInputs, prebuilt?: WebsiteData) => void;
  // Escape hatch to the classic GeneratorForm (PrimeHub calls this
  // onUseManualForm too). Also the landing spot when Google can't be
  // reached at all.
  onUseManualForm: () => void;
  // Opens the sign-in modal — existing customers reach their editor from
  // here, since this page replaces the old form's sign-in link on "/".
  onSignIn?: () => void;
}

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';

const LOADING_STEPS = [
  { pct: 9,  label: 'Opening your listing…' },
  { pct: 24, label: 'Reading your name, phone & address…' },
  { pct: 40, label: 'Importing your photos…' },
  { pct: 56, label: 'Collecting reviews & star rating…' },
  { pct: 70, label: 'Reading your business hours…' },
  { pct: 84, label: 'Styling your barbershop site…' },
  { pct: 95, label: 'Assembling your website…' },
];

const LINK_LOADING_STEPS = [
  { pct: 9,  label: 'Opening your booking page…' },
  { pct: 24, label: 'Reading your name, phone & address…' },
  { pct: 40, label: 'Importing your service menu & prices…' },
  { pct: 56, label: 'Importing your photos…' },
  { pct: 70, label: 'Collecting reviews & hours…' },
  { pct: 84, label: 'Styling your barbershop site…' },
  { pct: 95, label: 'Assembling your website…' },
];

// ── Premium tokens ───────────────────────────────────────────────────
// Ink-blue-black canvas (never pure #000), porcelain text, hairline
// rules at 8% white, and ONE accent spent only on the caret, the
// eyebrow, a single italic word, and the CTA. PrimeHub's champagne
// (#D8B56C) is swapped for AI-Barber's brand gold so the page reads
// on-brand with the rest of aibarber.org.
const BK = {
  bg: '#0B0E14',
  text: '#EDEFF4',
  muted: '#8A93A6',
  faint: '#5A6274',
  hair: 'rgba(237,239,244,0.08)',
  accent: '#f4a100',
  accentDeep: '#8a5c00',
  accentInk: '#15130C',
};
const AC = BK.accent;
const ACI = BK.accentInk;

// Real link shapes for the self-typing placeholder. Self-scheduling
// timeout chain — never key the effect on the typed string, a
// same-string setState bails out and kills the loop.
const TYPE_LINKS = [
  'booksy.com/en-us/12345_fade-factory_barber-shop_houston',
  'thecut.co/your-barber',
  'fresha.com/a/your-shop',
  'squareup.com/appointments/book/your-shop',
  'vagaro.com/yourbarbershop',
  'styleseat.com/m/v/yourname',
];
const TYPE_NAMES = [
  "Jack's Barbershop",
  'Fade Factory',
  'Kings Cut Barbershop',
  'The Sharp Edge',
  'Crown & Blade Barbers',
];

// Google Business listings carry no service menu, so a GBP import would
// otherwise render an empty "What We Offer" section (the luxe renderer
// paints that heading unconditionally). Seed the same barber menu
// geminiService uses for its non-scraped sites; every row is editable.
const DEFAULT_BARBER_SERVICES = [
  { title: 'Classic Haircut', description: 'A clean, considered cut tailored to how you actually wear your hair.' },
  { title: 'Beard Trim & Styling', description: 'Defined lines, blended length, and a finish that holds between visits.' },
  { title: 'Hot Towel Shave', description: 'A traditional straight-razor shave with warm towels and a clean, close finish.' },
  { title: 'Skin Fade', description: 'Precise tapering from skin upward, blended for a clean, modern shape.' },
  { title: 'Hair & Scalp Treatment', description: 'A thorough cleanse and conditioning treatment to reset the scalp.' },
];

const CSS = `
  @keyframes bkRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes bkDraw { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes bkFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes bkCaret { 0%, 45% { opacity: 1; } 50%, 95% { opacity: 0; } 100% { opacity: 1; } }
  .bk-rise { opacity: 0; animation: bkRise 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }
  .bk-underline { transform-origin: left center; animation: bkDraw 0.9s cubic-bezier(0.22,1,0.36,1) 0.55s backwards; }
  .bk-step { animation: bkFade 0.45s ease-out; }
  .bk-caret { display: inline-block; width: 2px; height: 1.05em; vertical-align: text-bottom; background: ${AC}; animation: bkCaret 1.1s step-end infinite; margin-left: 2px; }
  .bk-input::placeholder { color: #414A5C; opacity: 1; }
  input.bk-name-input { font-size: clamp(1.35rem, 3.2vw, 1.9rem) !important; }
  .bk-input:focus { outline: none; }
  .bk-input:focus ~ .bk-line { background: rgba(237,239,244,0.35); }
  .bk-cta:hover .bk-arrow { transform: translateX(4px); }
  .bk-cta:focus-visible, .bk-ghost:focus-visible, .bk-swatch:focus-visible { outline: 2px solid ${AC}; outline-offset: 3px; }
  @keyframes bkPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.72); } }
  .bk-dot { animation: bkPulse 1.1s ease-in-out infinite; }
  .bk-log { opacity: 0; animation: bkFade 0.4s ease-out forwards; }
  .bk-eta { animation: bkEtaPulse 2.6s ease-in-out infinite; }
  .bk-gridbg {
    background-image: radial-gradient(rgba(237,239,244,0.05) 1px, transparent 1px);
    background-size: 30px 30px;
    -webkit-mask-image: radial-gradient(75% 70% at 50% 38%, #000 30%, transparent 100%);
    mask-image: radial-gradient(75% 70% at 50% 38%, #000 30%, transparent 100%);
  }
  .bk-glosscard {
    position: relative;
    border-radius: 26px;
    background: linear-gradient(178deg, #ffffff 0%, #f7f8fa 58%, #eef0f4 100%);
    border: 1px solid rgba(255,255,255,0.55);
    box-shadow:
      0 1px 0 rgba(255,255,255,0.9) inset,
      0 -18px 40px -30px rgba(11,14,20,0.25) inset,
      0 30px 80px -30px rgba(0,0,0,0.75),
      0 6px 18px -8px rgba(0,0,0,0.5);
  }
  .bk-glosscard::before {
    content: ''; position: absolute; inset: 0; border-radius: 26px; pointer-events: none;
    background: linear-gradient(115deg, rgba(255,255,255,0.85) 0%, transparent 24%);
    opacity: 0.7;
  }
  .bk-mono .bk-caret { background: var(--ta, #0B0E14); }
  .bk-mono .bk-input:focus ~ .bk-line { background: rgba(11,14,20,0.5) !important; }
  .bk-mono .bk-input::placeholder { color: rgba(11,14,20,0.32); }
  .bk-monocta { transition: transform 0.15s ease, box-shadow 0.2s ease, filter 0.2s ease; }
  .bk-monocta:hover { filter: brightness(1.35); box-shadow: 0 16px 36px -14px rgba(0,0,0,0.55); }
  h1.bk-serif, span.bk-serif { font-family: "Instrument Serif", "Times New Roman", Georgia, serif !important; }
  .bk-hrow { white-space: nowrap; }
  @keyframes bkEtaPulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .bk-rise, .bk-underline, .bk-step, .bk-log, .bk-eta { animation: none; opacity: 1; transform: none; }
    .bk-dot, .bk-caret { animation: none; }
  }
`;

const H_SIZE = 'clamp(1.68rem, 6.7vw, 5.5rem)';

// The API response both routes return (AI-Barber's ScrapeResponse
// shape — /api/import-business deliberately mirrors /api/import-scrape
// so there is exactly one mapping layer, right here).
interface ScrapePayload {
  shopName?: string;
  area?: string;
  address?: string;
  phone?: string;
  description?: string;
  bookingUrl?: string;
  photos?: string[];
  services?: any[];
  reviews?: any[];
  hours?: any[];
  staff?: any[];
  aggregateRating?: any;
  _platform?: string;
}

const GbpImportPage: React.FC<Props> = ({ onImported, onUseManualForm, onSignIn }) => {
  // 'gate' asks the yes/no question; 'link' is the booking-link
  // importer; 'name' is the Google Business name importer.
  const [gateBranch, setGateBranch] = useState<'gate' | 'link' | 'name'>('gate');
  const linkMode = gateBranch === 'link';
  const stepsSource = linkMode ? LINK_LOADING_STEPS : LOADING_STEPS;

  const [url, setUrl] = useState('');
  const [bizName, setBizName] = useState('');

  // "Find my business" — search-only candidates the visitor picks from
  // before the real import runs (kills the wrong-top-match bug).
  const [findBusy, setFindBusy] = useState(false);
  const [candidates, setCandidates] = useState<
    null | { title: string; address: string; category: string; placeId: string; rating: number | null; reviews: number | null }[]
  >(null);
  const [searchedNear, setSearchedNear] = useState<string | null>(null);

  // ── Typeahead ─────────────────────────────────────────────────────
  // Suggestions appear as the visitor types — debounced 350ms, min 3
  // chars, biased to their real location (geolocation requested once
  // they're clearly typing). Unlike PrimeHub this calls OUR route
  // rather than places.googleapis.com directly: AI-Barber ships no
  // browser Places key, and a server key must never reach the bundle.
  //
  // /api/places-autocomplete answers 200 with { suggestions: [], error }
  // when GOOGLE_PLACES_SERVER_KEY is missing (it is, on this project).
  // That message renders as a quiet hint under the field — the funnel
  // still completes through "Find my business" (Apify-backed) and the
  // manual form, so nothing dead-ends on Google.
  const [suggestions, setSuggestions] = useState<
    null | { placeId: string; main: string; secondary: string }[]
  >(null);
  const [suggestHint, setSuggestHint] = useState<string | null>(null);
  const sugTimer = useRef<number | null>(null);
  const geoRef = useRef<{ lat: number; lng: number } | null>(null);
  const requestGeo = () => {
    if (geoRef.current || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => { geoRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
      () => { /* denied — suggestions stay unbiased */ },
      { timeout: 5000, maximumAge: 600000 },
    );
  };

  const [busy, setBusy] = useState(false);
  // Shown once an import has run 15s+ — the bar is honest (it eases
  // toward 92% while the server works) but a slow bar reads as "stuck"
  // without a word of reassurance.
  const [slowHint, setSlowHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  // Brand accent for the generated site. Always one of AI-Barber's own
  // BRAND_SWATCHES, so it maps 1:1 onto ShopInputs.colorTheme (a hex) —
  // no new colorTheme vocabulary is invented here.
  const [brandColor, setBrandColor] = useState<string>(DEFAULT_SWATCH);

  const stepTimerRef = useRef<number | null>(null);
  // Milestone-driven progress: the bar eases toward capRef (the current
  // stage's ceiling) and snaps forward when a real stage resolves — it
  // never sits parked at a fake number while work is still running, and
  // 100% means the site is genuinely ready to reveal.
  const capRef = useRef(0);
  // Run guard: browser Back into a bfcache-frozen import bumps this so
  // a late fetch resolution can't navigate away.
  const runIdRef = useRef(0);

  // Warm the serverless functions on the first keystroke so the real
  // import never pays a cold start. Both routes answer GET with a
  // cheap { ok: true }.
  const warmedRef = useRef(false);
  const warmUp = () => {
    if (warmedRef.current) return;
    warmedRef.current = true;
    void fetch('/api/import-business').catch(() => {});
    void fetch('/api/find-business').catch(() => {});
  };

  // Back button lands on the CLEAN funnel: bfcache restores this page
  // frozen mid-import — reset everything and abandon the in-flight run.
  // Only `pendingFormInputs` is cleared; `appView` / `activeSiteId` are
  // left alone because App's restore machinery owns them and this page
  // only ever renders while they're already in the generator state.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      runIdRef.current += 1;
      capRef.current = 0;
      setBusy(false); setError(null); setProgress(0); setStepIdx(0);
      setCandidates(null); setSuggestions(null); setFindBusy(false);
      try { sessionStorage.removeItem('pendingFormInputs'); } catch { /* ignore */ }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Self-typing placeholder. The link branch animates the link field,
  // the name branch animates the business-name field — both stop as
  // soon as that field has real input.
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if ((linkMode ? url : bizName) || busy) { setTyped(''); return; }
    let alive = true;
    let idx = 0, pos = 0, deleting = false;
    let t: number;
    const tick = () => {
      if (!alive) return;
      const examples = linkMode ? TYPE_LINKS : TYPE_NAMES;
      const word = examples[idx % examples.length];
      if (!deleting) {
        pos += 1;
        setTyped(word.slice(0, pos));
        if (pos >= word.length) { deleting = true; t = window.setTimeout(tick, 1600); return; }
        t = window.setTimeout(tick, 34 + Math.random() * 40);
      } else {
        pos -= 2;
        if (pos <= 0) { pos = 0; deleting = false; idx += 1; setTyped(''); t = window.setTimeout(tick, 420); return; }
        setTyped(word.slice(0, pos));
        t = window.setTimeout(tick, 14);
      }
    };
    t = window.setTimeout(tick, 700);
    return () => { alive = false; window.clearTimeout(t); };
  }, [linkMode, url, bizName, busy]);

  // Ease the bar toward the CURRENT stage's ceiling: fast at first,
  // decelerating as it approaches — always moving, never parked at a
  // fake number. Stage completions snap it forward.
  useEffect(() => {
    if (!busy) {
      setStepIdx(0); setProgress(0); capRef.current = 0;
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
      return;
    }
    stepTimerRef.current = window.setInterval(() => {
      setProgress((p) => {
        const cap = capRef.current;
        if (p >= cap) return p;
        return Math.min(cap, p + Math.max(0.015, (cap - p) * 0.02));
      });
    }, 120) as unknown as number;
    return () => {
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
    };
  }, [busy]);

  // Step labels/checklist follow the REAL progress instead of a clock.
  useEffect(() => {
    if (!busy) return;
    let idx = 0;
    for (let i = 0; i < stepsSource.length; i++) {
      if (progress >= stepsSource[i].pct - 4) idx = i;
    }
    setStepIdx((cur) => (idx > cur ? idx : cur));
  }, [progress, busy, stepsSource]);

  const handleNameChange = (v: string) => {
    warmUp();
    setBizName(v);
    setCandidates(null);
    if (sugTimer.current) window.clearTimeout(sugTimer.current);
    const q = v.trim();
    // Location permission prompt appears only once they're clearly
    // typing a name (2+ chars) — not the instant they tap the field.
    if (q.length >= 2) requestGeo();
    if (q.length < 3) { setSuggestions(null); return; }
    sugTimer.current = window.setTimeout(async () => {
      try {
        const body: Record<string, unknown> = { input: q };
        if (geoRef.current) { body.lat = geoRef.current.lat; body.lng = geoRef.current.lng; }
        const r = await fetch('/api/places-autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        // The route never 4xx/5xx's on a missing key, but a gateway
        // hiccup could still return HTML — parse defensively so a bad
        // body can never throw an unhandled rejection here.
        const raw = await r.text();
        let d: any = null;
        try { d = raw ? JSON.parse(raw) : null; } catch { d = null; }
        if (!d) { setSuggestions(null); return; }
        setSuggestHint(typeof d.error === 'string' && d.error ? d.error : null);
        const sugs = (Array.isArray(d.suggestions) ? d.suggestions : []) as any[];
        setSuggestions(sugs.length ? sugs : null);
      } catch {
        // Network failure — suggestions simply never appear. "Find my
        // business" and the manual form both still work.
        setSuggestions(null);
      }
    }, 350) as unknown as number;
  };

  // Import by exact NAME + ADDRESS, not by place_id. The autocomplete
  // API returns two place-id formats and the newer ('Eg…') ones aren't
  // resolvable through the crawler's place_id: search. Name + street
  // address is always resolvable and just as unambiguous.
  const handleSuggestionPick = (sg: { placeId: string; main: string; secondary: string }) => {
    setSuggestions(null);
    const q = [sg.main, sg.secondary].filter(Boolean).join(', ');
    setBizName(q);
    void runGbpImport(q);
  };

  // ── The adapter contract ─────────────────────────────────────────
  // PrimeHub's GeneratorInputs → AI-Barber's ShopInputs. Everything
  // this component hands App goes through here.
  //
  //   shopName    <- companyName (data.shopName from the route)
  //   area        <- location || address
  //   phone       <- phone
  //   bookingUrl  <- bookingUrl || ''
  //   colorTheme  <- brandColor, but ONLY when it is one of AI-Barber's
  //                  own BRAND_SWATCHES; otherwise the field is omitted
  //   template    <- not set by us; buildSiteFromScrape applies the same
  //                  'luxe' default every other AI-Barber scrape uses,
  //                  and the Design 1/2 switcher flips it in the editor
  //   industry    <- written by buildSiteFromScrape from AI-Barber's OWN
  //                  detectBooksyNiche (a lead-reporting field, unrelated
  //                  to PrimeHub's niche routing)
  //
  // NOT carried over: pricingTier, nicheSlug, brandColor, sourceUrl,
  // serviceHints. None exist in AI-Barber, and pricingTier in particular
  // would mis-price the customer at checkout.
  const themeForInputs = (): { colorTheme?: string } => {
    const hit = BRAND_SWATCHES.find((c) => c.toLowerCase() === brandColor.toLowerCase());
    return hit ? { colorTheme: hit } : {};
  };

  const toShopSite = (data: ScrapePayload, fallbackUrl: string) =>
    buildSiteFromScrape(data, fallbackUrl, {
      manual: {
        shopName: (data.shopName || '').trim(),
        area: (data.area || data.address || '').trim(),
        phone: (data.phone || '').trim(),
        bookingUrl: (data.bookingUrl || '').trim(),
        ...themeForInputs(),
      },
    });

  // Snap to 100 and hand off. 100% ALWAYS means "ready" — the only
  // thing after it is the navigation itself.
  const finishAndGo = async (runId: number, inputs: ShopInputs, prebuilt: WebsiteData) => {
    capRef.current = 100;
    setProgress(100);
    setStepIdx(stepsSource.length - 1);
    await new Promise((r) => setTimeout(r, 150));
    if (runId !== runIdRef.current) return;
    onImported(inputs, prebuilt);
  };

  // Shared request wrapper: honest progress, defensive JSON parsing
  // (a gateway timeout comes back as an HTML page), bfcache guard, and
  // a hard client-side abort so nothing spins forever.
  const runScrape = async (
    endpoint: '/api/import-business' | '/api/import-scrape',
    target: string,
    fallbackUrl: string,
    onFail: (message: string) => void,
  ) => {
    const runId = ++runIdRef.current;
    setBusy(true);
    setError(null);
    capRef.current = 92; // scrape-stage ceiling — eases toward it
    setSlowHint(false);
    const slowTimer = window.setTimeout(() => {
      if (runId === runIdRef.current) setSlowHint(true);
    }, 15_000);
    const ctrl = new AbortController();
    const abortTimer = window.setTimeout(() => ctrl.abort(), 100_000);

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target }),
        signal: ctrl.signal,
      });
      const raw = await resp.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (runId !== runIdRef.current) return; // navigated back mid-run
      if (!resp.ok) {
        throw new Error(
          data?.error ||
            (resp.status >= 500
              ? 'That took too long to answer. Tap Build my website once more — the second try is usually faster.'
              : 'Import failed'),
        );
      }
      if (!data) throw new Error('Import failed — please try again.');

      const payload = data as ScrapePayload;
      console.log('[Import]', payload._platform || endpoint, '→', {
        name: payload.shopName,
        photos: payload.photos?.length,
        services: payload.services?.length,
        reviews: payload.reviews?.length,
      });

      // A Google listing has no service menu — seed the barber default
      // so the services section isn't an empty shell. A booking-link
      // import always brings its own menu and is left untouched.
      if (!payload.services?.length) {
        payload.services = DEFAULT_BARBER_SERVICES.map((s) => ({ ...s }));
      }

      const { inputs, scraped } = toShopSite(payload, fallbackUrl);
      await finishAndGo(runId, inputs, scraped);
    } catch (err: any) {
      if (runId !== runIdRef.current) return;
      onFail(
        err?.name === 'AbortError'
          ? 'This is taking longer than it should. Tap Build my website once more — the second try is usually faster.'
          : err?.message || 'Something went wrong — try again.',
      );
      setBusy(false);
    } finally {
      window.clearTimeout(slowTimer);
      window.clearTimeout(abortTimer);
      if (runId === runIdRef.current) setSlowHint(false);
    }
  };

  // Google Business import — `target` is either a Google URL or a typed
  // "Name, City" string (the route turns the latter into a search).
  const runGbpImport = (target: string) =>
    runScrape('/api/import-business', target, '', (msg) => setError(msg));

  // Booking-link import — the proven AI-Barber path, same route and
  // same buildSiteFromScrape call GeneratorForm already uses.
  const runLinkImport = (rawLink: string) => {
    const normalized = extractFirstUrl(rawLink);
    if (!normalized) {
      setError('Paste your booking link to continue.');
      return;
    }
    if (!isSupportedBookingHost(normalized)) {
      setError(
        "That link isn't Booksy / theCut / Fresha / Square / Vagaro / StyleSeat. Tap “No booking link?” below and we'll find you on Google instead.",
      );
      return;
    }
    void runScrape('/api/import-scrape', normalized, normalized, (msg) =>
      setError(msg || "Couldn't pull from that link — try a different one."),
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (linkMode) { runLinkImport(url.trim()); return; }
    if (!bizName.trim()) return;
    // Typed names go through Find-my-business (pick from a list) so we
    // never import the wrong top match.
    void handleFind();
  };

  // Search-only pass: list matching businesses near the visitor.
  // Location priority: the browser's REAL geolocation (permission
  // prompt fires on the Find tap — a user gesture), reverse-geocoded to
  // "City, Region" via BigDataCloud's free key-less endpoint. IP city is
  // only the server-side fallback — carrier IPs routinely geolocate to
  // the wrong city.
  const handleFind = async () => {
    const q = bizName.trim();
    if (!q) return;
    setFindBusy(true);
    setError(null);
    setCandidates(null);
    let near: string | null = null;
    if (!q.includes(',') && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 600000 }),
        );
        const { latitude, longitude } = pos.coords;
        const g = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
        ).then((r) => r.json());
        near = [g.city || g.locality, g.principalSubdivisionCode?.split('-')[1] || g.principalSubdivision]
          .filter(Boolean)
          .join(', ') || null;
      } catch {
        near = null; // denied / timed out → server falls back to IP city
      }
    }
    try {
      const r = await fetch('/api/find-business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, near }),
      });
      const raw = await r.text();
      let d: any = null;
      try { d = raw ? JSON.parse(raw) : null; } catch { d = null; }
      if (!r.ok || !d) {
        throw new Error(d?.error || 'Search failed — try again, or fill in your details manually below.');
      }
      if (!d.candidates?.length) {
        setError(`No businesses found for "${q}"${d.searchedNear ? ` near ${d.searchedNear}` : ''}. Add your city — e.g. "${q.split(',')[0]}, Houston" — and try again.`);
        return;
      }
      setCandidates(d.candidates);
      setSearchedNear(d.searchedNear || null);
    } catch (e: any) {
      setError(e?.message || 'Search failed — try again.');
    } finally {
      setFindBusy(false);
    }
  };

  // Candidate picked → import EXACTLY that listing via its place_id
  // (a real Google Maps URL shape the GBP scraper already parses).
  const handlePick = (placeId: string) => {
    setCandidates(null);
    void runGbpImport(`https://www.google.com/maps/place/?q=place_id:${placeId}`);
  };

  const swatchRow = (
    <div className="flex items-center gap-3.5">
      <span className="text-[11px] font-extrabold uppercase tracking-[0.24em]" style={{ color: '#0B0E14' }}>Brand</span>
      <div className="flex items-center gap-2.5">
        {BRAND_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setBrandColor(c)}
            aria-label={`Use color ${c}`}
            className="bk-swatch h-[18px] w-[18px] rounded-full transition-transform hover:scale-110"
            style={{
              background: c,
              boxShadow: brandColor.toLowerCase() === c.toLowerCase()
                ? '0 0 0 2px #ffffff, 0 0 0 3.5px #0B0E14'
                : 'inset 0 0 0 1px rgba(11,14,20,0.18)',
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: '#070709', fontFamily: SANS, color: BK.text, ['--ta' as any]: AC }}
    >
      <style>{CSS}</style>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(52% 38% at 50% 0%, ${AC}1c, transparent 70%)` }} />
      <div aria-hidden className="bk-gridbg pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(50% 36% at 50% 6%, rgba(237,239,244,0.055), transparent 70%), radial-gradient(40% 30% at 14% 92%, rgba(237,239,244,0.035), transparent 70%)' }} />

      {busy && (
        <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto" style={{ background: BK.bg }}>
          <div className="h-[3px] w-full flex-shrink-0" style={{ background: BK.hair }}>
            <div className="h-full transition-[width] duration-300 ease-out" style={{ width: `${progress}%`, background: AC, boxShadow: `0 0 16px ${AC}88` }} />
          </div>
          <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-10">
            <div className="flex items-end gap-3">
              <span style={{ fontSize: 'clamp(4.2rem, 12vw, 7rem)', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.04em', color: BK.text, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(progress)}
              </span>
              <span className="pb-2" style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 600, color: AC }}>%</span>
            </div>
            <p key={stepIdx} className="bk-step mt-5 italic" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 'clamp(1.35rem, 3.4vw, 2rem)', color: BK.text, letterSpacing: '-0.01em' }}>
              {stepsSource[stepIdx].label}
            </p>
            {slowHint && (
              <p className="mt-3 text-[13px]" style={{ color: BK.muted }}>
                Still pulling your photos — this sometimes takes up to a minute. Hang tight, we haven&apos;t lost you.
              </p>
            )}

            <ul className="mt-8 space-y-3">
              {stepsSource.map((step, i) => {
                const done = i < stepIdx || progress >= 100;
                const active = i === stepIdx && progress < 100;
                if (i > stepIdx && !done) {
                  return (
                    <li key={step.label} className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'rgba(237,239,244,0.16)' }}>
                      <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: 'rgba(237,239,244,0.12)' }} />
                      {step.label.replace(/…$/, '')}
                    </li>
                  );
                }
                return (
                  <li key={step.label} className="bk-log flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: done ? BK.muted : BK.text }}>
                    {done ? (
                      <span className="flex h-[14px] w-[14px] items-center justify-center rounded-full text-[9px] font-black" style={{ background: AC, color: ACI }}>✓</span>
                    ) : (
                      <span className="bk-dot inline-block h-[8px] w-[8px] rounded-full" style={{ background: AC, boxShadow: `0 0 10px ${AC}` }} />
                    )}
                    {step.label.replace(/…$/, '')}
                    {active && <span className="bk-caret" style={{ height: '0.9em' }} />}
                  </li>
                );
              })}
            </ul>

            <p className="bk-eta mt-10 italic" style={{ fontFamily: SERIF, fontWeight: 400, fontSize: 'clamp(1.15rem, 3vw, 1.6rem)', color: BK.text, letterSpacing: '-0.01em' }}>
              Hang tight — your website takes about{' '}
              <span style={{ color: AC }}>60 seconds</span> to generate
            </p>
          </div>
        </div>
      )}

      <header className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12 md:py-7">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold italic" style={{ background: BK.text, color: BK.bg, fontFamily: SERIF }}>A</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.26em]" style={{ color: BK.text }}>
            AI<span style={{ color: AC }}>Barber</span>
          </span>
        </div>
        <div className="flex items-center gap-5">
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.24em] md:block" style={{ color: AC }}>
            Websites for barbers
          </span>
          {onSignIn && (
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-full border px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors hover:text-white"
              style={{ borderColor: 'rgba(237,239,244,0.22)', color: BK.muted, background: 'rgba(237,239,244,0.04)' }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 pb-16 pt-10 text-center md:px-8">
        {gateBranch === 'gate' ? (
          <div className="flex w-full flex-col items-center">
            <div className="bk-rise flex flex-wrap items-center justify-center gap-2.5" style={{ animationDelay: '0.05s' }}>
              {['Import', 'Design', 'Publish'].map((c) => (
                <span key={c} className="bk-serif rounded-full border px-4 py-1.5 italic" style={{ letterSpacing: '0.04em', fontSize: '13.5px', color: '#D6D9E0', borderColor: `${AC}59`, background: `${AC}14` }}>{c}</span>
              ))}
            </div>
            <h1 className="bk-serif bk-hrow bk-rise mt-6" style={{ animationDelay: '0.15s', fontWeight: 400, fontSize: H_SIZE, letterSpacing: '-0.015em', lineHeight: 1.08, color: '#F4F5F8' }}>
              Do you have a <span className="bk-serif italic" style={{ color: AC }}>booking link</span>?
            </h1>
            <p className="bk-rise mx-auto mt-6 max-w-lg text-[15px] leading-relaxed" style={{ animationDelay: '0.3s', color: '#8B919E' }}>
              Booksy, theCut, Fresha, Square, Vagaro — or none at all.
              Your barbershop website builds itself either way.
            </p>
            <div className="bk-rise mt-11 flex w-full max-w-xl flex-col items-stretch justify-center gap-4 md:flex-row" style={{ animationDelay: '0.42s' }}>
              <button
                type="button"
                onClick={() => { setGateBranch('link'); setError(null); }}
                className="bk-cta bk-monocta group flex items-center justify-center gap-3 whitespace-nowrap px-10 py-4 text-[13px] font-bold uppercase tracking-[0.2em] active:scale-[0.985]"
                style={{ background: `linear-gradient(180deg, ${AC} 0%, ${BK.accentDeep} 100%)`, color: ACI, borderRadius: 14, boxShadow: `0 14px 32px -12px ${AC}66, 0 1px 0 rgba(255,255,255,0.28) inset` }}
              >
                Yes, I have a booking link
                <ArrowRight size={14} className="bk-arrow transition-transform" />
              </button>
              <button
                type="button"
                onClick={() => { setGateBranch('name'); setError(null); }}
                className="bk-ghost flex items-center justify-center gap-3 whitespace-nowrap rounded-[14px] border px-10 py-4 text-[13px] font-bold uppercase tracking-[0.2em] transition-colors hover:text-white active:scale-[0.985]"
                style={{ borderColor: 'rgba(237,239,244,0.22)', color: BK.text, background: 'rgba(237,239,244,0.04)' }}
              >
                No, I don&rsquo;t have one
              </button>
            </div>
            <p className="bk-rise mt-8 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ animationDelay: '0.52s', color: BK.faint }}>
              Photos, services &amp; reviews imported automatically
            </p>
            <button
              type="button"
              onClick={onUseManualForm}
              className="bk-ghost bk-rise mt-8 text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors hover:text-white"
              style={{ color: BK.faint, animationDelay: '0.6s' }}
            >
              Rather type it in yourself? Use the classic form →
            </button>
          </div>
        ) : (
          <div className="contents">
            <div className="bk-rise flex flex-wrap items-center justify-center gap-2.5" style={{ animationDelay: '0.05s' }}>
              {['Import', 'Design', 'Publish'].map((c) => (
                <span key={c} className="bk-serif rounded-full border px-4 py-1.5 italic" style={{ letterSpacing: '0.04em', fontSize: '13.5px', color: '#D6D9E0', borderColor: `${AC}59`, background: `${AC}14` }}>{c}</span>
              ))}
            </div>
            <h1 className="bk-serif bk-hrow bk-rise mt-6" style={{ animationDelay: '0.15s', fontWeight: 400, fontSize: H_SIZE, letterSpacing: '-0.015em', lineHeight: 1.08, color: '#F4F5F8' }}>
              {linkMode ? 'Paste your booking link.' : 'Type your shop name.'}
            </h1>
            <h1 className="bk-serif bk-hrow bk-rise" style={{ animationDelay: '0.25s', fontWeight: 400, fontSize: H_SIZE, letterSpacing: '-0.015em', lineHeight: 1.08, color: '#F4F5F8' }}>
              {linkMode ? (
                <>We build the <span className="bk-serif italic" style={{ color: '#AEB4C0' }}>website</span>.</>
              ) : (
                <>Get a beautiful <span className="bk-serif italic" style={{ color: AC }}>barber</span> <span className="bk-serif italic" style={{ color: '#AEB4C0' }}>website</span>.</>
              )}
            </h1>
            <p className="bk-rise mx-auto mt-6 max-w-lg text-[15px] leading-relaxed" style={{ animationDelay: '0.34s', color: '#8B919E' }}>
              Photos, services &amp; reviews imported automatically.
              Live in about a minute — edit anything after.
            </p>

            <form onSubmit={handleSubmit} className="bk-glosscard bk-mono bk-rise mt-11 w-full max-w-2xl p-6 text-left md:p-8" style={{ animationDelay: '0.38s' }}>
              {linkMode ? (
                <div className="relative">
                  <label className="mb-3 block text-[13px] font-extrabold uppercase tracking-[0.22em]" style={{ color: '#0B0E14' }}>
                    Your booking link
                  </label>
                  <div className="relative">
                    <input
                      required
                      type="text"
                      inputMode="url"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-label="Your booking link"
                      className="bk-input bk-name-input w-full bg-transparent pb-4 pr-2"
                      style={{ fontWeight: 600, color: '#0B0E14', caretColor: '#0B0E14', letterSpacing: '-0.015em' }}
                      value={url}
                      onChange={(e) => { warmUp(); setUrl(e.target.value); }}
                    />
                    {!url && (
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 truncate pr-8" style={{ fontSize: 'clamp(1.35rem, 3.2vw, 1.9rem)', fontWeight: 600, color: 'rgba(11,14,20,0.3)', letterSpacing: '-0.015em', fontFamily: SANS }}>
                        {typed}<span className="bk-caret" />
                      </div>
                    )}
                    <div className="bk-line bk-underline absolute bottom-0 left-0 h-px w-full transition-colors duration-300" style={{ background: 'rgba(11,14,20,0.16)' }} />
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-3 block text-[13px] font-extrabold uppercase tracking-[0.22em]" style={{ color: '#0B0E14' }}>
                      Type your shop name
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        aria-label="Your shop name and city"
                        className="bk-input bk-name-input w-full bg-transparent pb-4"
                        style={{ fontWeight: 600, color: '#0B0E14', caretColor: '#0B0E14', letterSpacing: '-0.015em' }}
                        value={bizName}
                        onChange={(e) => handleNameChange(e.target.value)}
                      />
                      {!bizName && (
                        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 truncate pr-8" style={{ fontSize: 'clamp(1.35rem, 3.2vw, 1.9rem)', fontWeight: 600, color: 'rgba(11,14,20,0.3)', letterSpacing: '-0.015em', fontFamily: SANS }}>
                          {typed}<span className="bk-caret" />
                        </div>
                      )}
                      <div className="bk-line absolute bottom-0 left-0 h-px w-full transition-colors duration-300" style={{ background: 'rgba(11,14,20,0.16)' }} />
                    </div>
                  </div>

                  {/* Typeahead unavailable (no Places key / quota / network).
                      A quiet hint, NOT a blocking error — Find my business
                      and the manual form both still work. */}
                  {suggestHint && !suggestions && !candidates && bizName.trim().length >= 3 && (
                    <p className="mt-3 text-[12px] leading-relaxed" style={{ color: '#6B7280' }}>
                      {suggestHint}
                    </p>
                  )}

                  {suggestions && !candidates && (
                    <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(11,14,20,0.1)', background: '#ffffff', boxShadow: '0 14px 34px -18px rgba(0,0,0,0.35)' }}>
                      {suggestions.map((sg) => (
                        <button
                          key={sg.placeId}
                          type="button"
                          onClick={() => handleSuggestionPick(sg)}
                          className="flex w-full items-center justify-between gap-4 border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-black/[0.035]"
                          style={{ borderColor: 'rgba(11,14,20,0.08)' }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-semibold" style={{ color: '#0B0E14' }}>{sg.main}</span>
                            {sg.secondary && (
                              <span className="mt-0.5 block truncate text-[11.5px]" style={{ color: '#6B7280' }}>{sg.secondary}</span>
                            )}
                          </span>
                          <ArrowRight size={13} className="flex-shrink-0" style={{ color: '#0B0E14' }} />
                        </button>
                      ))}
                    </div>
                  )}

                  {bizName.trim() && !candidates && (
                    <button
                      type="button"
                      onClick={() => void handleFind()}
                      disabled={findBusy}
                      className="mt-5 flex items-center gap-2 rounded-full border px-6 py-2.5 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors hover:bg-black/[0.045] disabled:opacity-60"
                      style={{ borderColor: 'rgba(11,14,20,0.28)', color: '#0B0E14', background: 'transparent' }}
                    >
                      {findBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                      {findBusy ? 'Finding businesses near you…' : 'Find my business'}
                      {!findBusy && <ArrowRight size={13} />}
                    </button>
                  )}

                  {candidates && (
                    <div className="mt-6">
                      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color: '#6B7280' }}>
                        {searchedNear ? `Found near ${searchedNear} — pick yours` : 'Pick your business'}
                      </p>
                      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'rgba(11,14,20,0.1)', background: '#ffffff' }}>
                        {candidates.map((c) => (
                          <button
                            key={c.placeId}
                            type="button"
                            onClick={() => handlePick(c.placeId)}
                            className="flex w-full items-center justify-between gap-4 border-b px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-black/[0.035]"
                            style={{ borderColor: 'rgba(11,14,20,0.08)' }}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[14px] font-semibold" style={{ color: '#0B0E14' }}>{c.title}</span>
                              <span className="mt-0.5 block truncate text-[12px]" style={{ color: '#6B7280' }}>
                                {[c.category, c.address].filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <span className="flex flex-shrink-0 items-center gap-2 text-[11px] font-bold" style={{ color: '#0B0E14' }}>
                              {c.rating ? `★ ${c.rating}` : ''}
                              <ArrowRight size={13} />
                            </span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => { setCandidates(null); setError(null); }}
                        className="bk-ghost mt-3 text-[10px] font-semibold uppercase tracking-[0.2em] transition-colors hover:text-black"
                        style={{ color: '#6B7280' }}
                      >
                        None of these? Add your city and search again
                      </button>
                    </div>
                  )}
                </>
              )}

              <div className="mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-6">
                {swatchRow}
                <button
                  type="submit"
                  disabled={busy}
                  className="bk-cta bk-monocta group flex items-center gap-2.5 whitespace-nowrap px-9 py-3.5 text-[12px] font-bold uppercase tracking-[0.22em] active:scale-[0.985] disabled:opacity-50"
                  style={{ background: `linear-gradient(180deg, ${AC} 0%, ${BK.accentDeep} 100%)`, color: ACI, borderRadius: 14, boxShadow: `0 14px 32px -12px ${AC}66, 0 1px 0 rgba(255,255,255,0.22) inset` }}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Build my website
                  <ArrowRight size={14} className="bk-arrow transition-transform" />
                </button>
              </div>

              {error && (
                <div className="mt-6 border-l-2 pl-4 text-[13px] leading-relaxed" style={{ borderColor: '#dc2626', color: '#b91c1c' }}>
                  {error}
                </div>
              )}
            </form>

            <div className="bk-rise mt-10 flex flex-wrap items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: BK.faint, animationDelay: '0.5s' }}>
              <span className="mr-1" style={{ color: BK.muted }}>Works with</span>
              {(linkMode
                ? ['Booksy', 'theCut', 'Fresha', 'Square', 'Vagaro', 'StyleSeat', 'Goldie']
                : ['Google Business Profile']
              ).map((n) => (
                <span key={n} className="rounded-full border px-3 py-1.5" style={{ borderColor: `${AC}40`, color: BK.muted, background: `${AC}0d` }}>{n}</span>
              ))}
            </div>

            {/* Escape hatches. On the link branch, "no link" routes to the
                Google-name branch (PrimeHub's gate behaviour). On the name
                branch, it hands off to AI-Barber's classic GeneratorForm —
                the path that must stay open when Google can't be reached. */}
            <button
              type="button"
              onClick={() => {
                setError(null);
                if (linkMode) { setGateBranch('name'); setSuggestions(null); setCandidates(null); }
                else { onUseManualForm(); }
              }}
              className="bk-ghost bk-rise mt-5 self-center text-center text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors hover:text-white"
              style={{ color: BK.faint, animationDelay: '0.58s' }}
            >
              {linkMode
                ? 'No booking link? Type your shop name instead →'
                : "Can't find your shop? Fill in your details manually →"}
            </button>
            <button
              type="button"
              onClick={() => { setGateBranch('gate'); setError(null); setCandidates(null); setSuggestions(null); }}
              className="bk-ghost bk-rise mt-4 self-center text-center text-[11px] font-semibold uppercase tracking-[0.2em] transition-colors hover:text-white"
              style={{ color: BK.faint, animationDelay: '0.64s' }}
            >
              ← Back
            </button>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t px-6 py-5 md:px-12" style={{ borderColor: BK.hair }}>
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[10.5px]" style={{ color: BK.faint }}>
          <span>Photos, services &amp; reviews imported</span>
          <span aria-hidden style={{ color: 'rgba(237,239,244,0.18)' }}>·</span>
          <span>Live in about a minute</span>
          <span aria-hidden style={{ color: 'rgba(237,239,244,0.18)' }}>·</span>
          <span>Edit anything after</span>
        </div>
      </footer>
    </div>
  );
};

export default GbpImportPage;
