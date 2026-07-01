import React, { useState, useEffect } from 'react';
import { ArrowRight, Loader2, ChevronLeft } from 'lucide-react';
import { BrandSwatchGrid } from './BrandSwatchGrid';

// Centered glass overlay for the /generate subpage. A barber site is
// already generated and rendered behind this card; the overlay asks the
// visitor to customize it:
//
//   Step 1 "booking": "Do you have a booking link?" with two options —
//     "Yes, I have" / "No, I don't have" — then a Generate button.
//       • Yes  → a link field appears (Booksy, Fresha, Vagaro, any
//                booking link). Generate scrapes it and rebuilds the
//                site from the real services/photos. On scrape failure
//                we silently fall through to the name/area/phone steps.
//       • No   → advances to the three detail questions below.
//   Step 2 "name"  : "What is your barbershop name?"
//   Step 3 "area"  : "What is your service area?"
//   Step 4 "phone" : "What is your phone number?" → "Finish Generating"
//
// Mirrors BarbershopMidSitePrompts: no X button, can't be dismissed
// until the flow completes, per-keystroke live preview wiring via
// onChange so the site behind reflects answers in real time.

export interface GenerateCustomizePromptsProps {
  // Fires on every keystroke for the detail questions so the parent can
  // update siteData and the live preview re-renders immediately.
  onChange: (field: 'name' | 'area' | 'phone', value: string) => void;
  // Fires when the visitor submits the booking link. The parent scrapes
  // the URL and rebuilds the site. Resolves true on success (overlay
  // finishes) or false on failure (overlay falls through to the detail
  // questions so the visitor can still finish).
  onSubmitBookingLink: (url: string) => Promise<boolean>;
  // Fires when the visitor finishes the No-link path. The parent
  // regenerates the site from the entered name/area/phone.
  onFinish: (name: string, area: string, phone: string) => Promise<void> | void;
  // Fires after each detail step so a partial visitor still lands in the
  // CRM via the existing leadCaptureService.
  onStepSubmit?: (field: 'name' | 'area' | 'phone', value: string) => void;
  // Fires once the whole flow completes. Parent unmounts the overlay.
  onComplete: () => void;
  initialName?: string;
  initialArea?: string;
  initialPhone?: string;
  // 'generate' (default) = the neutral "Customize Your Barbershop Site"
  // copy. 'booksy' = the /booksy entry: Booksy-flavored headline and the
  // overlay opens straight to the booking-link field (lead with the link).
  variant?: 'generate' | 'booksy';
  // When provided, a brand-color picker is shown in the first step; each
  // pick fires onColorChange so the parent re-themes the live preview and
  // carries the color into the generated site.
  onColorChange?: (hex: string) => void;
  initialColor?: string;
  // When provided, a Design 1 / Design 2 picker is shown in the first step
  // (booksy only). Each pick re-skins the live preview instantly and carries
  // the choice into the generated site. Design 1 = luxe, Design 2 = prime.
  onTemplateChange?: (template: 'luxe' | 'prime') => void;
  initialTemplate?: string;
}

type Step = 'booking' | 'name' | 'area' | 'phone' | 'done';
type Choice = 'yes' | 'no' | null;

const GOLD = '#e8c074';
const GOLD_DARK = '#8a6b30';
const BG_CARD = 'rgba(14, 12, 8, 0.94)';

// Looping typewriter that demos pasting a booking link: types out an
// example URL, holds, erases it, then moves to the next platform — forever.
// Shown under the "Enter your barber booking link here ::" label so the
// visitor sees exactly what to drop in (Booksy, Square, Squire, Fresha…).
const TYPE_SAMPLES = [
  'booksy.com/your-shop',
  'squareup.com/appointments',
  'getsquire.com/your-shop',
  'fresha.com/your-shop',
];
const BookingLinkTypewriter: React.FC<{ color: string }> = ({ color }) => {
  const [idx, setIdx] = useState(0);
  const [sub, setSub] = useState(0);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const full = TYPE_SAMPLES[idx];
    if (!deleting && sub === full.length) {
      const t = setTimeout(() => setDeleting(true), 1400);
      return () => clearTimeout(t);
    }
    if (deleting && sub === 0) {
      setDeleting(false);
      setIdx((i) => (i + 1) % TYPE_SAMPLES.length);
      return;
    }
    const t = setTimeout(() => setSub((s) => s + (deleting ? -1 : 1)), deleting ? 40 : 85);
    return () => clearTimeout(t);
  }, [sub, deleting, idx]);
  return (
    <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', color }}>
      {TYPE_SAMPLES[idx].slice(0, sub)}
      <span className="animate-pulse" style={{ color }}>|</span>
    </span>
  );
};

