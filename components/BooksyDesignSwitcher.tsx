import React from 'react';

// Floating Design 1 / Design 2 switcher for the /booksy editor. A single
// vertical panel pinned to the LEFT, vertically centered (left-middle) on all
// screen sizes — above the editor toolbar (z 70) but below modals (z 150).
// Selecting a design re-skins the SAME content (no re-scrape) via the parent's
// onSelect; the parent shows a brief loading overlay while it swaps. Booksy
// only — never rendered on /generate.

export interface BooksyDesignSwitcherProps {
  current: 'luxe' | 'euphoria' | 'prime';
  onSelect: (template: 'luxe' | 'prime') => void;
  busy?: boolean;
}

const GOLD = '#e8c074';

const OPTIONS: { key: 'luxe' | 'prime'; label: string }[] = [
  { key: 'luxe', label: 'Design 1' },
  { key: 'prime', label: 'Design 2' },
];

export const BooksyDesignSwitcher: React.FC<BooksyDesignSwitcherProps> = ({ current, onSelect, busy }) => {
  // Treat any non-prime template (luxe/euphoria) as "Design 1" for the active
  // highlight, since Design 2 is specifically the prime design.
  const activeKey: 'luxe' | 'prime' = current === 'prime' ? 'prime' : 'luxe';

  const Btn = ({ k, label }: { k: 'luxe' | 'prime'; label: string }) => {
    const active = activeKey === k;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => !active && onSelect(k)}
        className="px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] rounded-md transition disabled:opacity-60"
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

  const cardStyle: React.CSSProperties = {
    background: 'rgba(14,12,8,0.94)',
    border: `1px solid ${GOLD}`,
    boxShadow: '0 18px 50px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(232,192,116,0.12)',
    backdropFilter: 'blur(16px) saturate(150%)',
    WebkitBackdropFilter: 'blur(16px) saturate(150%)',
    fontFamily: '"Manrope","Inter",system-ui,sans-serif',
  };

  return (
    // Single left-middle vertical panel on all screen sizes (desktop + mobile).
    <div
      className="flex fixed left-3 top-1/2 -translate-y-1/2 z-[78] flex-col gap-2 rounded-2xl p-3"
      style={cardStyle}
      role="group"
      aria-label="Switch site design"
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-white/45 text-center mb-0.5">Design</span>
      {OPTIONS.map((o) => <Btn key={o.key} k={o.key} label={o.label} />)}
    </div>
  );
};

export default BooksyDesignSwitcher;
