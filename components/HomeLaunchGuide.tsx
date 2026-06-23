import React from 'react';

// Shown once after the homepage funnel finishes generating the site —
// a short numbered "here's what happens next" guide before the visitor
// edits / launches. Dark-glass + gold aesthetic to match the generator.

export interface HomeLaunchGuideProps {
  onClose: () => void;
}

const GOLD = '#e8c074';
const GOLD_DARK = '#8a6b30';
const BG_CARD = 'rgba(14, 12, 8, 0.96)';

const STEPS: React.ReactNode[] = [
  'You can edit your text and images now, or publish first.',
  'Create an account to come back and update your site anytime.',
  <>Click <span className="font-bold text-white">“Launch My Site”</span> when you’re ready.</>,
];

const NumberStep: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
  <div className="flex items-start gap-3">
    <span
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-black"
      style={{ background: GOLD, color: '#0a0a0a' }}
      aria-hidden="true"
    >
      {n}
    </span>
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
        <style>{`
          @keyframes hlgBadgePulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 ${GOLD}00; }
            50% { transform: scale(1.06); box-shadow: 0 0 16px 2px ${GOLD}66; }
          }
          .hlg-badge-anim { animation: hlgBadgePulse 1.5s ease-in-out infinite; transform-origin: left center; }
        `}</style>
        <span
          className="hlg-badge-anim mb-4 inline-block text-[9px] font-bold uppercase tracking-[0.28em] px-2 py-0.5 rounded-full"
          style={{ background: `${GOLD}22`, color: GOLD }}
        >
          Read this before you exit
        </span>

        <div className="space-y-3.5">
          {STEPS.map((step, i) => (
            <NumberStep key={i} n={i + 1}>{step}</NumberStep>
          ))}
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
