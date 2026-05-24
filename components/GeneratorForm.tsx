
import React from 'react';
import { ShopInputs, TemplateId } from '../types';
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
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.shopName && inputs.area && inputs.phone) {
      onGenerate(inputs);
    }
  };

  const selectTemplate = (template: TemplateId) => {
    setInputs(prev => ({ ...prev, template }));
  };

  const displayName = inputs.shopName.trim() || 'Your Shop';

  return (
    <div className="min-h-screen bg-[#0d0d0d] flex items-stretch overflow-x-hidden">
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
        <div className="px-6 py-12 md:p-16 flex flex-col justify-center items-center text-center bg-[#1a1a1a] border-b md:border-b-0 md:border-r border-white/5 relative md:min-h-screen">
          <div className="relative z-10 pt-6 md:pt-0">
            <h1 className="text-xl md:text-4xl lg:text-5xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-3 md:mb-5">
              Generate Custom <br className="hidden md:block"/> Barbershop Website <br/>
              <span className="text-[#f4a100] mt-1 block">in about 30 seconds</span>
            </h1>

            <div className="w-10 md:w-16 h-[3px] bg-[#f4a100] mx-auto mb-3 md:mb-5"></div>

            <p className="text-white text-[9px] md:text-xs font-medium leading-relaxed uppercase tracking-[2.5px] md:tracking-[3px] max-w-[280px] md:max-w-xs mx-auto opacity-80">
              AI-crafted luxury layouts tailored to your brand.
            </p>
          </div>
        </div>

        {/* Right Side: Form */}
        <div className="px-6 py-10 md:px-16 md:py-12 lg:px-24 bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen">
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

              {/* Template Picker */}
              <div className="space-y-2 pt-1">
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                  Choose Your Design
                </label>
                <div className="grid grid-cols-2 gap-2.5 md:gap-3">
                  <TemplateCard
                    id="luxe"
                    selected={inputs.template === 'luxe'}
                    onSelect={selectTemplate}
                    name="Luxe Gold"
                    tagline="Dark · Bold · Cinematic"
                    shopName={displayName}
                  />
                  <TemplateCard
                    id="euphoria"
                    selected={inputs.template === 'euphoria'}
                    onSelect={selectTemplate}
                    name="Euphoria"
                    tagline="Editorial · Serif · Minimal"
                    shopName={displayName}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-3 md:py-4 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[3px] md:tracking-[4px] text-[10px] md:text-sm hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98]"
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

interface TemplateCardProps {
  id: TemplateId;
  selected: boolean;
  onSelect: (id: TemplateId) => void;
  name: string;
  tagline: string;
  shopName: string;
}

const TemplateCard: React.FC<TemplateCardProps> = ({ id, selected, onSelect, name, tagline, shopName }) => {
  const ring = selected
    ? 'border-[#f4a100] shadow-[0_0_20px_rgba(244,161,0,0.25)]'
    : 'border-white/15 hover:border-white/40';

  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={`group relative text-left bg-[#1a1a1a] border-2 ${ring} transition-all duration-300 overflow-hidden active:scale-[0.98]`}
    >
      {/* Mini preview */}
      <div className="aspect-[4/3] w-full overflow-hidden">
        {id === 'luxe' ? <LuxePreview shopName={shopName} /> : <EuphoriaPreview shopName={shopName} />}
      </div>

      {/* Footer label */}
      <div className="px-2.5 py-1.5 md:px-3 md:py-2 border-t border-white/10 bg-[#0d0d0d]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white text-[9px] md:text-[11px] font-montserrat font-black uppercase tracking-[1.5px] truncate">{name}</p>
            <p className="text-white/40 text-[7px] md:text-[8px] uppercase tracking-[1.5px] mt-0.5 truncate">{tagline}</p>
          </div>
          {selected && (
            <div className="shrink-0 w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-[#f4a100] flex items-center justify-center">
              <svg className="w-2 h-2 md:w-2.5 md:h-2.5 text-[#1a1a1a]" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </button>
  );
};

// Tiny visual mock of the Luxe template — dark with gold accents
const LuxePreview: React.FC<{ shopName: string }> = ({ shopName }) => (
  <div className="w-full h-full bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] relative p-2 md:p-3 flex flex-col">
    <div className="flex items-center gap-1 mb-1.5 md:mb-2">
      <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-[#f4a100]" />
      <div className="text-[5px] md:text-[7px] font-montserrat font-black uppercase tracking-[1px] text-white truncate">{shopName}</div>
    </div>
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-1 md:gap-1.5 border-2 border-[#f4a100]/40 px-2">
      <div className="text-[4px] md:text-[6px] font-bold text-[#f4a100] tracking-[1px] uppercase">Elite Grooming</div>
      <div className="text-[7px] md:text-[10px] font-montserrat font-black text-white uppercase tracking-[1px] leading-tight truncate w-full">{shopName}</div>
      <div className="h-[2px] w-4 md:w-6 bg-[#f4a100] my-0.5" />
      <div className="text-[4px] md:text-[5px] text-white border border-[#f4a100] px-1 py-0.5 uppercase tracking-[1px]">Call Now</div>
    </div>
    <div className="grid grid-cols-3 gap-0.5 md:gap-1 mt-1.5 md:mt-2">
      <div className="h-1.5 md:h-2.5 bg-[#f4a100]/20 border border-[#f4a100]/30" />
      <div className="h-1.5 md:h-2.5 bg-[#f4a100]/20 border border-[#f4a100]/30" />
      <div className="h-1.5 md:h-2.5 bg-[#f4a100]/20 border border-[#f4a100]/30" />
    </div>
  </div>
);

// Tiny visual mock of the Euphoria template — monochrome, serif, editorial
const EuphoriaPreview: React.FC<{ shopName: string }> = ({ shopName }) => (
  <div className="w-full h-full bg-black relative p-2 md:p-3 flex flex-col" style={{ fontFamily: 'Georgia, serif' }}>
    <div className="flex items-center justify-between mb-1.5 md:mb-2">
      <div className="text-[5px] md:text-[7px] uppercase tracking-[2px] text-white/90 truncate font-semibold" style={{ fontFamily: 'Georgia, serif' }}>{shopName}</div>
      <div className="flex gap-0.5">
        <div className="w-1 h-0.5 bg-white/60" />
        <div className="w-1 h-0.5 bg-white/60" />
        <div className="w-1 h-0.5 bg-white/60" />
      </div>
    </div>
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-1">
      <div className="text-[8px] md:text-[11px] text-white italic leading-tight px-1" style={{ fontFamily: 'Georgia, serif' }}>
        Sharp Cuts.
      </div>
      <div className="text-[8px] md:text-[11px] text-white italic leading-tight" style={{ fontFamily: 'Georgia, serif' }}>
        Quiet Luxury.
      </div>
      <div className="text-[4px] md:text-[5px] uppercase tracking-[1.5px] text-white/50 mt-1">— Book online —</div>
    </div>
    <div className="grid grid-cols-4 gap-0.5 mt-1.5 md:mt-2">
      <div className="h-1.5 md:h-2 bg-white/15 row-span-2" />
      <div className="h-1.5 md:h-2 bg-white/10" />
      <div className="h-1.5 md:h-2 bg-white/20" />
      <div className="h-1.5 md:h-2 bg-white/10" />
    </div>
  </div>
);
