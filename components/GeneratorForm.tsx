
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShopInputs, WebsiteData } from '../types';
import { ScissorsIcon } from './Icons';
import { isSupportedBookingHost } from '../lib/supportedBookingHost.ts';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape.ts';
import { isBooksyPath } from '../lib/dealMode.ts';

// Booksy brand teal — used to highlight Booksy-specific copy in
// booksyMode. Lives here (not THEME_PRESETS) because it's an
// accent on a single field, not a sitewide theme.
const BOOKSY_TEAL = '#1AE3B9';

interface GeneratorFormProps {
  // Optional `scraped` second arg — populated when the visitor pasted
  // a supported booking URL (Booksy / Fresha / Square / Vagaro /
  // StyleSeat) and the auto-scrape succeeded. Same prebuilt-payload
  // contract /booksy uses; App.tsx forwards it to handleGenerate's
  // prebuilt param so the Gemini call is skipped.
  onGenerate: (inputs: ShopInputs, scraped?: WebsiteData) => void;
  onSignIn?: () => void;
}

// Color-theme presets — matches the PrimeHub /barber set so the two
// products stay visually consistent. The slug is written onto
// ShopInputs.colorTheme and consumed by the LUXE + EUPHORIA renderers
// to drive their CSS variables.
const THEME_PRESETS: { slug: string; label: string; bg: string; accent: string }[] = [
  { slug: 'goldBlack',   label: 'Gold & Black',   bg: '#000000', accent: '#f4a100' },
  { slug: 'blackWhite',  label: 'Black & White',  bg: '#000000', accent: '#f5f5f5' },
  { slug: 'redBlack',    label: 'Red & Black',    bg: '#000000', accent: '#dc2626' },
  { slug: 'purpleGreen', label: 'Purple & Green', bg: '#160328', accent: '#22c55e' },
];

