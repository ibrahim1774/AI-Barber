
import React, { useEffect, useState } from 'react';
import { WebsiteData } from '../types';
import {
  ScissorsIcon, RazorIcon, MustacheIcon, FaceIcon,
  MapPinIcon, AwardIcon, ClockIcon, PhoneIcon, MailIcon
} from './Icons';
import { generateHTML } from '../services/htmlGenerator';

interface GeneratedWebsiteProps {
  data: WebsiteData;
  onBack: () => void;
}

export const GeneratedWebsite: React.FC<GeneratedWebsiteProps> = ({ data, onBack }) => {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const getServiceIcon = (type: string) => {
    switch (type) {
      case 'scissors': return <ScissorsIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
      case 'razor': return <RazorIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
      case 'mustache': return <MustacheIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
      case 'face': return <FaceIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
      default: return <ScissorsIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
    }
  };

  const handleClaimWebsite = async () => {
    // Generate HTML on client side
    const htmlContent = generateHTML(data);

    // Deploy to GitHub silently in the background
    fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shopName: data.shopName,
        htmlContent: htmlContent
      })
    }).catch(err => {
      console.error('Background deployment failed:', err);
      // Continue to Stripe even if deployment fails
    });

    // Immediately redirect to Stripe payment (don't wait for deployment)
    window.open('https://buy.stripe.com/8x2bJ0eCo8yGgrE8Ym3cc05', '_blank');
  };

  const formattedPhone = data.phone.replace(/\s+/g, '');

  return (
    <div className="bg-[#0d0d0d] text-white overflow-hidden scroll-smooth">
      {/* Header */}
      <header className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-[#1a1a1a]/95 backdrop-blur-md shadow-xl py-3 md:py-4' : 'bg-black/20 py-5 md:py-8'}`}>
        <div className="container mx-auto flex justify-between items-center px-4 md:px-6">
          <div className="flex items-center gap-4 md:gap-8">
            <div className="flex items-center gap-3 md:gap-5">
              <ScissorsIcon className="w-8 h-8 md:w-12 md:h-12 text-[#f4a100]" />
              <span className="font-montserrat font-black text-lg md:text-3xl lg:text-4xl tracking-[1px] md:tracking-[2px] uppercase whitespace-nowrap">
                {data.shopName.split(' ')[0]} <span className="text-[#f4a100]">{data.shopName.split(' ').slice(1).join(' ')}</span>
              </span>
            </div>
            
            <a 
              href={`tel:${formattedPhone}`} 
              className="flex items-center gap-2 md:gap-4 text-[#f4a100] border-l-2 border-white/20 pl-4 md:pl-8 hover:text-white transition-colors"
            >
              <PhoneIcon className="w-5 h-5 md:w-7 md:h-7" />
              <span className="text-sm md:text-xl lg:text-2xl font-bold tracking-tight">{data.phone}</span>
            </a>
          </div>

          <nav className="flex items-center gap-4 md:gap-10">
            <div className="hidden lg:flex items-center gap-10">
              {['HOME', 'SERVICES', 'CONTACT'].map(item => (
                <a
                  key={item}
                  href={`#${item.toLowerCase().replace(' ', '-')}`}
                  className="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors"
                >
                  {item}
                </a>
              ))}
            </div>
            <button
              onClick={onBack}
              className="px-4 py-2 md:px-7 md:py-3 border-2 border-[#f4a100] text-[#f4a100] text-[10px] md:text-[13px] font-black uppercase tracking-widest hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all"
            >
              BACK
            </button>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section id="home" className="relative h-screen flex flex-col justify-center items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={data.hero.imageUrl} 
            alt="Main Hero" 
            className="w-full h-full object-cover" 
          />
          <div className="absolute inset-0 bg-black/70 bg-gradient-to-b from-black/60 via-transparent to-[#0d0d0d]"></div>
        </div>
        
        <div className="relative z-10 text-center px-4 md:px-6 max-w-5xl -mt-20 md:mt-0">
          <p className="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
            {data.hero.tagline}
          </p>
          
          <h1 className="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
            {data.hero.heading}
          </h1>

          <a 
            href={`tel:${formattedPhone}`}
            className="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base"
          >
            <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 group-hover:scale-110 transition-transform" />
            <span>Call Now: {data.phone}</span>
          </a>
        </div>

        {/* Feature Cards */}
        <div className="absolute bottom-6 md:bottom-10 left-0 w-full px-4 md:px-6">
          <div className="container mx-auto grid grid-cols-3 gap-2 md:gap-6 max-w-5xl">
            {[
              { icon: <MapPinIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />, title: 'EXPERIENCE', sub: 'Elite' },
              { icon: <AwardIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />, title: 'RECOGNIZED', sub: 'Masters' },
              { icon: <ClockIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />, title: 'OPEN DAILY', sub: '9:00 - 18:00' }
            ].map((card, i) => (
              <div key={i} className="bg-[#1a1a1a]/90 backdrop-blur-sm p-2 md:p-8 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 md:gap-6 border border-[#f4a100]/20 hover:border-[#f4a100]/50 transition-all duration-300">
                <div className="shrink-0">{card.icon}</div>
                <div className="text-center sm:text-left">
                  <h4 className="font-montserrat font-black text-[7px] md:text-xs tracking-[0.5px] md:tracking-[1px] text-white uppercase">{card.title}</h4>
                  <p className="text-[#cccccc] text-[6px] md:text-[10px] uppercase tracking-[0.5px] md:tracking-[1px] mt-0.5">{card.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about-us" className="py-12 md:py-32 px-6 bg-[#1a1a1a]">
        <div className="container mx-auto grid lg:grid-cols-2 gap-10 md:gap-20 items-center">
          <div className="relative">
            <div className="flex items-center gap-3 mb-4 md:mb-6">
              <ScissorsIcon className="w-4 h-4 md:w-5 md:h-5 text-[#f4a100]" />
              <span className="text-[#f4a100] text-[10px] md:text-xs font-bold tracking-[3px] md:tracking-[4px] uppercase font-montserrat">About Us</span>
            </div>
            <h2 className="text-2xl md:text-5xl font-montserrat font-black text-white mb-6 md:mb-8 leading-tight uppercase tracking-[2px]">
              {data.about.heading}
            </h2>
            <div className="space-y-4 md:space-y-6 text-[#cccccc] font-light leading-relaxed text-sm md:text-base">
              {data.about.description.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>
          <div className="relative group mt-6 lg:mt-0">
            <div className="absolute -inset-2 md:-inset-4 border border-[#f4a100]/30 -z-10 transform translate-x-2 translate-y-2 md:translate-x-4 md:translate-y-4 transition-transform duration-500"></div>
            <img src={data.about.imageUrl} alt="Barber Shop Atmosphere" className="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl" />
          </div>
        </div>
      </section>

      {/* Master Barbers Expertise */}
      <section className="py-16 md:py-32 bg-[#0d0d0d] px-6 border-y border-white/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-1/3 h-full bg-[#1a1a1a] -z-10 transform skew-x-12 translate-x-32 hidden lg:block"></div>
        <div className="container mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
            <div className="lg:w-1/2 order-2 lg:order-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="bg-[#1a1a1a] p-1 border border-white/5">
                    <img src={data.gallery[2]} alt="Professional Barber Tools" className="w-full h-40 md:h-64 object-cover" />
                  </div>
                  <div className="bg-[#1a1a1a] p-1 border border-white/5">
                    <img src={data.gallery[3]} alt="Clean Haircut Detail" className="w-full h-32 md:h-48 object-cover" />
                  </div>
                </div>
                <div className="space-y-4 pt-8">
                  <div className="bg-[#1a1a1a] p-1 border border-white/5">
                    <img src={data.gallery[4]} alt="Shaving Ritual" className="w-full h-32 md:h-48 object-cover" />
                  </div>
                  <div className="bg-[#1a1a1a] p-1 border border-white/5">
                    <img src={data.gallery[5]} alt="Hair Styling Session" className="w-full h-40 md:h-64 object-cover" />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="lg:w-1/2 order-1 lg:order-2">
              <h3 className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4">Master Barbers</h3>
              <h2 className="text-3xl md:text-5xl font-montserrat font-black text-white leading-tight uppercase tracking-[2px] mb-8">
                The Pinnacle of <br/> Professional Craftsmanship
              </h2>
              <div className="space-y-8">
                <div className="flex items-start gap-6">
                  <div className="bg-[#1a1a1a] p-3 rounded-full border border-[#f4a100]/30 shrink-0">
                    <ScissorsIcon className="w-6 h-6 text-[#f4a100]" />
                  </div>
                  <div>
                    <h4 className="text-white font-montserrat font-bold text-lg uppercase mb-2">Signature Cuts</h4>
                    <p className="text-[#888888] leading-relaxed">Our master barbers blend classic techniques with modern trends to create styles that define your personality.</p>
                  </div>
                </div>
                <div className="flex items-start gap-6">
                  <div className="bg-[#1a1a1a] p-3 rounded-full border border-[#f4a100]/30 shrink-0">
                    <RazorIcon className="w-6 h-6 text-[#f4a100]" />
                  </div>
                  <div>
                    <h4 className="text-white font-montserrat font-bold text-lg uppercase mb-2">Artisan Shaves</h4>
                    <p className="text-[#888888] leading-relaxed">Experience the ritual of a traditional hot-towel shave, utilizing the world's finest blades and soothing balsams.</p>
                  </div>
                </div>
                <div className="flex items-start gap-6">
                  <div className="bg-[#1a1a1a] p-3 rounded-full border border-[#f4a100]/30 shrink-0">
                    <AwardIcon className="w-6 h-6 text-[#f4a100]" />
                  </div>
                  <div>
                    <h4 className="text-white font-montserrat font-bold text-lg uppercase mb-2">Elite Consulting</h4>
                    <p className="text-[#888888] leading-relaxed">We don't just cut hair; we analyze your face shape and hair type to recommend the perfect look for your lifestyle.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Services Grid Section */}
      <section id="our-services" className="py-12 md:py-32 bg-[#0d0d0d] px-6">
        <div className="container mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8 max-w-6xl mx-auto">
            {data.services.map((service, i) => (
              <div key={i} className="group border-2 border-[#f4a100] p-6 md:p-12 text-center flex flex-col items-center hover:bg-[#1a1a1a] transition-all duration-500">
                <div className="mb-4 md:mb-8 transform group-hover:scale-110 transition-transform duration-300">
                  {getServiceIcon(service.icon)}
                </div>
                <h3 className="font-montserrat font-black text-white text-base md:text-xl tracking-[1.5px] mb-2 uppercase">{service.title}</h3>
                <p className="text-[#f4a100] text-[9px] md:text-[11px] font-bold tracking-[2px] mb-3 md:mb-4 uppercase">{service.subtitle}</p>
                <p className="text-[#999999] text-xs md:text-sm leading-relaxed">{service.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery Section */}
      <section className="bg-[#1a1a1a]">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {data.gallery.slice(4, 8).map((img, i) => (
            <div key={i} className="aspect-square relative group overflow-hidden">
              <img src={img} alt={`Gallery Style ${i}`} className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700" />
            </div>
          ))}
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact-us" className="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
        <div className="container mx-auto flex flex-col lg:flex-row max-w-6xl shadow-2xl overflow-hidden bg-[#1a1a1a]">
          <div className="lg:w-1/2 p-8 md:p-20 flex flex-col justify-center bg-[#1a1a1a]">
            <h2 className="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]">Contact Us</h2>
            <div className="space-y-6 md:space-y-10">
              <div className="flex gap-4 md:gap-6">
                <MapPinIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100] shrink-0" />
                <div>
                  <h4 className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">ADDRESS</h4>
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed">{data.contact.address}</p>
                </div>
              </div>
              <a href={`tel:${formattedPhone}`} className="flex gap-4 md:gap-6 group">
                <PhoneIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100] shrink-0 group-hover:scale-110 transition-transform" />
                <div>
                  <h4 className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">PHONE</h4>
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed group-hover:text-white transition-colors">{data.phone}</p>
                </div>
              </a>
              <div className="flex gap-4 md:gap-6">
                <MailIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100] shrink-0" />
                <div>
                  <h4 className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">EMAIL</h4>
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed">{data.contact.email}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div className="lg:w-1/2 p-8 md:p-20 bg-[#0d0d0d] flex flex-col justify-center border-t lg:border-t-0 lg:border-l border-white/5">
            <span className="text-[#f4a100] text-[10px] md:text-xs font-bold tracking-[4px] uppercase mb-3 font-montserrat opacity-80">Get In Touch</span>
            <h2 className="text-xl md:text-3xl font-montserrat font-black text-white mb-6 md:mb-10 tracking-[2px] uppercase">Send a Message</h2>
            <form className="space-y-4 md:space-y-6">
              <input type="text" placeholder="Your Name" className="w-full bg-transparent border-b border-white/20 py-2 md:py-4 outline-none focus:border-[#f4a100] transition-colors text-sm placeholder:text-white/20" />
              <input type="email" placeholder="Your Email" className="w-full bg-transparent border-b border-white/20 py-2 md:py-4 outline-none focus:border-[#f4a100] transition-colors text-sm placeholder:text-white/20" />
              <textarea placeholder="Your Message" rows={2} className="w-full bg-transparent border-b border-white/20 py-2 md:py-4 outline-none focus:border-[#f4a100] transition-colors resize-none text-sm placeholder:text-white/20"></textarea>
              <button className="w-full py-4 md:py-5 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black tracking-[3px] uppercase hover:bg-white transition-colors duration-300 shadow-lg mt-4 text-xs md:text-base">
                Submit Request
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 md:py-20 bg-[#0a0a0a] border-t border-white/5 text-center">
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-center gap-2 md:gap-3 mb-3 md:mb-4">
            <ScissorsIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />
            <span className="font-montserrat font-black text-sm md:text-2xl tracking-[2px] md:tracking-[4px] uppercase">
              {data.shopName.split(' ')[0]} <span className="text-[#f4a100]">{data.shopName.split(' ').slice(1).join(' ')}</span>
            </span>
          </div>
          <p className="text-[#666666] text-[8px] md:text-xs uppercase tracking-[2px] md:tracking-[4px] mb-8 md:mb-12 max-w-lg mx-auto leading-loose px-4">
            Premium Grooming Excellence in {data.area}
          </p>
          
          <div className="pt-8 md:pt-10 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
            Copyright &copy; 2025 {data.shopName}. Built by Prime Barber AI.
          </div>
        </div>
      </footer>

      {/* Stripe Payment Popup */}
      <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-[60] scale-[0.85] md:scale-100 origin-bottom-right">
        <div className="bg-[#f4a100] text-[#1a1a1a] p-4 md:p-6 shadow-2xl rounded-sm border border-[#1a1a1a]/20 max-w-[220px] md:max-w-[280px]">
          <h5 className="font-montserrat font-black text-[10px] md:text-sm tracking-widest uppercase mb-1 md:mb-2">Claim Custom Barber Site</h5>
          <p className="text-[9px] md:text-[11px] font-bold uppercase mb-3 md:mb-4 opacity-90 leading-tight">Claim this website forever for only $10/month hosting.</p>
          <button
            onClick={handleClaimWebsite}
            className="block w-full text-center py-2 bg-[#1a1a1a] text-[#f4a100] text-[9px] md:text-[10px] font-bold tracking-widest uppercase hover:bg-black transition-colors cursor-pointer"
          >
            GET FULL ACCESS
          </button>
          <p className="text-[6px] md:text-[8px] mt-2 opacity-70 uppercase tracking-tighter text-center italic">
            The Prime Barber team can edit the site after purchase
          </p>
        </div>
      </div>
    </div>
  );
};
