
import React from 'react';
import { ShopInputs } from '../types';
import { ScissorsIcon } from './Icons';

interface GeneratorFormProps {
  onGenerate: (inputs: ShopInputs) => void;
  onSignIn?: () => void;
}

// Color-theme presets — matches the PrimeHub /barber set so the two
// products stay visually consistent. The slug is written onto
// ShopInputs.colorTheme and consumed by the LUXE + EUPHORIA renderers
// to drive their CSS variables.
const THEME_PRESETS: { slug: string; label: string; bg: string; accent: string }[] = [
  { slug: 'goldBlack',   label: 'Gold & Black',   bg: '#000000', accent: '#f4a100' },
  { slug: 'blackWhite',  label: 'Black & White',  bg: '#000000', accent: '#f5f5f5' },
  { slug: 'redBlack',    label: 'Red & Black',    bg: '#000000', accent: '#dc2626' },
  { slug: 'purpleGreen', label: 'Purple & Green', bg: '#160328', accent: '#22c55e' },
];

export const GeneratorForm: React.FC<GeneratorFormProps> = ({ onGenerate, onSignIn }) => {
  const [inputs, setInputs] = React.useState<ShopInputs>({
    shopName: '',
    area: '',
    phone: '',
    template: 'luxe',
    bookingUrl: '',
    colorTheme: 'goldBlack',
  });

  // Normalize a user-entered booking link: trim, drop if empty, prepend https:// if missing.
  const normalizeBookingUrl = (raw: string): string | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.shopName && inputs.area && inputs.phone) {
      onGenerate({ ...inputs, bookingUrl: normalizeBookingUrl(inputs.bookingUrl || '') });
    }
  };

  return (
    <div className="md:min-h-screen bg-[#0d0d0d] flex items-start md:items-stretch overflow-x-hidden">
      <div className="w-full grid md:grid-cols-[40%_60%] luxury-gradient relative">

        {/* Logo in the Upper Left Hand Corner */}
        <div className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-2 md:gap-3 z-20 pointer-events-none">
          <ScissorsIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100]" />
          <span className="text-[10px] md:text-sm font-montserrat font-black uppercase tracking-[2px] text-white">
            Prime<span className="text-[#f4a100]">Barber</span> AI
          </span>
        </div>

        {/* Sign In button in the Upper Right Hand Corner */}
        {onSignIn && (
          <button
            onClick={onSignIn}
            className="absolute top-6 right-6 md:top-8 md:right-8 z-20 text-[10px] md:text-xs font-montserrat font-bold uppercase tracking-[2px] text-white/70 hover:text-[#f4a100] transition-colors"
          >
            Sign In
          </button>
        )}

        {/* Left Side: Main Headline Section — tightened vertical padding
            on mobile so the headline + subhead don't push the inputs
            below the fold. Removed the marketing "AI-crafted luxury
            layouts ..." line and the orange divider — the italic
            instruction subhead carries enough weight on its own. */}
        <div className="px-6 pt-10 pb-4 md:p-16 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-r border-white/5 relative md:min-h-screen overflow-hidden">
          {/* Premium barbershop background */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            }}
            aria-hidden="true"
          />
          {/* Darkening overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/70 to-black/85" aria-hidden="true" />
          <div className="relative z-10 pt-4 md:pt-0">
            <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-2 md:mb-4">
              Generate Custom <br className="hidden md:block"/> Barbershop Website <br/>
              <span className="text-[#f4a100] mt-1 block">in Seconds</span>
            </h1>
            {/* Small italic serif subhead — instruction for the visitor,
                mirrors the one used on PrimeHub /barber. */}
            <p
              className="text-[11px] md:text-xs italic text-white/70 max-w-[280px] md:max-w-xs mx-auto"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Please fill in the info below so your custom website can be generated.
            </p>
          </div>
        </div>

        {/* Right Side: Form — tighter vertical padding on mobile so the
            first input sits right under the headline section. */}
        <div className="px-6 pt-4 pb-8 md:px-16 md:py-12 lg:px-24 bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen">
          <div className="max-w-xl w-full mx-auto">
            <form onSubmit={handleSubmit} className="space-y-3 md:space-y-5">
              <div className="space-y-1">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Barbershop Name</label>
                <input
                  required
                  type="text"
                  placeholder="The Gentlemen's Lounge"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={inputs.shopName}
                  onChange={e => setInputs({...inputs, shopName: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Barbershop Service Area</label>
                <input
                  required
                  type="text"
                  placeholder="Beverly Hills, CA"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={inputs.area}
                  onChange={e => setInputs({...inputs, area: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Phone Number</label>
                <input
                  required
                  type="tel"
                  placeholder="+1 234 567 8900"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={inputs.phone}
                  onChange={e => setInputs({...inputs, phone: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Booking Link</label>
                  <span className="text-[8px] md:text-[9px] uppercase tracking-[2px] text-[#f4a100]/80 border border-[#f4a100]/40 px-1.5 py-0.5">Optional</span>
                </div>
                <input
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="booksy.com/your-shop"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={inputs.bookingUrl || ''}
                  onChange={e => setInputs({...inputs, bookingUrl: e.target.value})}
                />
                <p className="text-white/40 text-[9px] md:text-[10px] mt-1">Booksy, Cal.com, Vagaro — any booking page works.</p>
              </div>

              {/* Color-theme picker — 4 presets in a 2x2 grid. Every chip
                  shows its label inline so the visitor can read every
                  option at a glance. Tap any chip to pick. */}
              <div className="space-y-1.5">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                  Choose Your Colors{' '}
                  <span className="text-white/40 normal-case tracking-normal">(pick a theme)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {THEME_PRESETS.map((t) => {
                    const selected = (inputs.colorTheme || 'goldBlack') === t.slug;
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        onClick={() => setInputs({ ...inputs, colorTheme: t.slug })}
                        aria-pressed={selected}
                        className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-all ${
                          selected
                            ? 'border-white bg-white/10'
                            : 'border-white/20 bg-white/[0.03] hover:border-white/40'
                        }`}
                      >
                        <span className="relative flex shrink-0 items-center">
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-white/25"
                            style={{ background: t.bg }}
                          />
                          <span
                            className="-ml-1.5 h-3.5 w-3.5 rounded-full border border-white/25"
                            style={{ background: t.accent }}
                          />
                        </span>
                        <span className="min-w-0 truncate text-[8.5px] sm:text-[9.5px] font-bold uppercase tracking-[0.08em] sm:tracking-[0.1em] text-white/90">
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-4 md:py-5 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98]"
              >
                Generate My Barbershop Website
              </button>
            </form>

            <div className="mt-5 md:mt-8 flex items-center justify-center gap-3 md:gap-4">
              <div className="h-[1px] flex-1 bg-white/10"></div>
              <p className="text-white/30 text-[7px] md:text-[9px] uppercase tracking-[3px] md:tracking-[5px] whitespace-nowrap">
                Premium Builder • Prime Barber AI
              </p>
              <div className="h-[1px] flex-1 bg-white/10"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