export const GenerateCustomizePrompts: React.FC<GenerateCustomizePromptsProps> = ({
  onChange,
  onSubmitBookingLink,
  onFinish,
  onStepSubmit,
  onComplete,
  initialName = '',
  initialArea = '',
  initialPhone = '',
  variant = 'generate',
  onColorChange,
  initialColor = '#f4a100',
  onTemplateChange,
  initialTemplate = 'luxe',
}) => {
  const isBooksy = variant === 'booksy';
  const [color, setColor] = useState(initialColor);
  const pickColor = (hex: string) => {
    setColor(hex);
    onColorChange?.(hex);
  };
  // Design 1 / Design 2 selection (booksy only).
  const [template, setTemplate] = useState<'luxe' | 'prime'>(initialTemplate === 'prime' ? 'prime' : 'luxe');
  const pickTemplate = (t: 'luxe' | 'prime') => {
    setTemplate(t);
    onTemplateChange?.(t);
  };
  const [step, setStep] = useState<Step>('booking');
  // On /booksy the visitor came specifically to move their booking link
  // over, so open straight to the link field instead of the Yes/No split.
  const [choice, setChoice] = useState<Choice>(isBooksy ? 'yes' : null);
  const [bookingUrl, setBookingUrl] = useState('');
  const [name, setName] = useState(initialName);
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const [scraping, setScraping] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);

  // Countdown shown while we pull + rebuild from the booking link, so the
  // wait feels measured rather than open-ended. ~10s reflects the average
  // pull time; it ticks to 0, then shows "Almost there…" if a particular
  // shop takes longer.
  const PULL_ESTIMATE_SECONDS = 10;
  const [countdown, setCountdown] = useState(PULL_ESTIMATE_SECONDS);

  useEffect(() => {
    if (!scraping) {
      setCountdown(PULL_ESTIMATE_SECONDS);
      return;
    }
    setCountdown(PULL_ESTIMATE_SECONDS);
    const id = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [scraping]);

  // After the flow finishes, slide out then call onComplete.
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => setClosing(true), 250);
    const t2 = setTimeout(() => onComplete(), 600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [step, onComplete]);

  // Step 1 primary action.
  const handleBookingGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (choice === 'no') {
      setStep('name');
      return;
    }
    if (choice === 'yes') {
      const url = bookingUrl.trim();
      if (!url) return;
      setScraping(true);
      setNote('');
      const ok = await onSubmitBookingLink(url).catch(() => false);
      setScraping(false);
      if (ok) {
        setStep('done');
      } else {
        // Couldn't read that link — finish with the detail questions.
        setNote("We couldn't read that link, so let's add a few details instead.");
        setStep('name');
      }
    }
  };

  // Detail-step submit (name → area → phone → finish).
  const handleDetailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'name') {
      const v = name.trim();
      if (!v) return;
      onStepSubmit?.('name', v);
      setStep('area');
      return;
    }
    if (step === 'area') {
      const v = area.trim();
      if (!v) return;
      onStepSubmit?.('area', v);
      setStep('phone');
      return;
    }
    if (step === 'phone') {
      const v = phone.trim();
      if (!v) return;
      onStepSubmit?.('phone', v);
      setFinishing(true);
      await onFinish(name.trim(), area.trim(), phone.trim());
      setFinishing(false);
      setStep('done');
    }
  };

  // Back navigation for the detail steps — lets a visitor who picked "No,
  // I don't have" return to the booking-link step (or step back through the
  // questions). The booking step is the first step, so it has no back.
  const goBack = () => {
    setNote('');
    if (step === 'name') { setChoice(isBooksy ? 'yes' : null); setStep('booking'); }
    else if (step === 'area') setStep('name');
    else if (step === 'phone') setStep('area');
  };

  const stepLabel =
    step === 'booking'
      ? 'Customize'
      : step === 'name'
        ? 'Step 1 of 3'
        : step === 'area'
          ? 'Step 2 of 3'
          : step === 'phone'
            ? 'Step 3 of 3'
            : 'Done';

  const inputStyle: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: '6px',
  };
  const primaryBtnStyle: React.CSSProperties = {
    background: GOLD,
    color: '#0a0a0a',
    borderRadius: '6px',
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 flex items-center justify-center px-4"
      style={{
        zIndex: 240,
        fontFamily: '"Manrope", "Inter", system-ui, sans-serif',
      }}
      aria-live="polite"
    >
      <div
        className="pointer-events-auto w-full max-w-[320px] rounded-lg p-3.5 transition-all duration-300"
        style={{
          background: BG_CARD,
          border: `1px solid ${GOLD_DARK}`,
          boxShadow:
            '0 30px 70px -16px rgba(0,0,0,0.7),' +
            'inset 0 1px 0 0 rgba(255,255,255,0.05),' +
            `0 0 0 1px ${GOLD}20`,
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          opacity: closing ? 0 : 1,
          transform: closing ? 'translateY(20px) scale(0.98)' : 'translateY(0) scale(1)',
        }}
        role="dialog"
        aria-modal="false"
        aria-labelledby="generate-prompt-title"
      >
        <div className="flex items-center justify-between mb-1.5">
          {step !== 'booking' ? (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.16em] text-white/55 hover:text-white transition"
              aria-label="Go back"
            >
              <ChevronLeft size={12} /> Back
            </button>
          ) : (
            <span />
          )}
          <span
            className="text-[8px] font-bold uppercase tracking-[0.28em] px-1.5 py-0.5 rounded-full"
            style={{ background: `${GOLD}22`, color: GOLD }}
          >
            {stepLabel}
          </span>
        </div>

        <h2
          id="generate-prompt-title"
          className={`leading-tight font-semibold text-white mb-2.5 ${isBooksy ? 'text-[13px] md:text-[15px] whitespace-nowrap' : 'text-[14px] md:text-[15px]'}`}
          style={{ letterSpacing: '-0.015em' }}
        >
          {isBooksy ? 'Generate Custom Barber Site in Seconds' : 'Customize Your Barbershop Site'}
        </h2>

        {/* ───────── Step 1: booking link question ───────── */}
        {step === 'booking' && (
          <form onSubmit={handleBookingGenerate}>
            {/* On /booksy the title above already frames this, so the
                per-step heading + blurb are hidden. /generate keeps them. */}
            {!isBooksy && (
              <>
                <h3 className="text-[13px] font-semibold text-white mb-1">
                  Do you have a booking link?
                </h3>
                <p className="text-[11px] text-white/55 mb-3">
                  Booksy, Fresha, Vagaro — any booking link works. We'll pull your real services and photos from it.
                </p>
              </>
            )}

            {/* Design picker — Design 1 (luxe) / Design 2 (prime). Re-skins
                the live preview instantly and carries into the generated
                site. /booksy only (shown when onTemplateChange provided). */}
            {onTemplateChange && (
              <div className="mb-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/45 mb-1.5">
                  Design
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {([['luxe', 'Design 1', 'Bold'], ['prime', 'Design 2', 'Editorial']] as const).map(([key, label, name]) => {
                    const active = template === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => pickTemplate(key)}
                        className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-md transition whitespace-nowrap"
                        style={{
                          background: active ? GOLD : 'transparent',
                          color: active ? '#0a0a0a' : 'white',
                          border: `1px solid ${active ? GOLD : 'rgba(255,255,255,0.22)'}`,
                        }}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-[0.08em]">{label}</span>
                        <span
                          className="text-[9px] italic"
                          style={{ color: active ? 'rgba(10,10,10,0.6)' : 'rgba(255,255,255,0.5)' }}
                        >
                          {name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Brand color picker — re-themes the live preview instantly and
                carries into the generated site. */}
            {onColorChange && (
              <div className="mb-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/45 mb-1.5">
                  Brand color
                </p>
                <BrandSwatchGrid current={color} onPick={pickColor} columns={6} size="sm" className="justify-items-start" />
              </div>
            )}

            {/* /booksy leads with the booking link as the only option — no
                Yes/No split. /generate keeps the split so a linkless visitor
                can route to the manual name/area/phone questions. (On a failed
                scrape, /booksy still falls through to those steps.) */}
            {!isBooksy && (
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                <button
                  type="button"
                  onClick={() => setChoice('yes')}
                  className="px-2 py-2 text-[11px] font-bold uppercase tracking-[0.12em] rounded-md transition whitespace-nowrap"
                  style={{
                    background: choice === 'yes' ? GOLD : 'transparent',
                    color: choice === 'yes' ? '#0a0a0a' : 'white',
                    border: `1px solid ${choice === 'yes' ? GOLD : 'rgba(255,255,255,0.22)'}`,
                  }}
                >
                  Yes, I have
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // No link → jump straight to the 3 detail questions.
                    setChoice('no');
                    setNote('');
                    setStep('name');
                  }}
                  className="px-2 py-2 text-[11px] font-bold uppercase tracking-[0.12em] rounded-md transition whitespace-nowrap"
                  style={{
                    background: choice === 'no' ? GOLD : 'transparent',
                    color: choice === 'no' ? '#0a0a0a' : 'white',
                    border: `1px solid ${choice === 'no' ? GOLD : 'rgba(255,255,255,0.22)'}`,
                  }}
                >
                  No, I don't have
                </button>
              </div>
            )}

            {choice === 'yes' && (
              <>
                <p className="text-[13px] md:text-[15px] font-bold tracking-tight text-white leading-snug mb-1 whitespace-nowrap">
                  Enter your barber booking link here
                  <span className="text-white/35"> ::</span>
                </p>
                <p className="text-[12px] md:text-[13px] font-semibold mb-3 min-h-[18px]">
                  <BookingLinkTypewriter color={color} />
                </p>
                <input
                  // type="text" (not "url") so a pasted share-sheet blob —
                  // "…book on Booksy here: https://booksy.com/…" — isn't
                  // rejected by native URL validation before extractFirstUrl
                  // can pull the link out of it. Mirrors the /booksy page.
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  value={bookingUrl}
                  onChange={(e) => setBookingUrl(e.target.value)}
                  placeholder="Paste your link here…"
                  className="w-full px-3 py-3.5 bg-transparent text-white placeholder-white/35 text-[15px] outline-none mb-3"
                  style={inputStyle}
                />
              </>
            )}

            {/* No Skip button — the "No, I don't have" option above already
                routes a visitor without a link to the detail questions. */}
            <button
              type="submit"
              disabled={choice !== 'yes' || !bookingUrl.trim() || scraping}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={primaryBtnStyle}
            >
              {scraping ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>{countdown > 0 ? `Pulling… ${countdown}s` : 'Almost there…'}</span>
                </>
              ) : (
                <>
                  <span>{isBooksy ? 'Generate My Barbershop Site' : 'Generate'}</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </form>
        )}

        {/* ───────── Step 2: barbershop name ───────── */}
        {step === 'name' && (
          <form onSubmit={handleDetailSubmit}>
            <h3 className="text-[13px] font-semibold text-white mb-1">
              What is your barbershop name?
            </h3>
            <p className="text-[11px] text-white/55 mb-3">
              {note || "We'll use this across your site's headline and footer."}
            </p>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                onChange('name', e.target.value);
              }}
              placeholder="The Gentlemen's Lounge"
              className="w-full px-2.5 py-2.5 bg-transparent text-white placeholder-white/35 text-[13px] outline-none mb-2.5"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={primaryBtnStyle}
            >
              <span>Continue</span>
              <ArrowRight size={13} />
            </button>
          </form>
        )}

        {/* ───────── Step 3: service area ───────── */}
        {step === 'area' && (
          <form onSubmit={handleDetailSubmit}>
            <h3 className="text-[13px] font-semibold text-white mb-1">
              What is your service area?
            </h3>
            <p className="text-[11px] text-white/55 mb-3">
              We'll show this throughout your site so locals know you're nearby.
            </p>
            <input
              type="text"
              autoFocus
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                onChange('area', e.target.value);
              }}
              placeholder="Dallas, TX"
              className="w-full px-2.5 py-2.5 bg-transparent text-white placeholder-white/35 text-[13px] outline-none mb-2.5"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!area.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={primaryBtnStyle}
            >
              <span>Continue</span>
              <ArrowRight size={13} />
            </button>
          </form>
        )}

        {/* ───────── Step 4: phone → finish ───────── */}
        {step === 'phone' && (
          <form onSubmit={handleDetailSubmit}>
            <h3 className="text-[13px] font-semibold text-white mb-1">
              What is your phone number?
            </h3>
            <p className="text-[11px] text-white/55 mb-3">
              Calls from every "Call" button on your site go straight to this number.
            </p>
            <input
              type="tel"
              inputMode="tel"
              autoFocus
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                onChange('phone', e.target.value);
              }}
              placeholder="(555) 123-4567"
              className="w-full px-2.5 py-2.5 bg-transparent text-white placeholder-white/35 text-[13px] outline-none mb-2.5"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!phone.trim() || finishing}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={primaryBtnStyle}
            >
              {finishing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Generating…</span>
                </>
              ) : (
                <>
                  <span>Finish Generating</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default GenerateCustomizePrompts;
