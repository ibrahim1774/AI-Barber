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

// Sample links the input's placeholder "types" while the field is empty —
// cycles through the supported platforms so visitors instantly get what to
// paste. Reduced-motion users get the static placeholder instead.
const PLACEHOLDER_SAMPLES = [
  'booksy.com/en-us/mikes-barbershop',
  'thecut.co/barbers/mike-the-barber',
  'fresha.com/a/fade-factory',
  'squareup.com/appointments/fadefactory',
  'styleseat.com/m/v/mikethebarber',
  'vagaro.com/mikesbarbershop',
];
const PLACEHOLDER_STATIC =
  'Booksy, theCut, Fresha, Square, StyleSeat, Vagaro, Goldie or Setmore link';

function useTypingPlaceholder(): string {
  const [text, setText] = useState('');
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setText(PLACEHOLDER_STATIC);
      return;
    }
    let sample = 0;
    let pos = 0;
    let deleting = false;
    let timer: number;
    const tick = () => {
      const full = PLACEHOLDER_SAMPLES[sample];
      if (!deleting) {
        pos++;
        setText(full.slice(0, pos));
        if (pos >= full.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1700); // hold the finished link
        } else {
          timer = window.setTimeout(tick, 42 + Math.random() * 40);
        }
      } else {
        pos -= 3;
        setText(full.slice(0, Math.max(0, pos)));
        if (pos <= 0) {
          deleting = false;
          pos = 0;
          sample = (sample + 1) % PLACEHOLDER_SAMPLES.length;
          timer = window.setTimeout(tick, 500);
        } else {
          timer = window.setTimeout(tick, 18);
        }
      }
    };
    timer = window.setTimeout(tick, 900);
    return () => window.clearTimeout(timer);
  }, []);
  return text;
}

