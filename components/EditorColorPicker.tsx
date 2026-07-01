import React from 'react';
import { BrandSwatchGrid } from './BrandSwatchGrid';

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
// post-payment editor) for every template (Luxe / Prime / Euphoria). Renders
// the shared six-swatch brand palette (BrandSwatchGrid) so it looks and behaves
// identically to the generator forms. onPick(hex) writes siteData.colorTheme,
// and the renderer re-themes live (autosave persists it post-payment).
export const EditorColorPicker: React.FC<Props> = ({ current, onPick, placement = 'center' }) => {
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
      <BrandSwatchGrid current={current} onPick={onPick} columns={2} size="sm" />
    </div>
  );
};

export default EditorColorPicker;
