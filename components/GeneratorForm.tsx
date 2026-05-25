
import React from 'react';
import { ShopInputs } from '../types';
import { ScissorsIcon } from './Icons';

interface GeneratorFormProps {
  onGenerate: (inputs: ShopInputs) => void;
  onSignIn?: () => void;
}

export const GeneratorForm: React.FC<GeneratorFormProps> = ({ onGenerate, onSignIn }) => {
  const [inputs, setInputs] = React.useState<ShopInputs>({
    shopName: '',
    area: '',
    phone: '',
    template: 'luxe',
    bookingUrl: '',
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

        {/* Left Side: Main Headline Section */}
        <div className="px-6 pt-16 pb-8 md:p-16 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-r border-white/5 relative md:min-h-screen overflow-hidden">
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
          <div className="relative z-10 pt-6 md:pt-0">
            <h1 className="text-xl md:text-4xl lg:text-5xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-3 md:mb-5">
              Generate Custom <br className="hidden md:block"/> Barbershop Website <br/>
              <span className="text-[#f4a100] mt-1 block">in about 15 seconds</span>
            </h1>

            <div className="w-10 md:w-16 h-[3px] bg-[#f4a100] mx-auto mb-3 md:mb-5"></div>

            <p className="text-white text-[9px] md:text-xs font-medium leading-relaxed uppercase tracking-[2.5px] md:tracking-[3px] max-w-[280px] md:max-w-xs mx-auto opacity-90">
              AI-crafted luxury layouts tailored to your brand.
            </p>
          </div>
        </div>

        {/* Right Side: Form */}
        <div className="px-6 pt-6 pb-10 md:px-16 md:py-12 lg:px-24 bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen">
          <div className="max-w-xl w-full mx-auto">
            <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
              <div className="space-y-1">
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Barber Shop Name</label>
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
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Service Area</label>
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
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Phone Number</label>
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
                  <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Booking Link</label>
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

              <button
                type="submit"
                className="w-full py-4 md:py-5 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98]"
              >
                Generate My Website
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
