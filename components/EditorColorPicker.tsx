import React from 'react';

// The six brand swatches offered in the /booksy customize step — reused here
// verbatim so the floating picker matches the funnel one.
const SWATCHES = ['#f4a100', '#ffffff', '#dc2626', '#22c55e', '#3b82f6', '#a855f7'];

interface Props {
  current?: string;
  onPick: (hex: string) => void;
  // Where the floating panel anchors on the left rail.
  //   'center'       → vertically centered (post-payment editor, no other rail).
  //   'below-design' → sits just under the floating Design switcher so the two
  //                    don't overlap (pre-payment generation flow, where both
  //                    the Design switcher and this picker are visible).
  placement?: 'center' | 'below-design';
}

// Floating theme-color control shown after a site generates (and in the
// post-payment editor) for every template (Luxe / Prime / Euphoria). Lays out
// the six preset brand palettes as swatches — the visitor just taps one; there
// is no free custom-color choice. onPick(hex) writes siteData.colorTheme, and
// the renderer re-themes live (autosave persists it post-payment).
export const EditorColorPicker: React.FC<Props> = ({ current, onPick, placement = 'center' }) => {
  const active = (current || '').toLowerCase();

  // 'below-design' anchors the panel's top ~just under the Design switcher
  // (which is centered on the left rail) so the two floating panels stack
  // instead of overlapping.
  const positionCls =
    placement === 'below-design'
      ? 'top-[calc(50%+66px)]'
      : 'top-1/2 -translate-y-1/2';

  return (
    <div className={`fixed left-3 ${positionCls} z-[78] flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-black/80 p-2.5 shadow-xl backdrop-blur`}>
      <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/50">Theme</span>
      <div className="grid grid-cols-2 gap-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            aria-label={`Use color ${c}`}
            aria-pressed={active === c.toLowerCase()}
            className="h-6 w-6 rounded-full transition"
            style={{
              background: c,
              boxShadow:
                active === c.toLowerCase()
                  ? '0 0 0 2px #0e0c08, 0 0 0 4px #e8c074'
                  : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default EditorColorPicker;
