import React from 'react';
import { BRAND_SWATCHES } from '../lib/brandSwatches';

interface Props {
  current?: string;
  onPick: (hex: string) => void;
  columns?: 2 | 3 | 6;
  size?: 'sm' | 'md';
  className?: string;
}

// Tailwind can't build class names from variables, so map the props to fixed
// classes.
const COL_CLASS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 6: 'grid-cols-6' };
const SIZE_CLASS: Record<string, string> = { sm: 'h-6 w-6', md: 'h-8 w-8' };

// The single, shared color picker used everywhere: six preset brand swatches
// laid out as tappable circles (gold ring marks the active one). onPick(hex)
// hands back the chosen accent — no free custom-color choice. Same look and
// behavior in the floating in-site picker and in the generator forms.
export const BrandSwatchGrid: React.FC<Props> = ({ current, onPick, columns = 2, size = 'sm', className }) => {
  const active = (current || '').toLowerCase();
  return (
    <div className={`grid ${COL_CLASS[columns]} gap-1.5 justify-items-center ${className || ''}`}>
      {BRAND_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          aria-label={`Use color ${c}`}
          aria-pressed={active === c.toLowerCase()}
          className={`${SIZE_CLASS[size]} rounded-full transition`}
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
  );
};

export default BrandSwatchGrid;
