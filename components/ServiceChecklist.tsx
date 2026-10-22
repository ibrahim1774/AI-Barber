import React from 'react';
import { SERVICE_CHOICES, type ServicePicks } from '../lib/stockImages';

// Services checklist for hand-typed sites: tick what you offer, optional
// price each. Nothing ticked → the site has no Services section (we never
// invent a menu). Dark styling for the generator forms and overlays.
interface Props {
  value: ServicePicks;
  onChange: (next: ServicePicks) => void;
  centered?: boolean;
  // Collapsed behind an "Add your services (optional)" toggle, for the
  // short step-by-step overlays.
  collapsible?: boolean;
}

export const ServiceChecklist: React.FC<Props> = ({ value, onChange, centered, collapsible }) => {
  const toggle = (t: string) =>
    onChange({ ...value, [t]: { on: !value[t]?.on, price: value[t]?.price || '' } });
  const setPrice = (t: string, price: string) =>
    onChange({ ...value, [t]: { on: true, price } });

  const ticked = SERVICE_CHOICES.filter((t) => value[t]?.on).length;

  const list = (
    <ul className="divide-y divide-white/10 border border-white/15 text-left">
      {SERVICE_CHOICES.map((t) => {
        const on = !!value[t]?.on;
        return (
          <li key={t} className="flex items-center gap-3 px-3 py-2">
            <label className="flex flex-1 cursor-pointer items-center gap-3 text-[12px] md:text-sm text-white font-montserrat">
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(t)}
                className="h-4 w-4"
                style={{ accentColor: '#f4a100' }}
              />
              {t}
            </label>
            {on && (
              <input
                type="text"
                aria-label={`${t} price (optional)`}
                placeholder="Price (optional)"
                value={value[t]?.price || ''}
                onChange={(e) => setPrice(t, e.target.value)}
                className="w-32 bg-transparent border-b border-white/30 focus:border-[#f4a100] py-1 text-white text-[12px] md:text-sm outline-none placeholder:text-white/25"
              />
            )}
          </li>
        );
      })}
    </ul>
  );

  if (collapsible) {
    return (
      <details className="text-left">
        <summary className="cursor-pointer select-none text-[11px] font-semibold text-white/70 hover:text-white">
          Add your services (optional){ticked > 0 ? ` · ${ticked} picked` : ''}
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto">{list}</div>
        <p className="mt-1 text-white/40 text-[9px]">Skip it and your site has no services list.</p>
      </details>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className={`block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black ${centered ? 'text-center' : ''}`}>
        Your Services{' '}
        <span className="text-white/40 normal-case tracking-normal">(optional, prices too)</span>
      </label>
      {list}
      <p className={`text-white/40 text-[9px] md:text-[10px] ${centered ? 'text-center' : ''}`}>
        Skip it and your site has no services list. You can edit everything after.
      </p>
    </div>
  );
};
