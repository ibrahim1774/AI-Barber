import React, { useEffect, useRef, useState } from 'react';
import { ShopInputs, WebsiteData } from '../types';
import { ScissorsIcon } from './Icons';
import { extractFirstUrl } from '../lib/supportedBookingHost';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
import { BrandSwatchGrid } from './BrandSwatchGrid';
import { DEFAULT_SWATCH } from '../lib/brandSwatches';

// Single-input generator for /booksy — styled to match the homepage
// (GeneratorForm) exactly: same two-column shell (barber hero on the left,
// dark form on the right), the AIBarber scissors logo, condensed-uppercase
// Montserrat headline, underline inputs, the shared BrandSwatchGrid, the gold
// CTA, and the "Premium Builder • AIBarber" footer. The only difference from
// the homepage is the form body: one booking-link field, scraped via
// /api/import-scrape, that pre-fills the LUXE renderer.
const ACCENT = '#f4a100';

interface Props {
  // Called with the prepared inputs once the scrape resolves. Mirrors the
  // homepage GeneratorForm contract so the caller routes the user into the
  // same editor flow without branching.
  onGenerate: (inputs: ShopInputs, scraped: WebsiteData) => void;
  onSignIn?: () => void;
  // Which generated-site design the scrape result is stamped with. Defaults to
  // 'luxe' (Design 1); the admin generator passes 'prime' (Design 2).
  template?: 'luxe' | 'prime';
}

// Step labels for the scrape loading overlay — timed against a typical
// 20-40s wall-clock (the scrape is one blocking fetch). We snap to 100% the
// moment the fetch resolves. Same ladder + copy as the homepage auto-scrape.
const LOADING_STEPS = [
  { pct: 18, label: 'Fetching your shop info…' },
  { pct: 42, label: 'Loading photos & services…' },
  { pct: 66, label: 'Pulling reviews & hours…' },
  { pct: 88, label: 'Building your custom site…' },
];

