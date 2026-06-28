import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { ShopInputs, WebsiteData } from '../types';
import { extractFirstUrl } from '../lib/supportedBookingHost';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';

// Visual system shared with NewLeadQuizForm (the homepage). Same hero
// image + same Manrope/Instrument Serif type stack + same accent halo +
// same glass card so /booksy reads as part of the same product instead
// of an alternate-flow detour. Hero proxied through images.weserv.nl
// for on-the-fly resize + WebP since the raw blob is a 4MB+ phone JPG.
const HERO_BLOB = 'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/nate-johnston-tgPrIYnW3g4-unsplash.jpg';
const HERO_IMAGE = `https://images.weserv.nl/?url=${encodeURIComponent(HERO_BLOB.replace(/^https?:\/\//, ''))}&w=1600&q=70&output=webp`;
const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';
const ACCENT = '#f4a100';

// Brand-color picker swatches (6 presets + any-color wheel) — the picked
// hex rides on the generated site's colorTheme so the renderer recolors it.
const COLOR_SWATCHES = ['#f4a100', '#ffffff', '#dc2626', '#22c55e', '#3b82f6', '#a855f7'];
const COLOR_WHEEL = 'conic-gradient(from 0deg, #f4a100, #dc2626, #a855f7, #3b82f6, #22c55e, #f4a100)';

interface Props {
  // Called with the prepared inputs once the scrape resolves. Mirrors
  // the homepage GeneratorForm contract so App.tsx can route the user
  // into the same loading → editor flow without branching.
  onGenerate: (inputs: ShopInputs, scraped: WebsiteData) => void;
  onSignIn?: () => void;
  // Which generated-site design the scrape result is stamped with.
  // Defaults to 'luxe' (Design 1) so the public /booksy flow is
  // unchanged; the admin generator passes 'prime' (Design 2) when the
  // operator picks it, so admin-built sites deploy with the chosen design.
  template?: 'luxe' | 'prime';
}

// Step labels for the scrape loading screen. The scrape itself is one
// blocking fetch (no streaming), so progress is timed against typical
// 20-40s wall-clock — not real per-step events. We snap to 100% the
// moment the fetch resolves.
const LOADING_STEPS = [
  { pct: 18, label: 'Fetching your shop info…' },
  { pct: 42, label: 'Pulling services & pricing…' },
  { pct: 66, label: 'Loading photos & reviews…' },
  { pct: 88, label: 'Building your custom website…' },
];

