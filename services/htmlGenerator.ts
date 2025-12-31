import { WebsiteData } from '../types';

export function generateHTML(data: WebsiteData): string {
  const formattedPhone = data.phone.replace(/\s+/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.shopName} - Premium Barbershop in ${data.area}</title>
  <meta name="description" content="Premium grooming services at ${data.shopName} in ${data.area}. Expert barbers, luxury experience.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700;900&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Montserrat', sans-serif; }
    html { scroll-behavior: smooth; }
  </style>
</head>
<body class="bg-[#0d0d0d] text-white overflow-x-hidden">

  <!-- Header -->
  <header id="header" class="fixed top-0 left-0 w-full z-50 transition-all duration-300 bg-black/20 py-5 md:py-8">
    <div class="container mx-auto flex justify-between items-center px-4 md:px-6">
      <div class="flex items-center gap-4 md:gap-8">
        <div class="flex items-center gap-3 md:gap-5">
          <svg class="w-8 h-8 md:w-12 md:h-12 text-[#f4a100]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M6 18L18 6"></path>
          </svg>
          <span class="font-montserrat font-black text-lg md:text-3xl lg:text-4xl tracking-[1px] md:tracking-[2px] uppercase whitespace-nowrap">
            ${data.shopName.split(' ')[0]} <span class="text-[#f4a100]">${data.shopName.split(' ').slice(1).join(' ')}</span>
          </span>
        </div>

        <a href="tel:${formattedPhone}" class="flex items-center gap-2 md:gap-4 text-[#f4a100] border-l-2 border-white/20 pl-4 md:pl-8 hover:text-white transition-colors">
          <svg class="w-5 h-5 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
          </svg>
          <span class="text-sm md:text-xl lg:text-2xl font-bold tracking-tight">${data.phone}</span>
        </a>
      </div>

      <nav class="flex items-center gap-4 md:gap-10">
        <div class="hidden lg:flex items-center gap-10">
          <a href="#home" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">HOME</a>
          <a href="#services" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">SERVICES</a>
          <a href="#contact" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">CONTACT</a>
        </div>
      </nav>
    </div>
  </header>

  <!-- Hero Section -->
  <section id="home" class="relative h-screen flex flex-col justify-center items-center overflow-hidden">
    <div class="absolute inset-0 z-0">
      <img src="${data.hero.imageUrl}" alt="Main Hero" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-black/70 bg-gradient-to-b from-black/60 via-transparent to-[#0d0d0d]"></div>
    </div>

    <div class="relative z-10 text-center px-4 md:px-6 max-w-5xl -mt-20 md:mt-0">
      <p class="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
        ${data.hero.tagline}
      </p>

      <h1 class="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
        ${data.hero.heading}
      </h1>

      <a href="tel:${formattedPhone}" class="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base">
        <span>Call Now: ${data.phone}</span>
      </a>
    </div>
  </section>

  <!-- About Section -->
  <section id="about-us" class="py-12 md:py-32 px-6 bg-[#1a1a1a]">
    <div class="container mx-auto grid lg:grid-cols-2 gap-10 md:gap-20 items-center">
      <div class="relative">
        <div class="flex items-center gap-3 mb-4 md:mb-6">
          <span class="text-[#f4a100] text-[10px] md:text-xs font-bold tracking-[3px] md:tracking-[4px] uppercase font-montserrat">About Us</span>
        </div>
        <h2 class="text-2xl md:text-5xl font-montserrat font-black text-white mb-6 md:mb-8 leading-tight uppercase tracking-[2px]">
          ${data.about.heading}
        </h2>
        <div class="space-y-4 md:space-y-6 text-[#cccccc] font-light leading-relaxed text-sm md:text-base">
          ${data.about.description.map(p => `<p>${p}</p>`).join('')}
        </div>
      </div>
      <div class="relative group mt-6 lg:mt-0">
        <img src="${data.about.imageUrl}" alt="Barber Shop Atmosphere" class="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl">
      </div>
    </div>
  </section>

  <!-- Services Section -->
  <section id="services" class="py-12 md:py-32 bg-[#0d0d0d] px-6">
    <div class="container mx-auto">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8 max-w-6xl mx-auto">
        ${data.services.map(service => `
          <div class="group border-2 border-[#f4a100] p-6 md:p-12 text-center flex flex-col items-center hover:bg-[#1a1a1a] transition-all duration-500">
            <div class="mb-4 md:mb-8 transform group-hover:scale-110 transition-transform duration-300">
              <svg class="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 6l12 12M6 18L18 6"></path>
              </svg>
            </div>
            <h3 class="font-montserrat font-black text-white text-base md:text-xl tracking-[1.5px] mb-2 uppercase">${service.title}</h3>
            <p class="text-[#f4a100] text-[9px] md:text-[11px] font-bold tracking-[2px] mb-3 md:mb-4 uppercase">${service.subtitle}</p>
            <p class="text-[#999999] text-xs md:text-sm leading-relaxed">${service.description}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  <!-- Gallery Section -->
  <section class="bg-[#1a1a1a]">
    <div class="grid grid-cols-2 lg:grid-cols-4">
      ${data.gallery.slice(4, 8).map((img, i) => `
        <div class="aspect-square relative group overflow-hidden">
          <img src="${img}" alt="Gallery ${i}" class="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700">
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Contact Section -->
  <section id="contact" class="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
    <div class="container mx-auto flex flex-col lg:flex-row max-w-6xl shadow-2xl overflow-hidden bg-[#1a1a1a]">
      <div class="lg:w-1/2 p-8 md:p-20 flex flex-col justify-center bg-[#1a1a1a]">
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]">Contact Us</h2>
        <div class="space-y-6 md:space-y-10">
          <div class="flex gap-4 md:gap-6">
            <div>
              <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">ADDRESS</h4>
              <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${data.contact.address}</p>
            </div>
          </div>
          <a href="tel:${formattedPhone}" class="flex gap-4 md:gap-6 group">
            <div>
              <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">PHONE</h4>
              <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed group-hover:text-white transition-colors">${data.phone}</p>
            </div>
          </a>
          <div class="flex gap-4 md:gap-6">
            <div>
              <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">EMAIL</h4>
              <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${data.contact.email}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-12 md:py-20 bg-[#0a0a0a] border-t border-white/5 text-center">
    <div class="container mx-auto px-6">
      <div class="flex items-center justify-center gap-2 md:gap-3 mb-3 md:mb-4">
        <span class="font-montserrat font-black text-sm md:text-2xl tracking-[2px] md:tracking-[4px] uppercase">
          ${data.shopName.split(' ')[0]} <span class="text-[#f4a100]">${data.shopName.split(' ').slice(1).join(' ')}</span>
        </span>
      </div>
      <p class="text-[#666666] text-[8px] md:text-xs uppercase tracking-[2px] md:tracking-[4px] mb-8 md:mb-12 max-w-lg mx-auto leading-loose px-4">
        Premium Grooming Excellence in ${data.area}
      </p>

      <div class="pt-8 md:pt-10 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
        Copyright &copy; 2025 ${data.shopName}. Built by Prime Barber AI.
      </div>
    </div>
  </footer>

  <script>
    // Header scroll effect
    window.addEventListener('scroll', () => {
      const header = document.getElementById('header');
      if (window.scrollY > 20) {
        header.classList.remove('bg-black/20', 'py-5', 'md:py-8');
        header.classList.add('bg-[#1a1a1a]/95', 'backdrop-blur-md', 'shadow-xl', 'py-3', 'md:py-4');
      } else {
        header.classList.add('bg-black/20', 'py-5', 'md:py-8');
        header.classList.remove('bg-[#1a1a1a]/95', 'backdrop-blur-md', 'shadow-xl', 'py-3', 'md:py-4');
      }
    });
  </script>
</body>
</html>`;
}
