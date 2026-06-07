import React, { useEffect, useRef, useState } from 'react';
import { ShopInputs, WebsiteData } from '../types';
import { ArrowRight } from 'lucide-react';
import { isFreeBarberPath } from '../lib/dealMode.ts';
import { isSupportedBookingHost } from '../lib/supportedBookingHost.ts';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape.ts';

// /new — premium multi-step quiz form mirroring PrimeHub /barber.
// Same fields as the existing GeneratorForm (shopName, area, phone,
// bookingUrl, colorTheme) but presented one question at a time on a
// glass card with Manrope + Instrument Serif type and a Pexels hero
// video behind everything. Submits via the same `onGenerate` callback
// the existing form uses so the downstream pipeline is unchanged.

interface Props {
  // Optional `scraped` second arg lets the quiz pass a pre-filled
  // WebsiteData payload when the visitor pasted a supported booking
  // link (Booksy / Fresha / Square / Vagaro / StyleSeat). App.tsx
  // hands it straight through to handleGenerate's `prebuilt` arg,
  // skipping the Gemini template call. Same contract /booksy uses.
  onGenerate: (inputs: ShopInputs, scraped?: WebsiteData) => void;
  onSignIn?: () => void;
}

const THEME_PRESETS: { slug: string; label: string; bg: string; accent: string }[] = [
  { slug: 'goldBlack',   label: 'Gold & Black',   bg: '#000000', accent: '#f4a100' },
  { slug: 'blackWhite',  label: 'Black & White',  bg: '#000000', accent: '#f5f5f5' },
  { slug: 'redBlack',    label: 'Red & Black',    bg: '#000000', accent: '#dc2626' },
  { slug: 'purpleGreen', label: 'Purple & Green', bg: '#160328', accent: '#22c55e' },
];

const ACCENT_BY_SLUG: Record<string, string> = THEME_PRESETS.reduce(
  (acc, p) => ((acc[p.slug] = p.accent), acc),
  {} as Record<string, string>,
);

type QuizField = 'shopName' | 'area' | 'phone' | 'bookingUrl';
interface StepDef {
  field: QuizField;
  label: React.ReactNode;
  placeholder: string;
  hint?: string;
  optional?: boolean;
  inputType?: 'text' | 'tel';
  autoCapitalize?: 'off' | 'on';
}

const STEPS: StepDef[] = [
  { field: 'shopName', label: 'What is your barbershop name?', placeholder: "The Gentlemen's Lounge" },
  { field: 'area',     label: 'What area is your barbershop in?', placeholder: 'e.g. Dallas, TX' },
  { field: 'phone',    label: 'What barbershop number should appear on your site?', placeholder: '(555) 000-0000', inputType: 'tel' },
  {
    field: 'bookingUrl',
    label: <>Add your booking link <span className="font-bold text-white/55">(optional)</span></>,
    placeholder: 'booksy.com/the-curve',
    hint: 'e.g., booksy.com/the-curve — leave blank to use your phone number.',
    optional: true,
    autoCapitalize: 'off',
  },
];

// Static barbershop hero image — the looping Pexels video was
// chewing CPU/GPU on desktop. The image alone reads the same mood
// without the compositor cost.
const HERO_IMAGE = 'https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/nate-johnston-tgPrIYnW3g4-unsplash.jpg';

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';

const normalizeBookingUrl = (raw: string): string | undefined => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

