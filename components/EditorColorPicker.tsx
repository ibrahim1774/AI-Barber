import React, { useState } from 'react';

// The six brand swatches offered in the /booksy customize step — reused here
// verbatim so the in-editor picker feels identical to the funnel one.
const SWATCHES = ['#f4a100', '#ffffff', '#dc2626', '#22c55e', '#3b82f6', '#a855f7'];

const WHEEL = 'conic-gradient(from 0deg, #f4a100, #dc2626, #a855f7, #3b82f6, #22c55e, #f4a100)';

interface Props {
  current?: string;
  onPick: (hex: string) => void;
}

const isHex = (c?: string): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c);

// Floating theme-color control shown in the post-payment editor for every
// template (Luxe / Prime / Euphoria) and therefore every account, current and
// future. Collapsed to a single dot to stay out of the way; expands to the
// swatch row + any-color wheel on tap. Calls onPick(hex) which writes
// siteData.colorTheme — the renderer re-themes live and autosave persists it.
export const EditorColorPicker: React.FC<Props> = ({ current, onPick }) => {
  const [open, setOpen] = useState(false);
  const active = (current || '').toLowerCase();

  return (
    <div className="fixed left-3 top-1/2 -translate-y-1/2 z-[78] flex flex-col items-center gap-1.5 rounded-2xl border border-white/10 bg-black/80 p-2.5 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change theme color"
        aria-expanded={open}
        title="Theme color"
        className="h-7 w-7 rounded-full border border-white/25 transition"
        style={{ background: isHex(current) ? current : WHEEL }}
      />
      <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/50">Theme</span>

      {open && (
        <div className="flex flex-col items-center gap-1.5 border-t border-white/10 pt-1.5">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              aria-label={`Use color ${c}`}
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
          {/* Any-color picker — opens the native color input. */}
          <label
            className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full"
            title="Pick any color"
            style={{ background: WHEEL, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)' }}
          >
            <input
              type="color"
              value={isHex(current) ? current : '#888888'}
              onChange={(e) => onPick(e.target.value)}
              className="absolute -inset-2 cursor-pointer opacity-0"
            />
          </label>
        </div>
      )}
    </div>
  );
};