export const BooksyGeneratorForm: React.FC<Props> = ({ onGenerate, onSignIn, template = 'luxe' }) => {
  const [url, setUrl] = useState('');
  const [brandColor, setBrandColor] = useState<string>(DEFAULT_SWATCH);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const stepTimerRef = useRef<number | null>(null);

  // Drive the fake step ladder while the scrape is in flight. Holds at the
  // last step's pct if the scrape runs longer than the ladder; the fetch
  // resolving snaps it to 100.
  useEffect(() => {
    if (!busy) {
      setStepIdx(0);
      setProgress(0);
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
      return;
    }
    const startedAt = Date.now();
    stepTimerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const idx = Math.min(LOADING_STEPS.length - 1, Math.floor(elapsed / 7));
      const target = LOADING_STEPS[idx].pct;
      setStepIdx(idx);
      setProgress((p) => (p < target ? Math.min(target, p + 0.7) : p));
    }, 120) as unknown as number;
    return () => {
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
    };
  }, [busy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);

    // Pull a usable URL out of whatever was pasted — a bare host, a full
    // https link, or a blob of share text with the link buried in it — and
    // prepend https:// when missing.
    const cleanUrl = extractFirstUrl(url) ?? url.trim();

    try {
      const resp = await fetch('/api/import-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Scrape failed');
      }

      // Diagnostic — surfaces in DevTools so an empty gallery is easy to
      // triage as a scraper miss vs. a renderer bug. Counts only.
      console.log('[Booksy Scrape] platform=%s photos=%d services=%d reviews=%d staff=%d bio=%s hours=%d',
        data._platform || '?',
        (data.photos || []).length,
        (data.services || []).length,
        (data.reviews || []).length,
        (data.staff || []).length,
        data.description ? 'yes' : 'no',
        (data.hours || []).length,
      );

      // Snap to 100 before handing off — a satisfying "complete" beat.
      setProgress(100);
      setStepIdx(LOADING_STEPS.length - 1);
      await new Promise((r) => setTimeout(r, 350));

      // Shared builder — same proven mapping the homepage uses. The picked
      // brand color rides through manual.colorTheme.
      const { inputs, scraped } = buildSiteFromScrape(data, cleanUrl, {
        manual: { colorTheme: brandColor },
        template,
      });

      onGenerate(inputs, scraped);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="md:min-h-screen bg-[#0d0d0d] flex items-start md:items-stretch overflow-x-hidden">
      {/* Scrape-in-progress overlay — same dark-glass + gold-halo treatment
          and step ladder as the homepage auto-scrape. */}
      {busy && (
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
              Pulling from your <span style={{ color: ACCENT }}>booking page</span>
            </h2>
            <div className="relative mb-6 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
              <div className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #f4a100, #ffffff, #f4a100)',
                  backgroundSize: '200% 100%',
                  animation: 'booksyScrapeShimmer 1.4s linear infinite',
                  boxShadow: '0 0 12px rgba(244,161,0,0.6)',
                }}
              />
              <style>{`@keyframes booksyScrapeShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
            </div>
            <ul className="relative space-y-3 text-left">
              {LOADING_STEPS.map((s, i) => {
                const done = i < stepIdx || progress >= 100;
                const active = i === stepIdx && progress < 100;
                return (
                  <li key={s.label}
                    className={`flex items-center gap-3 text-[12px] tracking-[1.5px] uppercase ${
                      done ? 'text-white/60' : active ? 'text-white font-bold' : 'text-white/25'
                    }`}
                  >
                    <span
                      className="inline-block w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                      style={{
                        background: done ? ACCENT : 'transparent',
                        border: `1px solid ${done || active ? ACCENT : 'rgba(255,255,255,0.2)'}`,
                        color: done ? '#000' : active ? ACCENT : 'rgba(255,255,255,0.25)',
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

      <div className="w-full grid md:grid-cols-[40%_60%] luxury-gradient relative">
        {/* Logo (top-left) — identical to the homepage */}
        <div className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-2 md:gap-3 z-20 pointer-events-none">
          <ScissorsIcon className="w-6 h-6 md:w-7 md:h-7 text-[#f4a100]" />
          <span className="text-[15px] md:text-[18px] font-montserrat font-black uppercase tracking-[2px] text-white">
            AI<span className="text-[#f4a100]">Barber</span>
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

        {/* Left: hero image + headline (same shell/typography as homepage) */}
        <div className="px-6 pt-10 pb-4 md:p-16 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-r border-white/5 relative md:min-h-screen overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/70 to-black/85" aria-hidden="true" />
          <div className="relative z-10 pt-4 md:pt-0 mt-[8vh] md:mt-[10vh] mx-auto max-w-2xl">
            <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-2 md:mb-4 text-center">
              Generate Your Barber Website <br className="hidden md:block"/>
              From Your Booking Link
              <span className="text-[#f4a100] mt-1 block">in a Few Seconds</span>
            </h1>
            <p
              className="text-[11px] md:text-xs italic text-white/70 max-w-[280px] md:max-w-xs mx-auto"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Paste your Booksy, Fresha, Square, Vagaro, StyleSeat or Setmore link — we&apos;ll pull your services, photos, hours, and reviews automatically.
            </p>
          </div>
        </div>

        {/* Right: single booking-link form (same dark surface + styling) */}
        <div className="px-6 pt-8 pb-12 md:px-16 md:py-20 lg:px-24 bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen">
          <div className="max-w-md w-full mx-auto">
            <form onSubmit={handleSubmit} className="space-y-3 md:space-y-5">
              <div className="space-y-1">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                  Booking Link
                </label>
                <input
                  required
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="Booksy, theCut, Fresha, Square, StyleSeat, Vagaro, Goldie or Setmore link"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-white/40 text-[9px] md:text-[10px] mt-1">
                  Booksy, theCut, Fresha, Square, StyleSeat, Vagaro, Goldie &amp; Setmore all work — short links too.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                  Choose Your Colors{' '}
                  <span className="text-white/40 normal-case tracking-normal">(pick a theme)</span>
                </label>
                <BrandSwatchGrid
                  current={brandColor}
                  onPick={(hex) => setBrandColor(hex)}
                  columns={6}
                  size="md"
                  className="mx-auto max-w-xs"
                />
              </div>

              {error && (
                <div
                  className="rounded-lg px-3 py-2 text-[11px] md:text-[12px]"
                  style={{
                    border: '1px solid rgba(248,113,113,0.4)',
                    background: 'rgba(248,113,113,0.08)',
                    color: '#fecaca',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-4 md:py-5 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98] disabled:opacity-60"
              >
                Generate My Barbershop Website
              </button>
            </form>

            <div className="mt-5 md:mt-8 flex items-center justify-center gap-3 md:gap-4">
              <div className="h-[1px] flex-1 bg-white/10"></div>
              <p className="text-white/30 text-[7px] md:text-[9px] uppercase tracking-[3px] md:tracking-[5px] whitespace-nowrap">
                Premium Builder • AIBarber
              </p>
              <div className="h-[1px] flex-1 bg-white/10"></div>
            </div>
            <p className="mt-3 md:mt-4 text-center text-white/65 text-[12px] md:text-[14px] font-bold">
              Support: <a href="mailto:support@davoxa.com" className="text-white hover:text-[#f4a100] transition-colors font-bold">support@davoxa.com</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