export const BooksyGeneratorForm: React.FC<Props> = ({ onGenerate, onSignIn, template = 'luxe' }) => {
  const [url, setUrl] = useState('');
  const typingPlaceholder = useTypingPlaceholder();
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

        {/* Left: hero image + headline — cinematic pass: slow Ken Burns
            drift, film grain, deeper vignette, inset gold hairline frame,
            staggered line reveals. Copy identical. */}
        <div className="px-6 pt-10 pb-4 md:p-16 flex flex-col justify-center items-center text-center border-b md:border-b-0 relative md:min-h-screen overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center booksy-lux-kenburns"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/70 to-black/85" aria-hidden="true" />
          <div className="absolute inset-0 booksy-lux-vignette" aria-hidden="true" />
          <div className="absolute inset-0 booksy-lux-grain" aria-hidden="true" />
          <div
            className="pointer-events-none absolute inset-3 md:inset-5 border border-[#f4a100]/25 booksy-lux-frame"
            aria-hidden="true"
          />
          <div className="relative z-10 pt-4 md:pt-0 mt-[8vh] md:mt-[10vh] mx-auto max-w-2xl">
            <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-2 md:mb-4 text-center">
              <span className="booksy-lux-line" style={{ animationDelay: '0.1s' }}>Generate Your Barber Website </span><br className="hidden md:block"/>
              <span className="booksy-lux-line" style={{ animationDelay: '0.22s' }}>From Your Booking Link</span>
              <span className="text-[#f4a100] mt-1 block booksy-lux-line" style={{ animationDelay: '0.34s' }}>in a Few Seconds</span>
            </h1>
            <p
              className="text-[11px] md:text-xs italic text-white/70 max-w-[280px] md:max-w-xs mx-auto booksy-lux-line"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif', animationDelay: '0.48s' }}
            >
              Paste your Booksy, Fresha, Square, Vagaro, StyleSeat or Setmore link — we&apos;ll pull your services, photos, hours, and reviews automatically.
            </p>
          </div>
        </div>

        {/* Barber-pole seam — the page's one thematic signature: a slim
            gold/white diagonal stripe drifting slowly downward between the
            two columns (horizontal hairline on mobile). */}
        <div className="booksy-lux-pole" aria-hidden="true" />

        {/* Right: single booking-link form (same dark surface + styling) */}
        <div className="px-6 pt-8 pb-12 md:px-16 md:py-20 lg:px-24 bg-[#0d0d0d] booksy-lux-grain-panel flex flex-col justify-center md:min-h-screen">
          <div className="max-w-md w-full mx-auto booksy-lux-form">
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
                  placeholder={typingPlaceholder}
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
                className="booksy-lux-cta w-full py-4 md:py-5 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_28px_rgba(244,161,0,0.28)] active:scale-[0.98] disabled:opacity-60"
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

      {/* Premium-pass styles — scoped by booksy-lux-* class names. */}
      <style>{`
        @keyframes booksyLuxKenburns {
          0% { transform: scale(1.02) translateY(0); }
          100% { transform: scale(1.1) translateY(-1.6%); }
        }
        .booksy-lux-kenburns {
          animation: booksyLuxKenburns 26s ease-in-out infinite alternate;
          will-change: transform;
        }
        .booksy-lux-vignette {
          background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%);
        }
        .booksy-lux-grain,
        .booksy-lux-grain-panel::before {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
          opacity: 0.05;
          mix-blend-mode: overlay;
        }
        .booksy-lux-grain-panel { position: relative; }
        .booksy-lux-grain-panel::before {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .booksy-lux-frame {
          box-shadow: inset 0 0 42px rgba(0,0,0,0.5);
        }
        .booksy-lux-line {
          display: inline-block;
          opacity: 0;
          transform: translateY(14px);
          animation: booksyLuxRise 0.85s cubic-bezier(0.19, 1, 0.22, 1) forwards;
        }
        h1 .booksy-lux-line.block, .booksy-lux-line.block { display: block; }
        @keyframes booksyLuxRise {
          to { opacity: 1; transform: translateY(0); }
        }
        .booksy-lux-form { animation: booksyLuxRise 0.9s cubic-bezier(0.19,1,0.22,1) 0.5s both; }
        .booksy-lux-pole {
          position: relative;
          height: 4px;
          width: 100%;
          background: repeating-linear-gradient(
            135deg,
            #f4a100 0 14px,
            #0d0d0d 14px 22px,
            rgba(255,255,255,0.85) 22px 30px,
            #0d0d0d 30px 38px
          );
          background-size: 200% 100%;
          animation: booksyLuxPoleH 14s linear infinite;
          opacity: 0.85;
        }
        @keyframes booksyLuxPoleH { to { background-position: -54px 0; } }
        @media (min-width: 768px) {
          .booksy-lux-pole {
            position: absolute;
            left: 40%;
            top: 0;
            bottom: 0;
            height: auto;
            width: 4px;
            transform: translateX(-50%);
            z-index: 10;
            background: repeating-linear-gradient(
              135deg,
              #f4a100 0 14px,
              #0d0d0d 14px 22px,
              rgba(255,255,255,0.85) 22px 30px,
              #0d0d0d 30px 38px
            );
            animation: booksyLuxPoleV 14s linear infinite;
            box-shadow: 0 0 18px rgba(244,161,0,0.25);
          }
          @keyframes booksyLuxPoleV { to { background-position: 0 54px; } }
        }
        .booksy-lux-cta { position: relative; overflow: hidden; }
        .booksy-lux-cta::after {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: -80%;
          width: 60%;
          background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.55) 50%, transparent 80%);
          transform: skewX(-18deg);
          animation: booksyLuxSheen 3.6s ease-in-out 1.6s infinite;
          pointer-events: none;
        }
        @keyframes booksyLuxSheen {
          0% { left: -80%; }
          46% { left: 130%; }
          100% { left: 130%; }
        }
        input:focus {
          box-shadow: 0 12px 24px -18px rgba(244,161,0,0.7);
        }
        @media (prefers-reduced-motion: reduce) {
          .booksy-lux-kenburns,
          .booksy-lux-pole,
          .booksy-lux-cta::after { animation: none; }
          .booksy-lux-line, .booksy-lux-form { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
};