export const GeneratorForm: React.FC<GeneratorFormProps> = ({ onGenerate, onSignIn }) => {
  // Path-aware headline + field treatment. On /booksy the form
  // pivots to a Booksy-first framing (FREE callout, teal Booksy
  // brand emphasis on the link field, "Required" instead of
  // "Optional"). The 4-input layout + auto-scrape pipeline is
  // shared — only the copy + accent change.
  const booksyMode = useMemo(() => isBooksyPath(), []);
  const [inputs, setInputs] = useState<ShopInputs>({
    shopName: '',
    area: '',
    phone: '',
    template: 'luxe',
    bookingUrl: '',
    colorTheme: 'goldBlack',
  });

  // Auto-scrape state — only kicks in when bookingUrl is a supported
  // platform. Mirrors the step ladder UX from /booksy.
  const [scraping, setScraping] = useState(false);
  const [scrapeStepIdx, setScrapeStepIdx] = useState(0);
  const [scrapeProgress, setScrapeProgress] = useState(0);
  const scrapeTimerRef = useRef<number | null>(null);
  // booksyMode error surface — when the visitor's only input is the
  // Booksy link, we can't silently fall back to manual generation
  // because the other identity fields aren't collected. Surface a
  // friendly message instead.
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const SCRAPE_STEPS = [
    { pct: 18, label: 'Fetching your shop info…' },
    { pct: 42, label: 'Loading photos & services…' },
    { pct: 66, label: 'Pulling reviews & hours…' },
    { pct: 88, label: 'Building your custom site…' },
  ];

  useEffect(() => {
    if (!scraping) {
      setScrapeStepIdx(0);
      setScrapeProgress(0);
      if (scrapeTimerRef.current) window.clearInterval(scrapeTimerRef.current);
      return;
    }
    const startedAt = Date.now();
    scrapeTimerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const idx = Math.min(SCRAPE_STEPS.length - 1, Math.floor(elapsed / 7));
      const target = SCRAPE_STEPS[idx].pct;
      setScrapeStepIdx(idx);
      setScrapeProgress((p) => (p < target ? Math.min(target, p + 0.7) : p));
    }, 120) as unknown as number;
    return () => {
      if (scrapeTimerRef.current) window.clearInterval(scrapeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scraping]);

  // Normalize a user-entered booking link: trim, drop if empty, prepend https:// if missing.
  const normalizeBookingUrl = (raw: string): string | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setScrapeError(null);
    // Homepage path requires the three identity fields. In booksyMode
    // those fields aren't shown — the Booksy link is the sole input,
    // and the scrape provides shopName/area/phone via buildSiteFromScrape.
    if (!booksyMode && !(inputs.shopName && inputs.area && inputs.phone)) return;

    const normalizedUrl = normalizeBookingUrl(inputs.bookingUrl || '');

    if (booksyMode) {
      if (!normalizedUrl) {
        setScrapeError('Paste your Booksy link to continue.');
        return;
      }
      if (!isSupportedBookingHost(normalizedUrl)) {
        setScrapeError('That link isn\'t Booksy / Fresha / Square / Vagaro / StyleSeat. Try the homepage to fill in your details manually.');
        return;
      }
    }

    // Auto-scrape path: visitor pasted a supported booking link.
    // Run /api/import-scrape, merge with the typed identity (manual
    // wins), pass a prebuilt WebsiteData to App so the Gemini
    // template call is skipped and the site renders with real
    // photos, services, hours, reviews. Mirrors /booksy + the quiz.
    if (normalizedUrl && isSupportedBookingHost(normalizedUrl)) {
      setScraping(true);
      try {
        const resp = await fetch('/api/import-scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: normalizedUrl }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.error || 'Scrape failed');

        const { inputs: builtInputs, scraped } = buildSiteFromScrape(data, normalizedUrl, {
          manual: { ...inputs, bookingUrl: normalizedUrl },
          template: inputs.template === 'euphoria' ? 'euphoria' : 'luxe',
        });
        setScrapeProgress(100);
        setScrapeStepIdx(SCRAPE_STEPS.length - 1);
        await new Promise((r) => setTimeout(r, 300));
        setScraping(false);
        onGenerate(builtInputs, scraped);
        return;
      } catch (err: any) {
        setScraping(false);
        if (booksyMode) {
          // No fallback in booksyMode — the other identity fields
          // weren't collected, so we can't generate a usable site.
          // Surface the error and let the visitor try a different link.
          setScrapeError(err?.message || 'Couldn\'t pull from that link — try a different one.');
          return;
        }
        // Homepage path: silently fall back so the visitor still
        // gets a site from their manually-typed fields.
        console.warn('[Auto-scrape] Falling back to manual generation:', err);
      }
    }

    // Manual-only path: no URL, unsupported platform, or scrape failed.
    onGenerate({ ...inputs, bookingUrl: normalizedUrl });
  };

  return (
    <div className="md:min-h-screen bg-[#0d0d0d] flex items-start md:items-stretch overflow-x-hidden">
      {/* Auto-scrape overlay — only shown when bookingUrl is a
          supported platform. Same step ladder as /booksy + the quiz. */}
      {scraping && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center px-6"
          style={{ background: 'rgba(5,7,10,0.82)', backdropFilter: 'blur(14px)' }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 p-7 text-center md:p-9"
            style={{
              background: 'linear-gradient(180deg, rgba(10,14,22,0.92), rgba(10,14,22,0.96))',
              boxShadow: '0 24px 80px -12px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(244,161,0,0.30)',
            }}
          >
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32"
              style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(244,161,0,0.30), transparent 70%)' }}
            />
            <h2 className="relative mb-6 text-white leading-tight"
              style={{ fontFamily: '"Instrument Serif", "Times New Roman", Georgia, serif', fontSize: '1.9rem', fontWeight: 400, fontStyle: 'italic' }}
            >
              Pulling from your <span style={{ color: '#f4a100' }}>booking page</span>
            </h2>
            <div className="relative mb-6 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
              <div className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
                style={{
                  width: `${scrapeProgress}%`,
                  background: 'linear-gradient(90deg, #f4a100, #ffffff, #f4a100)',
                  backgroundSize: '200% 100%',
                  animation: 'gfAutoScrapeShimmer 1.4s linear infinite',
                  boxShadow: '0 0 12px rgba(244,161,0,0.6)',
                }}
              />
              <style>{`@keyframes gfAutoScrapeShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
            </div>
            <ul className="relative space-y-3 text-left">
              {SCRAPE_STEPS.map((s, i) => {
                const done = i < scrapeStepIdx || scrapeProgress >= 100;
                const active = i === scrapeStepIdx && scrapeProgress < 100;
                return (
                  <li key={s.label}
                    className={`flex items-center gap-3 text-[12px] tracking-[1.5px] uppercase ${
                      done ? 'text-white/60' : active ? 'text-white font-bold' : 'text-white/25'
                    }`}
                  >
                    <span
                      className="inline-block w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                      style={{
                        background: done ? '#f4a100' : 'transparent',
                        border: `1px solid ${done || active ? '#f4a100' : 'rgba(255,255,255,0.2)'}`,
                        color: done ? '#000' : active ? '#f4a100' : 'rgba(255,255,255,0.25)',
                      }}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    {s.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* /booksy: single full-bleed layout — barber image fills the
          whole viewport, headline + single Booksy-link input + submit
          button stack centered in the middle of the screen. */}
      {booksyMode ? (
        <div className="relative w-full min-h-screen overflow-hidden flex items-center justify-center px-5 py-12 md:py-16">
          {/* Full-bleed barber background */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            }}
            aria-hidden="true"
          />
          {/* Vignette + darkening — pulls focus to center while
              keeping the barber chair visible at the edges. */}
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(60% 75% at 50% 50%, rgba(5,7,10,0.55) 0%, rgba(5,7,10,0.85) 65%, rgba(5,7,10,0.95) 100%)',
            }}
          />

          {/* Logo (top-left) */}
          <div className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-2 md:gap-3 z-20 pointer-events-none">
            <ScissorsIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100]" />
            <span className="text-[10px] md:text-sm font-montserrat font-black uppercase tracking-[2px] text-white">
              Prime<span className="text-[#f4a100]">Barber</span> AI
            </span>
          </div>

          {/* Sign In (top-right) */}
          {onSignIn && (
            <button
              onClick={onSignIn}
              className="absolute top-6 right-6 md:top-8 md:right-8 z-20 rounded-full border border-white/30 bg-white/[0.06] px-4 py-1.5 md:px-5 md:py-2 text-[14px] md:text-[17px] font-montserrat font-black uppercase tracking-[2px] text-white shadow-sm hover:border-white hover:bg-white/15 hover:text-[#f4a100] transition-all"
            >
              Sign In
            </button>
          )}

          {/* Centered headline + form column */}
          <div className="relative z-10 w-full max-w-2xl text-center">
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.1] text-white mb-6 md:mb-8">
              Generate Your <span style={{ color: '#f4a100' }}>FREE</span> <br className="hidden md:block"/>
              Barber Website From <br className="hidden md:block"/>
              Your <span style={{ color: BOOKSY_TEAL }}>Booksy</span> Link
              <span className="text-[#f4a100] mt-2 block">in a Few Seconds</span>
            </h1>
            <p
              className="text-[11px] md:text-sm italic text-white/70 max-w-md mx-auto mb-8 md:mb-10"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Paste your Booksy link — we'll pull your services, photos, hours, and reviews automatically.
            </p>

            <form onSubmit={handleSubmit} className="mx-auto max-w-md space-y-5">
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-2">
                  <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                    <span style={{ color: BOOKSY_TEAL }}>Booksy</span> Link
                  </label>
                  <span
                    className="text-[8px] md:text-[9px] uppercase tracking-[2px] px-1.5 py-0.5"
                    style={{ color: BOOKSY_TEAL, border: `1px solid ${BOOKSY_TEAL}66` }}
                  >
                    Required
                  </span>
                </div>
                <input
                  required
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="booksy.com/en-us/your-shop"
                  className="w-full bg-transparent border-b py-2 md:py-3 text-white text-center transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  style={{
                    borderBottomColor: `${BOOKSY_TEAL}99`,
                    caretColor: BOOKSY_TEAL,
                  }}
                  value={inputs.bookingUrl || ''}
                  onChange={e => setInputs({ ...inputs, bookingUrl: e.target.value })}
                />
                <p className="text-white/40 text-[9px] md:text-[10px] mt-1 text-center">
                  Short links like yourshop.booksy.com work too — we resolve them.
                </p>
              </div>

              {scrapeError && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px] md:text-[12px]"
                  style={{
                    border: '1px solid rgba(248,113,113,0.4)',
                    background: 'rgba(248,113,113,0.08)',
                    color: '#fecaca',
                  }}
                >
                  {scrapeError}
                </div>
              )}

              <button
                type="submit"
                disabled={scraping}
                className="w-full py-4 md:py-5 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98] disabled:opacity-60"
              >
                Generate My Barbershop Website
              </button>
            </form>
          </div>
        </div>
      ) : (
      <div className="w-full grid md:grid-cols-[40%_60%] luxury-gradient relative">

        {/* Logo in the Upper Left Hand Corner */}
        <div className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-2 md:gap-3 z-20 pointer-events-none">
          <ScissorsIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100]" />
          <span className="text-[10px] md:text-sm font-montserrat font-black uppercase tracking-[2px] text-white">
            Prime<span className="text-[#f4a100]">Barber</span> AI
          </span>
        </div>

        {/* Sign In button in the Upper Right Hand Corner */}
        {onSignIn && (
          <button
            onClick={onSignIn}
            className="absolute top-6 right-6 md:top-8 md:right-8 z-20 rounded-full border border-white/30 bg-white/[0.06] px-4 py-1.5 md:px-5 md:py-2 text-[14px] md:text-[17px] font-montserrat font-black uppercase tracking-[2px] text-white shadow-sm hover:border-white hover:bg-white/15 hover:text-[#f4a100] transition-all"
          >
            Sign In
          </button>
        )}

        {/* Left Side: Main Headline Section — tightened vertical padding
            on mobile so the headline + subhead don't push the inputs
            below the fold. Removed the marketing "AI-crafted luxury
            layouts ..." line and the orange divider — the italic
            instruction subhead carries enough weight on its own. */}
        <div className="px-6 pt-10 pb-4 md:p-16 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-r border-white/5 relative md:min-h-screen overflow-hidden">
          {/* Premium barbershop background */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            }}
            aria-hidden="true"
          />
          {/* Darkening overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/70 to-black/85" aria-hidden="true" />
          <div className="relative z-10 pt-4 md:pt-0 mx-auto max-w-2xl">
            {booksyMode ? (
              <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-2 md:mb-4 text-center">
                Generate Your <span style={{ color: '#f4a100' }}>FREE</span> <br className="hidden md:block"/>
                Barber Website From <br className="hidden md:block"/>
                Your <span style={{ color: BOOKSY_TEAL }}>Booksy</span> Link
                <span className="text-[#f4a100] mt-1 block">in a Few Seconds</span>
              </h1>
            ) : (
              <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-2 md:mb-4">
                Generate Custom <br className="hidden md:block"/> Barbershop Website <br/>
                <span className="text-[#f4a100] mt-1 block">in Seconds</span>
              </h1>
            )}
            {/* Small italic serif subhead — instruction for the visitor,
                mirrors the one used on PrimeHub /barber. */}
            <p
              className="text-[11px] md:text-xs italic text-white/70 max-w-[280px] md:max-w-xs mx-auto"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              {booksyMode
                ? "Paste your Booksy link — we'll pull your services, photos, hours, and reviews automatically."
                : 'Please fill in the info below so your custom website can be generated.'}
            </p>
          </div>
        </div>

        {/* Right Side: Form — tighter vertical padding on mobile so the
            first input sits right under the headline section.
            On /booksy the form is just one input, so it gets extra
            vertical padding + a narrower max-width so the field +
            button sit visually centered with breathing room. */}
        <div className={`px-6 ${booksyMode ? 'pt-8 pb-12 md:px-16 md:py-20 lg:px-24' : 'pt-4 pb-8 md:px-16 md:py-12 lg:px-24'} bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen`}>
          <div className={`${booksyMode ? 'max-w-md' : 'max-w-xl'} w-full mx-auto`}>
            <form onSubmit={handleSubmit} className="space-y-3 md:space-y-5">
              {!booksyMode && (
                <>
                  <div className="space-y-1">
                    <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Barbershop Name</label>
                    <input
                      required
                      type="text"
                      placeholder="The Gentlemen's Lounge"
                      className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                      value={inputs.shopName}
                      onChange={e => setInputs({...inputs, shopName: e.target.value})}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Barbershop Service Area</label>
                    <input
                      required
                      type="text"
                      placeholder="Beverly Hills, CA"
                      className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                      value={inputs.area}
                      onChange={e => setInputs({...inputs, area: e.target.value})}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Phone Number</label>
                    <input
                      required
                      type="tel"
                      placeholder="+1 234 567 8900"
                      className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                      value={inputs.phone}
                      onChange={e => setInputs({...inputs, phone: e.target.value})}
                    />
                  </div>
                </>
              )}

              <div className="space-y-1">
                <div className={`flex items-center gap-2 ${booksyMode ? 'justify-center' : ''}`}>
                  <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                    {booksyMode ? (
                      <><span style={{ color: BOOKSY_TEAL }}>Booksy</span> Link</>
                    ) : (
                      'Booking Link'
                    )}
                  </label>
                  {booksyMode ? (
                    <span
                      className="text-[8px] md:text-[9px] uppercase tracking-[2px] px-1.5 py-0.5"
                      style={{ color: BOOKSY_TEAL, border: `1px solid ${BOOKSY_TEAL}66` }}
                    >
                      Required
                    </span>
                  ) : (
                    <span className="text-[8px] md:text-[9px] uppercase tracking-[2px] text-[#f4a100]/80 border border-[#f4a100]/40 px-1.5 py-0.5">Optional</span>
                  )}
                </div>
                <input
                  required={booksyMode}
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={booksyMode ? 'booksy.com/en-us/your-shop' : 'booksy.com/your-shop'}
                  className={`w-full bg-transparent border-b py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20 ${booksyMode ? 'text-center' : ''}`}
                  style={{
                    borderBottomColor: booksyMode ? `${BOOKSY_TEAL}99` : 'rgba(255,255,255,0.40)',
                    caretColor: booksyMode ? BOOKSY_TEAL : undefined,
                  }}
                  value={inputs.bookingUrl || ''}
                  onChange={e => setInputs({...inputs, bookingUrl: e.target.value})}
                />
                <p className={`text-white/40 text-[9px] md:text-[10px] mt-1 ${booksyMode ? 'text-center' : ''}`}>
                  {booksyMode
                    ? 'Short links like yourshop.booksy.com work too — we resolve them.'
                    : 'Booksy, Cal.com, Vagaro — any booking page works.'}
                </p>
              </div>

              {/* Color-theme picker — homepage only. /booksy skips this:
                  the scraped page provides everything we need, so we
                  default to the gold/black preset and move on. */}
              {!booksyMode && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                    Choose Your Colors{' '}
                    <span className="text-white/40 normal-case tracking-normal">(pick a theme)</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {THEME_PRESETS.map((t) => {
                      const selected = (inputs.colorTheme || 'goldBlack') === t.slug;
                      return (
                        <button
                          key={t.slug}
                          type="button"
                          onClick={() => setInputs({ ...inputs, colorTheme: t.slug })}
                          aria-pressed={selected}
                          className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-all ${
                            selected
                              ? 'border-white bg-white/10'
                              : 'border-white/20 bg-white/[0.03] hover:border-white/40'
                          }`}
                        >
                          <span className="relative flex shrink-0 items-center">
                            <span
                              className="h-3.5 w-3.5 rounded-full border border-white/25"
                              style={{ background: t.bg }}
                            />
                            <span
                              className="-ml-1.5 h-3.5 w-3.5 rounded-full border border-white/25"
                              style={{ background: t.accent }}
                            />
                          </span>
                          <span className="min-w-0 truncate text-[8.5px] sm:text-[9.5px] font-bold uppercase tracking-[0.08em] sm:tracking-[0.1em] text-white/90">
                            {t.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {scrapeError && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px] md:text-[12px]"
                  style={{
                    border: '1px solid rgba(248,113,113,0.4)',
                    background: 'rgba(248,113,113,0.08)',
                    color: '#fecaca',
                  }}
                >
                  {scrapeError}
                </div>
              )}

              <button
                type="submit"
                disabled={scraping}
                className="w-full py-4 md:py-5 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98] disabled:opacity-60"
              >
                {booksyMode ? 'Generate My Barbershop Website' : 'Generate My Barbershop Website'}
              </button>
            </form>

            <div className="mt-5 md:mt-8 flex items-center justify-center gap-3 md:gap-4">
              <div className="h-[1px] flex-1 bg-white/10"></div>
              <p className="text-white/30 text-[7px] md:text-[9px] uppercase tracking-[3px] md:tracking-[5px] whitespace-nowrap">
                Premium Builder • Prime Barber AI
              </p>
              <div className="h-[1px] flex-1 bg-white/10"></div>
            </div>
            <p className="mt-3 md:mt-4 text-center text-white/65 text-[12px] md:text-[14px] font-bold">
              Support: <a href="mailto:support@davoxa.com" className="text-white hover:text-[#f4a100] transition-colors font-bold">support@davoxa.com</a>
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
};
