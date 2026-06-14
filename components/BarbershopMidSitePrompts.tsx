import React, { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';

// Centered glass modal that asks the two remaining quiz questions
// (service area then phone) after the visitor has named their
// barbershop on the /generatebarbershop hero. Mirrors the structure
// of PrimeHub's LandscapingMidSitePrompts — sequential steps with no
// X button, can't be dismissed until both answered, per-keystroke
// live preview wiring.
//
// Field names match ShopInputs / WebsiteData on AI-Barber: `area`
// for the service area, `phone` for the callable number.

export interface BarbershopMidSitePromptsProps {
  // Fires on every keystroke so the parent funnel can update siteData
  // and the live preview re-renders before the visitor clicks Generate.
  onChange: (field: 'area' | 'phone', value: string) => void;
  // Fires when the visitor clicks Generate on a step. Used to capture
  // the lead to Make.com / Supabase at each step boundary so we still
  // get a row when a visitor bails mid-funnel.
  onStepSubmit: (field: 'area' | 'phone', value: string) => void;
  // Fires after BOTH steps are submitted. Parent unmounts the overlay.
  onComplete: () => void;
  initialArea?: string;
  initialPhone?: string;
}

type Step = 'area' | 'phone' | 'done';

const GOLD = '#e8c074';
const GOLD_DARK = '#8a6b30';
const BG_CARD = 'rgba(14, 12, 8, 0.94)';

export const BarbershopMidSitePrompts: React.FC<BarbershopMidSitePromptsProps> = ({
  onChange,
  onStepSubmit,
  onComplete,
  initialArea = '',
  initialPhone = '',
}) => {
  const [step, setStep] = useState<Step>('area');
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const [closing, setClosing] = useState(false);

  // After the phone is submitted, slide out then call onComplete.
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => setClosing(true), 250);
    const t2 = setTimeout(() => onComplete(), 600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [step, onComplete]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'area') {
      const v = area.trim();
      if (!v) return;
      onStepSubmit('area', v);
      setStep('phone');
      return;
    }
    if (step === 'phone') {
      const v = phone.trim();
      if (!v) return;
      onStepSubmit('phone', v);
      setStep('done');
      return;
    }
  };

  // Pointer-events container lets background scroll/click work
  // OUTSIDE the card; only the card itself intercepts. This keeps the
  // visitor able to scroll the live preview behind the modal while the
  // prompt itself stays docked in the viewport middle (position: fixed).
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
        aria-labelledby="barbershop-mid-prompt-title"
      >
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[9px] font-bold uppercase tracking-[0.28em] px-2 py-0.5 rounded-full"
            style={{ background: `${GOLD}22`, color: GOLD }}
          >
            {step === 'area' ? 'Step 1 of 2' : step === 'phone' ? 'Step 2 of 2' : 'Done'}
          </span>
        </div>

        {step === 'area' && (
          <form onSubmit={handleSubmit}>
            <h3
              id="barbershop-mid-prompt-title"
              className="text-[18px] md:text-[20px] leading-tight font-semibold text-white mb-1"
              style={{ letterSpacing: '-0.015em' }}
            >
              What area is your barbershop in?
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
              We'll show this throughout your site so locals know you're nearby.
            </p>
            <input
              id="barbershop-mid-area"
              type="text"
              autoFocus
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                onChange('area', e.target.value);
              }}
              placeholder="Dallas, TX"
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
              style={{ border: '1px solid rgba(255,255,255,0.16)', borderRadius: '6px' }}
            />
            <button
              type="submit"
              disabled={!area.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={{ background: GOLD, color: '#0a0a0a', borderRadius: '6px' }}
            >
              <span>Generate</span>
              <ArrowRight size={13} />
            </button>
          </form>
        )}

        {step === 'phone' && (
          <form onSubmit={handleSubmit}>
            <h3
              id="barbershop-mid-prompt-title"
              className="text-[18px] md:text-[20px] leading-tight font-semibold text-white mb-1"
              style={{ letterSpacing: '-0.015em' }}
            >
              What number should appear on your site?
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
              Calls from every "Call" button on your site go straight to this number.
            </p>
            <input
              id="barbershop-mid-phone"
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
              style={{ border: '1px solid rgba(255,255,255,0.16)', borderRadius: '6px' }}
            />
            <button
              type="submit"
              disabled={!phone.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={{ background: GOLD, color: '#0a0a0a', borderRadius: '6px' }}
            >
              <span>Generate</span>
              <ArrowRight size={13} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default BarbershopMidSitePrompts;
