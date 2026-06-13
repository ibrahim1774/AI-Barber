import React, { useState, useEffect } from 'react';
import { ArrowRight, X } from 'lucide-react';

export interface DetailCollectionBarProps {
  // Fires on every keystroke so the parent funnel can update siteData
  // and the live preview re-renders without a second "Generate" click.
  onChange: (field: 'area' | 'phone', value: string) => void;
  // Fires when both fields are filled and the bar auto-hides, OR when
  // the visitor X's the bar. Parent unmounts the bar in response.
  onClose: () => void;
  initialArea?: string;
  initialPhone?: string;
}

const GOLD = '#e8c074';
const BG_BAR = 'rgba(20,20,20,0.92)';

export const DetailCollectionBar: React.FC<DetailCollectionBarProps> = ({
  onChange,
  onClose,
  initialArea = '',
  initialPhone = '',
}) => {
  const [step, setStep] = useState<0 | 1>(0);
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const [closing, setClosing] = useState(false);

  // Auto-hide after both filled. We require BOTH non-empty so a
  // visitor who advances to step 1 without typing in step 0 isn't
  // auto-dismissed before they fill anything.
  useEffect(() => {
    if (step === 1 && area.trim() && phone.trim()) {
      const t = setTimeout(() => {
        setClosing(true);
        const t2 = setTimeout(() => onClose(), 350);
        return () => clearTimeout(t2);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [step, area, phone, onClose]);

  return (
    <div
      className="fixed left-1/2 z-50 px-4 py-3 rounded-lg backdrop-blur-md transition-all duration-300"
      style={{
        bottom: closing ? '-100px' : '88px',
        transform: 'translateX(-50%)',
        background: BG_BAR,
        border: `1px solid rgba(232,192,116,0.35)`,
        boxShadow: '0 12px 32px -6px rgba(0,0,0,0.55)',
        maxWidth: 'min(92vw, 460px)',
        width: '100%',
        opacity: closing ? 0 : 1,
        fontFamily: '"Manrope", "Inter", system-ui, sans-serif',
      }}
    >
      {/* Header row: progress pill + close */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.22em] px-2 py-0.5 rounded-full"
          style={{ background: 'rgba(232,192,116,0.18)', color: GOLD }}
        >
          {step === 0 ? '1 of 2' : '2 of 2'}
        </span>
        <button
          type="button"
          onClick={() => onClose()}
          aria-label="Dismiss"
          className="text-white/40 hover:text-white/80 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {step === 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (area.trim()) setStep(1);
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            autoFocus
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              onChange('area', e.target.value);
            }}
            placeholder="Where's your shop located?"
            className="flex-1 px-3 py-2 bg-transparent text-white placeholder-white/40 text-[13px] outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '4px' }}
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition"
            style={{ background: GOLD, color: '#0a0a0a', borderRadius: '4px' }}
          >
            Next <ArrowRight size={11} />
          </button>
        </form>
      )}

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="tel"
            autoFocus
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              onChange('phone', e.target.value);
            }}
            placeholder="What's your phone number?"
            className="flex-1 px-3 py-2 bg-transparent text-white placeholder-white/40 text-[13px] outline-none"
            style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: '4px' }}
          />
        </form>
      )}
    </div>
  );
};

export default DetailCollectionBar;
