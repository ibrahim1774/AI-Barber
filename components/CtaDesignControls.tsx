import React from 'react';
import { BrandSwatchGrid } from './BrandSwatchGrid';

// Design + colour controls for the custom-design pages, floated directly
// above the single $29/mo CTA instead of scattered across the screen.
//
// On every other entry path the design switcher sits at left-middle
// (BooksyDesignSwitcher) and colour lives in the top-left theme picker. Those
// pages have two CTAs and a plan toggle in the bottom bar, so there's no room
// above it. /custom-design + /custom-design-29 have exactly one CTA, so the
// choice and the buy sit together: pick a design, pick a colour, subscribe.
//
// The bar it anchors to slides in with a transform, so we measure its
// offsetHeight (not its rect) — a rect read mid-animation would park this pill
// off-screen until the next resize.

export interface CtaDesignControlsProps {
  current: 'luxe' | 'euphoria' | 'prime';
  onSelect: (template: 'luxe' | 'prime') => void;
  busy?: boolean;
  color: string;
  onColorChange: (hex: string) => void;
}

const GOLD = '#e8c074';

const OPTIONS: { key: 'luxe' | 'prime'; label: string }[] = [
  { key: 'luxe', label: 'Design 1' },
  { key: 'prime', label: 'Design 2' },
];

// Fallback used until the CTA bar mounts and reports its real height.
const FALLBACK_BAR_HEIGHT = 116;

function useCtaBarHeight(): number {
  const [height, setHeight] = React.useState(FALLBACK_BAR_HEIGHT);

  React.useEffect(() => {
    let observer: ResizeObserver | null = null;
    let raf = 0;

    const attach = () => {
      const bar = document.querySelector('[data-aib-cta-bar]') as HTMLElement | null;
      if (!bar) {
        // The banner mounts a beat after the site does — keep looking.
        raf = window.requestAnimationFrame(attach);
        return;
      }
      setHeight(bar.offsetHeight);
      observer = new ResizeObserver(() => setHeight(bar.offsetHeight));
      observer.observe(bar);
    };
    attach();

    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, []);

  return height;
}

export const CtaDesignControls: React.FC<CtaDesignControlsProps> = ({
  current,
  onSelect,
  busy,
  color,
  onColorChange,
}) => {
  // Anything that isn't the prime design reads as "Design 1".
  const activeKey: 'luxe' | 'prime' = current === 'prime' ? 'prime' : 'luxe';
  const barHeight = useCtaBarHeight();

  const Btn = ({ k, label }: { k: 'luxe' | 'prime'; label: string }) => {
    const active = activeKey === k;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => !active && onSelect(k)}
        className="px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] rounded-md transition disabled:opacity-60"
        style={{
          background: active ? GOLD : 'transparent',
          color: active ? '#0a0a0a' : 'white',
          border: `1px solid ${active ? GOLD : 'rgba(255,255,255,0.22)'}`,
          cursor: active || busy ? 'default' : 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    // Design and colour sit side by side once there's room; on a phone the two
    // rows stack, because squeezing both into one row collapses the swatches
    // into an overlapping smear.
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[78] flex flex-col sm:flex-row items-center gap-2 sm:gap-3 rounded-2xl px-3.5 py-2.5"
      style={{
        bottom: barHeight + 12,
        background: 'rgba(14,12,8,0.94)',
        border: `1px solid ${GOLD}`,
        boxShadow: '0 18px 50px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(232,192,116,0.12)',
        backdropFilter: 'blur(16px) saturate(150%)',
        WebkitBackdropFilter: 'blur(16px) saturate(150%)',
        fontFamily: '"Manrope","Inter",system-ui,sans-serif',
      }}
      role="group"
      aria-label="Choose your design"
    >
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="text-[8px] font-bold uppercase tracking-[0.28em] text-white/45 text-center sm:text-left">Design</span>
        <div className="flex items-center gap-1.5">
          {OPTIONS.map((o) => (
            <Btn key={o.key} k={o.key} label={o.label} />
          ))}
        </div>
      </div>
      <div
        className="hidden sm:block h-9 w-px shrink-0"
        style={{ background: 'rgba(232,192,116,0.22)' }}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="text-[8px] font-bold uppercase tracking-[0.28em] text-white/45 text-center sm:text-left">Color</span>
        <BrandSwatchGrid current={color} onPick={onColorChange} columns={6} size="sm" />
      </div>
    </div>
  );
};

export default CtaDesignControls;
