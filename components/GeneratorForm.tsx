
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
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.shopName && inputs.area && inputs.phone) {
      onGenerate(inputs);
    }
  };

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

        {/* Left Side: Main Headline Section - Full Height */}
        <div className="p-10 md:p-24 flex flex-col justify-center items-center text-center bg-[#1a1a1a] border-b md:border-b-0 md:border-r border-white/5 relative min-h-[40vh] md:min-h-screen">
          <div className="relative z-10 pt-8 md:pt-0">
            <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-tight text-white mb-4 md:mb-8">
              Generate Custom <br className="hidden md:block"/> Barbershop <br className="hidden md:block"/> Website <br/> 
              <span className="text-[#f4a100] mt-1 md:mt-2 block">in about 30 seconds</span>
            </h1>
            
            <div className="w-12 md:w-20 h-1 bg-[#f4a100] mx-auto mb-4 md:mb-8"></div>
            
            <p className="text-white text-[9px] md:text-sm font-medium leading-relaxed uppercase tracking-[3px] md:tracking-[4px] max-w-[280px] md:max-w-sm mx-auto opacity-80">
              AI-crafted luxury layouts tailored to your unique brand identity.
            </p>
          </div>
        </div>

        {/* Right Side: Form - Full Height and Centered Content */}
        <div className="p-6 md:p-20 lg:p-32 bg-[#0d0d0d] flex flex-col justify-center min-h-[60vh] md:min-h-screen">
          <div className="max-w-xl w-full mx-auto">
            <form onSubmit={handleSubmit} className="space-y-6 md:space-y-10">
              <div className="space-y-1 md:space-y-2">
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Barber Shop Name</label>
                <input 
                  required
                  type="text" 
                  placeholder="The Gentlemen's Lounge"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-2 md:py-4 text-white transition-all outline-none font-montserrat text-sm md:text-xl placeholder:text-white/20"
                  value={inputs.shopName}
                  onChange={e => setInputs({...inputs, shopName: e.target.value})}
                />
              </div>

              <div className="space-y-1 md:space-y-2">
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Service Area</label>
                <input 
                  required
                  type="text" 
                  placeholder="Beverly Hills, CA"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-2 md:py-4 text-white transition-all outline-none font-montserrat text-sm md:text-xl placeholder:text-white/20"
                  value={inputs.area}
                  onChange={e => setInputs({...inputs, area: e.target.value})}
                />
              </div>

              <div className="space-y-1 md:space-y-2">
                <label className="block text-[10px] md:text-xs uppercase tracking-[3px] md:tracking-[4px] text-white font-black">Phone Number</label>
                <input 
                  required
                  type="tel" 
                  placeholder="+1 234 567 8900"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-2 md:py-4 text-white transition-all outline-none font-montserrat text-sm md:text-xl placeholder:text-white/20"
                  value={inputs.phone}
                  onChange={e => setInputs({...inputs, phone: e.target.value})}
                />
              </div>

              <button 
                type="submit"
                className="w-full py-4 md:py-6 mt-4 md:mt-8 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[3px] md:tracking-[4px] text-[10px] md:text-sm hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98]"
              >
                <span className="flex flex-col leading-tight gap-0.5 md:gap-1">
                  <span>Generate My</span>
                  <span>Barbershop Website</span>
                </span>
              </button>
            </form>
            
            <div className="mt-8 md:mt-16 flex items-center justify-center gap-3 md:gap-4">
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
