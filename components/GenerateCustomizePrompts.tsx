import React, { useState, useEffect } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

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
}

type Step = 'booking' | 'name' | 'area' | 'phone' | 'done';
type Choice = 'yes' | 'no' | null;

const GOLD = '#e8c074';
const GOLD_DARK = '#8a6b30';
const BG_CARD = 'rgba(14, 12, 8, 0.94)';

export const GenerateCustomizePrompts: React.FC<GenerateCustomizePromptsProps> = ({
  onChange,
  onSubmitBookingLink,
  onFinish,
  onStepSubmit,
  onComplete,
  initialName = '',
  initialArea = '',
  initialPhone = '',
}) => {
  const [step, setStep] = useState<Step>('booking');
  const [choice, setChoice] = useState<Choice>(null);
  const [bookingUrl, setBookingUrl] = useState('');
  const [name, setName] = useState(initialName);
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const [scraping, setScraping] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState('');
  const [closing, setClosing] = useState(false);

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
        className="pointer-events-auto w-full max-w-[440px] rounded-2xl p-6 md:p-7 transition-all duration-300"
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
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[9px] font-bold uppercase tracking-[0.28em] px-2 py-0.5 rounded-full"
            style={{ background: `${GOLD}22`, color: GOLD }}
          >
            {stepLabel}
          </span>
        </div>

        <h2
          id="generate-prompt-title"
          className="text-[20px] md:text-[22px] leading-tight font-semibold text-white mb-4"
          style={{ letterSpacing: '-0.015em' }}
        >
          Customize Your Barbershop Site
        </h2>

        {/* ───────── Step 1: booking link question ───────── */}
        {step === 'booking' && (
          <form onSubmit={handleBookingGenerate}>
            <h3 className="text-[15px] font-semibold text-white mb-1">
              Do you have a booking link?
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
              Booksy, Fresha, Vagaro — any booking link works. We'll pull your
              real services and photos from it.
            </p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => setChoice('yes')}
                className="px-3 py-3 text-[12px] font-bold uppercase tracking-[0.14em] rounded-md transition"
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
                onClick={() => setChoice('no')}
                className="px-3 py-3 text-[12px] font-bold uppercase tracking-[0.14em] rounded-md transition"
                style={{
                  background: choice === 'no' ? GOLD : 'transparent',
                  color: choice === 'no' ? '#0a0a0a' : 'white',
                  border: `1px solid ${choice === 'no' ? GOLD : 'rgba(255,255,255,0.22)'}`,
                }}
              >
                No, I don't have
              </button>
            </div>

            {choice === 'yes' && (
              <input
                type="url"
                autoFocus
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
                placeholder="booksy.com/your-shop"
                className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
                style={inputStyle}
              />
            )}

            <button
              type="submit"
              disabled={!choice || (choice === 'yes' && (!bookingUrl.trim() || scraping))}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={primaryBtnStyle}
            >
              {scraping ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Pulling your site…</span>
                </>
              ) : (
                <>
                  <span>Generate</span>
                  <ArrowRight size={13} />
                </>
              )}
            </button>
          </form>
        )}

        {/* ───────── Step 2: barbershop name ───────── */}
        {step === 'name' && (
          <form onSubmit={handleDetailSubmit}>
            <h3 className="text-[15px] font-semibold text-white mb-1">
              What is your barbershop name?
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
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
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
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
            <h3 className="text-[15px] font-semibold text-white mb-1">
              What is your service area?
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
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
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!area.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
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
            <h3 className="text-[15px] font-semibold text-white mb-1">
              What is your phone number?
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
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
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!phone.trim() || finishing}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
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
