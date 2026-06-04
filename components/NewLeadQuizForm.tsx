import React, { useEffect, useRef, useState } from 'react';
import { ShopInputs } from '../types';
import { ArrowRight } from 'lucide-react';

// /new — premium multi-step quiz form mirroring PrimeHub /barber.
// Same fields as the existing GeneratorForm (shopName, area, phone,
// bookingUrl, colorTheme) but presented one question at a time on a
// glass card with Manrope + Instrument Serif type and a Pexels hero
// video behind everything. Submits via the same `onGenerate` callback
// the existing form uses so the downstream pipeline is unchanged.

interface Props {
  onGenerate: (inputs: ShopInputs) => void;
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

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!current.optional && !fieldVal.trim()) return;
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    setSubmitting(true);
    onGenerate({
      ...inputs,
      bookingUrl: normalizeBookingUrl(inputs.bookingUrl || ''),
    });
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: '#05070A', fontFamily: SANS, color: 'white' }}
    >
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
          Generate your custom <br className="hidden sm:inline" />
          barbershop website in{' '}
          <span
            className="italic"
            style={{ fontFamily: SERIF, fontWeight: 400, color: accent }}
          >
            seconds.
          </span>
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