// Single-input generator for /booksy. The visitor pastes a Booksy URL,
// we hand it to /api/import-scrape, and the returned rich data pre-fills
// the LUXE renderer (shopName, area, services, gallery, reviews, bio,
// hours, staff, aggregate rating).
export const BooksyGeneratorForm: React.FC<Props> = ({ onGenerate, onSignIn, template = 'luxe' }) => {
  const [url, setUrl] = useState('');
  const [brandColor, setBrandColor] = useState('#f4a100');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const stepTimerRef = useRef<number | null>(null);

  // Drive the fake step ladder while the scrape is in flight. We hold
  // at the LAST step's pct (88) if the scrape takes longer than the
  // ladder; the moment the fetch resolves we snap to 100 and unmount.
  useEffect(() => {
    if (!busy) {
      setStepIdx(0);
      setProgress(0);
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
      return;
    }
    const startedAt = Date.now();
    // Roughly 7s per step → ladder reaches 88% around 28s, then holds.
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

    // Pull a usable URL out of whatever was pasted — a bare host
    // ("yourshop.booksy.com"), a full https link, or a blob of share text
    // with the link buried in it — and prepend https:// when missing. This
    // is what the previous /booksy flow did; without it bare/short links
    // (which the hint below promises to resolve) fail to scrape.
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

      // Diagnostic — surfaces in browser DevTools so we can tell at a
      // glance whether the gallery being empty is a scraper miss or a
      // renderer bug. Counts only; full URLs would flood the console.
      console.log('[Booksy Scrape] platform=%s photos=%d services=%d reviews=%d staff=%d bio=%s hours=%d',
        data._platform || '?',
        (data.photos || []).length,
        (data.services || []).length,
        (data.reviews || []).length,
        (data.staff || []).length,
        data.description ? 'yes' : 'no',
        (data.hours || []).length,
      );

      // Snap the progress to 100 before handing off — gives the loading
      // screen a satisfying "complete" beat instead of an abrupt cut.
      setProgress(100);
      setStepIdx(LOADING_STEPS.length - 1);
      await new Promise((r) => setTimeout(r, 350));

      // Use the shared builder — the SAME proven mapping the homepage and
      // the previous /booksy overlay used — so identity defaults (e.g. a
      // missing shop name) are filled safely and behaviour matches exactly.
      // The picked brand color rides through manual.colorTheme.
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
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: '#05070A', fontFamily: SANS, color: 'white' }}
    >
      {/* Static barbershop hero — same image, brightness, and dual-
          layer (radial halo + linear darken) gradient stack as the
          homepage NewLeadQuizForm so the two pages feel identical. */}
      <div className="absolute inset-0 z-0">
        <img
          src={HERO_IMAGE}
          alt=""
          loading="eager"
          // @ts-ignore - fetchpriority is valid HTML but not in React types yet
          fetchpriority="high"
          decoding="async"
          className="h-full w-full object-cover"
          style={{ filter: 'brightness(0.7) saturate(1.05)' }}
          aria-hidden="true"
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (img.src !== HERO_BLOB) img.src = HERO_BLOB;
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 80% at 50% 0%, rgba(244,161,0,0.10), transparent 65%),' +
              'linear-gradient(180deg, rgba(5,7,10,0.25) 0%, rgba(5,7,10,0.55) 60%, rgba(5,7,10,0.78) 100%)',
          }}
        />
      </div>

      {/* Top bar — gold "B" badge + aibarber.org wordmark, matching
          the homepage exactly. */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4 md:px-10 md:py-6">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold italic text-black"
            style={{ background: ACCENT, fontFamily: SERIF }}
          >
            B
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/85">
            aibarber<span style={{ color: ACCENT }}>.org</span>
          </span>
        </div>
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-full border border-white/30 bg-white/[0.06] px-4 py-1.5 text-[13px] font-black uppercase tracking-[0.18em] text-white shadow-sm transition-all hover:border-white hover:bg-white/15 md:px-5 md:py-2 md:text-[15px]"
          >
            Sign In
          </button>
        )}
      </header>

      {/* Headline + glass form card — same headline construction as
          homepage (Manrope semibold body + Instrument Serif italic
          gold emphasis on the final word). */}
      <main className="relative z-10 mx-auto flex max-w-2xl flex-col items-center px-5 pb-16 pt-6 text-center md:pt-12">
        <p
          className="mb-3 text-[10px] font-bold uppercase tracking-[0.32em] md:text-[11px]"
          style={{ color: ACCENT }}
        >
          aibarber.org
        </p>
        <h1
          className="leading-[1.05] tracking-tight text-white"
          style={{
            fontSize: 'clamp(2rem, 5vw, 3.2rem)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
          }}
        >
          Generate your barber website <br className="hidden sm:inline" />
          from your booking link{' '}
          <span
            className="italic"
            style={{ fontFamily: SERIF, fontWeight: 400, color: ACCENT }}
          >
            in a few seconds
          </span>.
        </h1>
        <p
          className="mx-auto mt-4 max-w-md text-[13px] italic text-white/65 md:text-[14px]"
          style={{ fontFamily: SERIF }}
        >
          Paste your Booksy, Fresha, Square, Vagaro, or StyleSeat link — we'll pull your services, photos, hours, and reviews automatically.
        </p>

        {/* Glass form card — identical surface treatment to homepage:
            gradient background, accent-tinted ring, inset highlight,
            radial halo glow across the top edge. */}
        <div
          className="relative mt-8 w-full overflow-hidden rounded-2xl border border-white/10 p-5 text-left md:mt-10 md:p-7"
          style={{
            background:
              'linear-gradient(180deg, rgba(10, 14, 22, 0.78), rgba(10, 14, 22, 0.86))',
            boxShadow:
              '0 24px 80px -12px rgba(0,0,0,0.6),' +
              'inset 0 1px 0 0 rgba(255,255,255,0.08),' +
              `0 0 0 1px ${ACCENT}1f`,
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{ background: `radial-gradient(60% 100% at 50% 0%, ${ACCENT}22, transparent 70%)` }}
          />

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-lg font-bold leading-snug text-white md:text-xl">
                Insert your barber booking link
              </label>
              <input
                required
                type="text"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Booksy, theCut, Fresha, Square, StyleSeat, Vagaro or Goldie link"
                className="w-full border-b border-white/15 bg-transparent px-0 py-2.5 text-base text-white placeholder:text-white/25 transition-colors focus:border-white/45 focus:outline-none md:text-lg"
                style={{ caretColor: ACCENT }}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p
                className="pt-1 text-[11px] italic md:text-[12px]"
                style={{ color: ACCENT, fontFamily: SERIF }}
              >
                Short links work too — we'll resolve them.
              </p>
            </div>

            {/* Brand color — picked hex rides onto the generated site. */}
            <div className="space-y-2">
              <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-white/55">
                Brand color <span className="normal-case tracking-normal text-white/40">(pick any color)</span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {COLOR_SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBrandColor(c)}
                    aria-label={`Use color ${c}`}
                    className="h-7 w-7 rounded-full transition"
                    style={{
                      background: c,
                      boxShadow: brandColor.toLowerCase() === c.toLowerCase()
                        ? '0 0 0 2px #05070A, 0 0 0 4px ' + ACCENT
                        : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                    }}
                  />
                ))}
                <label
                  className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full"
                  title="Pick any color"
                  style={{ background: COLOR_WHEEL, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}
                >
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : '#888888'}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="absolute -inset-2 cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="submit"
                disabled={busy}
                className="group flex items-center gap-2 rounded-full bg-white px-7 py-3 text-[12px] font-bold uppercase tracking-widest text-black shadow-xl shadow-black/40 transition-all hover:bg-gray-100 active:scale-[0.98] disabled:opacity-50 md:px-9 md:py-3.5 md:text-[13px]"
              >
                {busy ? 'Building your site…' : (
                  <>
                    Generate My Site
                    <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        <p className="mt-4 text-[10px] uppercase tracking-[0.22em] text-white/40">
          Sharp · Considered · Made for the work
        </p>

        <p className="mt-5 text-center text-[13px] font-bold text-white/65 md:text-[14px]">
          Support:{' '}
          <a
            href="mailto:support@davoxa.com"
            className="font-bold text-white/95 transition-colors hover:text-white"
          >
            support@davoxa.com
          </a>
        </p>
      </main>

      {/* Scrape-in-progress overlay — replaces the previous flat
          fullscreen loader with the same dark glass + gold halo
          treatment as the form card. Step ladder is timed against
          typical 20-40s wall-clock since the scrape is one fetch. */}
      {busy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: 'rgba(5,7,10,0.82)', backdropFilter: 'blur(14px)' }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 p-7 text-center md:p-9"
            style={{
              background:
                'linear-gradient(180deg, rgba(10, 14, 22, 0.92), rgba(10, 14, 22, 0.96))',
              boxShadow:
                '0 24px 80px -12px rgba(0,0,0,0.7),' +
                'inset 0 1px 0 0 rgba(255,255,255,0.08),' +
                `0 0 0 1px ${ACCENT}26`,
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-32"
              style={{ background: `radial-gradient(60% 100% at 50% 0%, ${ACCENT}33, transparent 70%)` }}
            />

            <div className="relative flex items-center justify-center gap-2 mb-7">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold italic text-black"
                style={{ background: ACCENT, fontFamily: SERIF }}
              >
                B
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85">
                aibarber<span style={{ color: ACCENT }}>.org</span>
              </span>
            </div>

            <h2
              className="relative mb-8 text-white leading-tight"
              style={{ fontFamily: SERIF, fontSize: '1.9rem', fontWeight: 400, fontStyle: 'italic' }}
            >
              Crafting your <span style={{ color: ACCENT }}>website</span>
            </h2>

            <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/10 mb-6">
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${ACCENT}, #ffffff, ${ACCENT})`,
                  backgroundSize: '200% 100%',
                  animation: 'booksyShimmer 1.4s linear infinite',
                  boxShadow: `0 0 12px ${ACCENT}99`,
                }}
              />
              <style>{`
                @keyframes booksyShimmer {
                  0% { background-position: 200% 0; }
                  100% { background-position: -200% 0; }
                }
              `}</style>
            </div>

            <ul className="relative space-y-3 text-left">
              {LOADING_STEPS.map((step, i) => {
                const done = i < stepIdx || progress >= 100;
                const active = i === stepIdx && progress < 100;
                return (
                  <li
                    key={step.label}
                    className={`flex items-center gap-3 text-[12px] tracking-[1.5px] uppercase ${
                      done ? 'text-white/60' : active ? 'text-white font-bold' : 'text-white/25'
                    }`}
                  >
                    <span
                      className={`inline-block w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                        done
                          ? 'text-black'
                          : active
                            ? 'text-[#f4a100] animate-pulse'
                            : 'text-white/25'
                      }`}
                      style={{
                        background: done ? ACCENT : 'transparent',
                        border: done ? `1px solid ${ACCENT}` : active ? `1px solid ${ACCENT}` : '1px solid rgba(255,255,255,0.2)',
                      }}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    {step.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