export const NewLeadQuizForm: React.FC<Props> = ({ onGenerate, onSignIn }) => {
  // /free-barber swaps the headline to emphasize "free website" — the
  // pricing flow is still the $5/mo five-deal (inherited from
  // isFiveDealPath matching both /5 and /free-barber).
  const freeBarberMode = React.useMemo(() => isFreeBarberPath(), []);
  const [inputs, setInputs] = useState<ShopInputs>({
    shopName: '',
    area: '',
    phone: '',
    template: 'luxe',
    bookingUrl: '',
    colorTheme: 'goldBlack',
  });
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Scrape progress UI — only shown when the visitor's bookingUrl is
  // a supported platform. Mirrors the Booksy form's step ladder.
  const [scraping, setScraping] = useState(false);
  const [scrapeStepIdx, setScrapeStepIdx] = useState(0);
  const [scrapeProgress, setScrapeProgress] = useState(0);
  const scrapeTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const accent = ACCENT_BY_SLUG[inputs.colorTheme || 'goldBlack'] || '#f4a100';

  // Autofocus the input every time the step changes — feels native on
  // desktop, no-op on iOS Safari which blocks programmatic focus.
  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const current = STEPS[step];
  const total = STEPS.length;
  const fieldVal = (inputs[current.field] as string) || '';
  const isLast = step === total - 1;

  // Progress bar parks the shimmer at 75% of the FULL bar — matches the
  // PrimeHub /barber implementation so the two products feel identical.
  const SHIMMER_PCT = 75;

  // Booksy-style step ladder while the scrape is in flight (only shown
  // when the pasted bookingUrl is a supported platform). Auto-advances
  // every ~7s; snaps to 100 on resolve.
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

  const handleNext = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current.optional && !fieldVal.trim()) return;
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }

    const normalizedUrl = normalizeBookingUrl(inputs.bookingUrl || '');

    // Auto-scrape path: visitor pasted a supported booking link. Run
    // the same /api/import-scrape pipeline /booksy uses, merge with
    // typed identity (manual wins), hand a prebuilt WebsiteData to App
    // so the Gemini call is skipped and the site renders with real
    // photos, services, hours, reviews.
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
        setSubmitting(true);
        onGenerate(builtInputs, scraped);
        return;
      } catch (err) {
        // Silent fallback — scrape failed (404, timeout, schema
        // mismatch). Drop to the manual flow with the visitor's typed
        // fields. They still get a site; we just lose the auto-fill.
        console.warn('[Auto-scrape] Falling back to manual generation:', err);
        setScraping(false);
      }
    }

    // Manual-only path: no URL, unsupported platform, or scrape fell
    // back. Original behavior — single onGenerate call, no second arg.
    setSubmitting(true);
    onGenerate({
      ...inputs,
      bookingUrl: normalizedUrl,
    });
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: '#05070A', fontFamily: SANS, color: 'white' }}
    >
      {/* Auto-scrape loading overlay — only shown when the visitor's
          bookingUrl is a supported platform. Same step ladder + glass
          card as the dedicated /booksy form. */}
      {scraping && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-6"
          style={{ background: 'rgba(5,7,10,0.82)', backdropFilter: 'blur(14px)' }}
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 p-7 text-center md:p-9"
            style={{
              background: 'linear-gradient(180deg, rgba(10,14,22,0.92), rgba(10,14,22,0.96))',
              boxShadow: `0 24px 80px -12px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.08), 0 0 0 1px ${accent}33`,
            }}
          >
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32"
              style={{ background: `radial-gradient(60% 100% at 50% 0%, ${accent}33, transparent 70%)` }}
            />
            <h2 className="relative mb-6 text-white leading-tight"
              style={{ fontFamily: SERIF, fontSize: '1.9rem', fontWeight: 400, fontStyle: 'italic' }}
            >
              Pulling from your <span style={{ color: accent }}>booking page</span>
            </h2>
            <div className="relative mb-6 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
              <div className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
                style={{
                  width: `${scrapeProgress}%`,
                  background: `linear-gradient(90deg, ${accent}, #ffffff, ${accent})`,
                  backgroundSize: '200% 100%',
                  animation: 'autoScrapeShimmer 1.4s linear infinite',
                  boxShadow: `0 0 12px ${accent}99`,
                }}
              />
              <style>{`@keyframes autoScrapeShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
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
                        background: done ? accent : 'transparent',
                        border: `1px solid ${done || active ? accent : 'rgba(255,255,255,0.2)'}`,
                        color: done ? '#000' : active ? accent : 'rgba(255,255,255,0.25)',
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

      {/* Static barbershop hero — no autoplay video, keeps the page
          light + paint-cheap on desktop. */}
      <div className="absolute inset-0 z-0">
        <img
          src={HERO_IMAGE}
          alt=""
          className="h-full w-full object-cover"
          style={{ filter: 'brightness(0.7) saturate(1.05)' }}
          aria-hidden="true"
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

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4 md:px-10 md:py-6">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold italic text-black"
            style={{ background: accent, fontFamily: SERIF }}
          >
            B
          </span>
          <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/85">
            aibarber<span style={{ color: accent }}>.org</span>
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

      {/* Headline + glass form card */}
      <main className="relative z-10 mx-auto flex max-w-2xl flex-col items-center px-5 pb-16 pt-6 text-center md:pt-12">
        <p
          className="mb-3 text-[10px] font-bold uppercase tracking-[0.32em] md:text-[11px]"
          style={{ color: accent }}
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
          {freeBarberMode ? (
            <>
              Generate your{' '}
              <span
                className="italic"
                style={{
                  fontFamily: SERIF,
                  fontWeight: 700,
                  color: accent,
                  fontSize: '1.18em',
                  letterSpacing: '0.01em',
                }}
              >
                FREE
              </span>{' '}
              barbershop <br className="hidden sm:inline" />
              website in{' '}
              <span
                className="italic"
                style={{ fontFamily: SERIF, fontWeight: 400, color: accent }}
              >
                seconds.
              </span>
            </>
          ) : (
            <>
              Generate your custom <br className="hidden sm:inline" />
              barbershop website in{' '}
              <span
                className="italic"
                style={{ fontFamily: SERIF, fontWeight: 400, color: accent }}
              >
                seconds.
              </span>
            </>
          )}
        </h1>
        <p
          className="mx-auto mt-4 max-w-md text-[13px] italic text-white/65 md:text-[14px]"
          style={{ fontFamily: SERIF }}
        >
          Tell us about your shop — every detail below is used to build your custom site.
        </p>

        {/* Glass form card */}
        <div
          className="relative mt-8 w-full overflow-hidden rounded-2xl border border-white/10 p-5 text-left md:mt-10 md:p-7"
          style={{
            background:
              'linear-gradient(180deg, rgba(10, 14, 22, 0.78), rgba(10, 14, 22, 0.86))',
            boxShadow:
              '0 24px 80px -12px rgba(0,0,0,0.6),' +
              'inset 0 1px 0 0 rgba(255,255,255,0.08),' +
              `0 0 0 1px ${accent}1f`,
          }}
        >
          {/* Accent halo glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-28"
            style={{ background: `radial-gradient(60% 100% at 50% 0%, ${accent}22, transparent 70%)` }}
          />

          {/* Progress bar — matches PrimeHub's shimmer pattern: a
              static fill parked at SHIMMER_PCT with a smooth
              accent→white→accent gradient sliding continuously
              left-to-right via background-position animation. Reads
              as "loading" the whole quiz. */}
          <div className="relative mb-6 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${SHIMMER_PCT}%`,
                background: `linear-gradient(90deg, ${accent}, #ffffff, ${accent})`,
                backgroundSize: '200% 100%',
                animation: 'quizShimmer 1.4s linear infinite',
              }}
            />
            <style>{`
              @keyframes quizShimmer {
                0%   { background-position: 200% 0; }
                100% { background-position: -200% 0; }
              }
            `}</style>
          </div>

          <form onSubmit={handleNext} className="space-y-5">
            <div className="space-y-2" key={current.field}>
              <label className="block text-lg font-bold leading-snug text-white md:text-xl">
                {current.label}
              </label>
              <input
                ref={inputRef}
                type={current.inputType || 'text'}
                required={!current.optional}
                autoCapitalize={current.autoCapitalize}
                autoCorrect={current.autoCapitalize === 'off' ? 'off' : undefined}
                spellCheck={current.autoCapitalize === 'off' ? false : undefined}
                placeholder={current.placeholder}
                value={fieldVal}
                onChange={(e) => setInputs({ ...inputs, [current.field]: e.target.value })}
                className="w-full border-b border-white/15 bg-transparent px-0 py-2.5 text-base text-white placeholder:text-white/25 transition-colors focus:border-white/45 focus:outline-none md:text-lg"
                style={{ caretColor: accent }}
              />
              {current.hint && (
                <p
                  className="pt-1 text-[11px] italic md:text-[12px]"
                  style={{ color: accent, fontFamily: SERIF }}
                >
                  {current.hint}
                </p>
              )}

              {/* Color theme picker — only on step 1 alongside the
                  barbershop name. Picked theme drives the accent across
                  this page (button, halo, progress) and feeds into
                  ShopInputs.colorTheme so the generated site uses it. */}
              {step === 0 && (
                <div className="pt-4">
                  <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">
                    Pick your color theme
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
                              : 'border-white/15 bg-white/[0.03] hover:border-white/40'
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
                          <span className="min-w-0 truncate text-[8.5px] font-bold uppercase tracking-[0.08em] text-white/90 sm:text-[9.5px] sm:tracking-[0.1em]">
                            {t.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                className="px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white/50 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-0 md:text-xs"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="group flex items-center gap-2 rounded-full bg-white px-7 py-3 text-[12px] font-bold uppercase tracking-widest text-black shadow-xl shadow-black/40 transition-all hover:bg-gray-100 active:scale-[0.98] disabled:opacity-50 md:px-9 md:py-3.5 md:text-[13px]"
              >
                {submitting
                  ? 'Generating Site...'
                  : isLast
                    ? (
                        <>
                          Generate My Barbershop Site
                          <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                        </>
                      )
                    : (
                        <>
                          Continue
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

        {/* Support line — sits below the form on every entry path so
            visitors can reach the team before/after submission. */}
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
    </div>
  );
};

export default NewLeadQuizForm;
