import React from 'react';
import { Check } from 'lucide-react';

// Shown once after the homepage funnel finishes generating the site —
// a short "here's what happens next" guide before the visitor edits /
// launches. Same dark-glass + gold aesthetic as the rest of the
// generator (gold checkmarks, not green).

export interface HomeLaunchGuideProps {
  onClose: () => void;
}

const GOLD = '#e8c074';
const GOLD_DARK = '#8a6b30';
const BG_CARD = 'rgba(14, 12, 8, 0.96)';

const GoldCheck: React.FC = () => (
  <span
    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px]"
    style={{ background: GOLD }}
    aria-hidden="true"
  >
    <Check size={13} strokeWidth={3} color="#0a0a0a" />
  </span>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[13px] font-bold uppercase tracking-[0.18em] text-white">{children}</h4>
);

const CheckRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2.5">
    <GoldCheck />
    <span className="text-[14px] leading-snug text-white/85">{children}</span>
  </div>
);

export const HomeLaunchGuide: React.FC<HomeLaunchGuideProps> = ({ onClose }) => {
  return (
    <div
      className="fixed inset-0 z-[250] flex items-center justify-center px-4"
      style={{ background: 'rgba(5,7,10,0.72)', backdropFilter: 'blur(6px)', fontFamily: '"Manrope", "Inter", system-ui, sans-serif' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-launch-guide-title"
    >
      <div
        className="w-full max-w-[440px] rounded-2xl p-6 md:p-7"
        style={{
          background: BG_CARD,
          border: `1px solid ${GOLD_DARK}`,
          boxShadow:
            '0 30px 70px -16px rgba(0,0,0,0.7),' +
            'inset 0 1px 0 0 rgba(255,255,255,0.05),' +
            `0 0 0 1px ${GOLD}20`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          className="mb-4 inline-block text-[9px] font-bold uppercase tracking-[0.28em] px-2 py-0.5 rounded-full"
          style={{ background: `${GOLD}22`, color: GOLD }}
        >
          How it works
        </span>

        <div className="space-y-5">
          <div className="space-y-2.5">
            <SectionTitle>Before Launch</SectionTitle>
            <CheckRow>You can now edit the text and add your own images</CheckRow>
          </div>

          <div className="space-y-1.5">
            <SectionTitle>Launch</SectionTitle>
            <p className="text-[14px] leading-snug text-white/85">
              Click <span className="font-bold text-white">“Launch My Site”</span>, pay for hosting,
              and create your account.
            </p>
          </div>

          <div className="space-y-2.5">
            <SectionTitle>After Launch</SectionTitle>
            <CheckRow>You can edit the text and add images after you launch your site as well</CheckRow>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          id="home-launch-guide-title"
          className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition active:scale-[0.98]"
          style={{ background: GOLD, color: '#0a0a0a', borderRadius: '6px' }}
        >
          Got it — start editing
        </button>
      </div>
    </div>
  );
};

export default HomeLaunchGuide;
