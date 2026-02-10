
import React, { useEffect, useMemo, useState } from 'react';
import { WebsiteData } from '../types';
import {
  ScissorsIcon, RazorIcon, MustacheIcon, FaceIcon,
  MapPinIcon, AwardIcon, ClockIcon, PhoneIcon, MailIcon,
  CameraIcon
} from './Icons';

interface GeneratedWebsiteProps {
  data: WebsiteData;
  onBack: () => void;
}

// Exported so App.tsx can reuse it for post-payment deploy
export function generateHTMLWithPlaceholders(siteData: WebsiteData): string {
  const formattedPhone = siteData.phone.replace(/\s+/g, '');

  // Master Barbers section uses gallery[2-5]
  const masterBarberImages = siteData.gallery
    .slice(2, 6)
    .map((url, i) => ({ url, index: i + 2 }))
    .filter(item => item.url);

  const masterBarbersSection = masterBarberImages.length > 0
    ? `<section class="py-16 md:py-32 bg-[#0d0d0d] px-6 border-y border-white/5 relative overflow-hidden">
    <div class="absolute top-0 right-0 w-1/3 h-full bg-[#1a1a1a] -z-10 transform skew-x-12 translate-x-32 hidden lg:block"></div>
    <div class="container mx-auto">
      <div class="flex flex-col lg:flex-row items-center gap-12 lg:gap-20">
        <div class="lg:w-1/2">
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-4">
              ${siteData.gallery[2] ? `<div class="bg-[#1a1a1a] p-1 border border-white/5"><img src="{{gallery2}}" alt="Professional Barber Tools" class="w-full h-40 md:h-64 object-cover"></div>` : ''}
              ${siteData.gallery[3] ? `<div class="bg-[#1a1a1a] p-1 border border-white/5"><img src="{{gallery3}}" alt="Clean Haircut Detail" class="w-full h-32 md:h-48 object-cover"></div>` : ''}
            </div>
            <div class="space-y-4 pt-8">
              ${siteData.gallery[4] ? `<div class="bg-[#1a1a1a] p-1 border border-white/5"><img src="{{gallery4}}" alt="Shaving Ritual" class="w-full h-32 md:h-48 object-cover"></div>` : ''}
              ${siteData.gallery[5] ? `<div class="bg-[#1a1a1a] p-1 border border-white/5"><img src="{{gallery5}}" alt="Hair Styling Session" class="w-full h-40 md:h-64 object-cover"></div>` : ''}
            </div>
          </div>
        </div>
        <div class="lg:w-1/2">
          <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4">Master Barbers</h3>
          <h2 class="text-3xl md:text-5xl font-montserrat font-black text-white leading-tight uppercase tracking-[2px] mb-8">The Pinnacle of <br> Professional Craftsmanship</h2>
          <div class="space-y-8">
            <div class="flex items-start gap-6">
              <div class="bg-[#1a1a1a] p-3 rounded-full border border-[#f4a100]/30 shrink-0">
                <svg class="w-6 h-6 text-[#f4a100]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"></path></svg>
              </div>
              <div>
                <h4 class="text-white font-montserrat font-bold text-lg uppercase mb-2">Signature Cuts</h4>
                <p class="text-[#888888] leading-relaxed">Our master barbers blend classic techniques with modern trends to create styles that define your personality.</p>
              </div>
            </div>
            <div class="flex items-start gap-6">
              <div class="bg-[#1a1a1a] p-3 rounded-full border border-[#f4a100]/30 shrink-0">
                <svg class="w-6 h-6 text-[#f4a100]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"></path></svg>
              </div>
              <div>
                <h4 class="text-white font-montserrat font-bold text-lg uppercase mb-2">Artisan Shaves</h4>
                <p class="text-[#888888] leading-relaxed">Experience the ritual of a traditional hot-towel shave, utilizing the world's finest blades and soothing balsams.</p>
              </div>
            </div>
            <div class="flex items-start gap-6">
              <div class="bg-[#1a1a1a] p-3 rounded-full border border-[#f4a100]/30 shrink-0">
                <svg class="w-6 h-6 text-[#f4a100]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M6 18L18 6"></path></svg>
              </div>
              <div>
                <h4 class="text-white font-montserrat font-bold text-lg uppercase mb-2">Elite Consulting</h4>
                <p class="text-[#888888] leading-relaxed">We don't just cut hair; we analyze your face shape and hair type to recommend the perfect look for your lifestyle.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>`
    : '';

  const aboutImageSection = siteData.about.imageUrl
    ? `<div class="relative group mt-6 lg:mt-0">
        <img src="{{about}}" alt="Barber Shop Atmosphere" class="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl">
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteData.shopName} - Premium Barbershop in ${siteData.area}</title>
  <meta name="description" content="Premium grooming services at ${siteData.shopName} in ${siteData.area}. Expert barbers, luxury experience.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700;900&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="styles.css">
  <style>
    * { font-family: 'Montserrat', sans-serif; }
    html { scroll-behavior: smooth; }
  </style>
</head>
<body class="bg-[#0d0d0d] text-white overflow-x-hidden">
  <header id="header" class="fixed top-0 left-0 w-full z-50 transition-all duration-300 bg-black/20 py-5 md:py-8">
    <div class="container mx-auto flex justify-between items-center px-4 md:px-6">
      <div class="flex items-center gap-4 md:gap-8">
        <div class="flex items-center gap-3 md:gap-5">
          <svg class="w-8 h-8 md:w-12 md:h-12 text-[#f4a100]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M6 18L18 6"></path>
          </svg>
          <span class="font-montserrat font-black text-lg md:text-3xl lg:text-4xl tracking-[1px] md:tracking-[2px] uppercase whitespace-nowrap">
            ${siteData.shopName.split(' ')[0]} <span class="text-[#f4a100]">${siteData.shopName.split(' ').slice(1).join(' ')}</span>
          </span>
        </div>
        <a href="tel:${formattedPhone}" class="flex items-center gap-2 md:gap-4 text-[#f4a100] border-l-2 border-white/20 pl-4 md:pl-8 hover:text-white transition-colors">
          <svg class="w-5 h-5 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
          </svg>
          <span class="text-sm md:text-xl lg:text-2xl font-bold tracking-tight">${siteData.phone}</span>
        </a>
      </div>
      <nav class="hidden lg:flex items-center gap-10">
        <a href="#home" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">HOME</a>
        <a href="#services" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">SERVICES</a>
        <a href="#contact" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">CONTACT</a>
      </nav>
    </div>
  </header>

  <section id="home" class="relative h-screen flex flex-col justify-center items-center overflow-hidden">
    <div class="absolute inset-0 z-0">
      <img src="{{hero}}" alt="Main Hero" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-black/70 bg-gradient-to-b from-black/60 via-transparent to-[#0d0d0d]"></div>
    </div>
    <div class="relative z-10 text-center px-4 md:px-6 max-w-5xl -mt-20 md:mt-0">
      <p class="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
        ${siteData.hero.tagline}
      </p>
      <h1 class="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
        ${siteData.hero.heading}
      </h1>
      <a href="tel:${formattedPhone}" class="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base">
        <span>Call Now: ${siteData.phone}</span>
      </a>
    </div>
  </section>

  <section id="about-us" class="py-12 md:py-32 px-6 bg-[#1a1a1a]">
    <div class="container mx-auto grid ${siteData.about.imageUrl ? 'lg:grid-cols-2' : ''} gap-10 md:gap-20 items-center">
      <div class="relative">
        <h2 class="text-2xl md:text-5xl font-montserrat font-black text-white mb-6 md:mb-8 leading-tight uppercase tracking-[2px]">
          ${siteData.about.heading}
        </h2>
        <div class="space-y-4 md:space-y-6 text-[#cccccc] font-light leading-relaxed text-sm md:text-base">
          ${siteData.about.description.map(p => `<p>${p}</p>`).join('')}
        </div>
      </div>
      ${aboutImageSection}
    </div>
  </section>

  <section id="services" class="py-12 md:py-32 bg-[#0d0d0d] px-6">
    <div class="container mx-auto">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8 max-w-6xl mx-auto">
        ${siteData.services.map(service => `
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

  ${masterBarbersSection}

  <section id="contact" class="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
    <div class="container mx-auto max-w-6xl bg-[#1a1a1a] p-8 md:p-20">
      <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]">Contact Us</h2>
      <div class="space-y-6 md:space-y-10">
        <div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">ADDRESS</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${siteData.contact.address}</p>
        </div>
        <div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">PHONE</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${siteData.phone}</p>
        </div>
        <div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">EMAIL</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${siteData.contact.email}</p>
        </div>
      </div>
    </div>
  </section>

  <footer class="py-12 md:py-20 bg-[#0a0a0a] border-t border-white/5 text-center">
    <div class="container mx-auto px-6">
      <span class="font-montserrat font-black text-sm md:text-2xl tracking-[2px] md:tracking-[4px] uppercase">
        ${siteData.shopName.split(' ')[0]} <span class="text-[#f4a100]">${siteData.shopName.split(' ').slice(1).join(' ')}</span>
      </span>
      <p class="text-[#666666] text-[8px] md:text-xs uppercase tracking-[2px] md:tracking-[4px] mt-8 mb-12">
        Premium Grooming Excellence in ${siteData.area}
      </p>
      <div class="pt-8 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
        Copyright &copy; 2025 ${siteData.shopName}. Built by Prime Barber AI.
      </div>
    </div>
  </footer>

  <script>
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

export const GeneratedWebsite: React.FC<GeneratedWebsiteProps> = ({ data, onBack }) => {
  const [siteData, setSiteData] = useState<WebsiteData>(data);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResult, setDeploymentResult] = useState<{
    error?: string;
  } | null>(null);

  // Derive URL-friendly slug from shop name (updates live as user edits)
  const siteSlug = useMemo(() => {
    return siteData.shopName
      .toLowerCase()
      .replace(/[''`]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }, [siteData.shopName]);

  // Handle text changes (deep-clone nested objects so React detects the update)
  const handleTextChange = (path: string, value: string) => {
    const newData = { ...siteData };
    const parts = path.split('.');

    // Deep-clone the nested object being modified
    if (parts[0] === 'hero') newData.hero = { ...newData.hero };
    else if (parts[0] === 'about') newData.about = { ...newData.about };
    else if (parts[0] === 'gallery') newData.gallery = [...newData.gallery];
    else if (parts[0] === 'contact') newData.contact = { ...newData.contact };
    else if (parts[0] === 'services') newData.services = [...newData.services];

    let current: any = newData;
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = value;
    setSiteData(newData);
  };

  // Compress image client-side to avoid 413 payload errors on serverless
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX_DIM = 1200;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  };

  // Handle image changes (deep-clone nested objects so React detects the update)
  const handleImageChange = async (path: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const base64String = await compressImage(file);
        const newData = { ...siteData };
        const parts = path.split('.');

        // Deep-clone the nested object being modified
        if (parts[0] === 'hero') newData.hero = { ...newData.hero };
        else if (parts[0] === 'about') newData.about = { ...newData.about };
        else if (parts[0] === 'gallery') newData.gallery = [...newData.gallery];

        let current: any = newData;
        for (let i = 0; i < parts.length - 1; i++) {
          current = current[parts[i]];
        }

        current[parts[parts.length - 1]] = base64String;
        setSiteData(newData);
      } catch (err) {
        console.error('Image compression failed:', err);
      }
    }
  };

  // ContentEditable component wrapper for convenience
  const EditableText = ({ text, onSave, className = "", tagName: Tag = "span" }: { text: string, onSave: (val: string) => void, className?: string, tagName?: any }) => (
    <Tag
      contentEditable
      suppressContentEditableWarning
      onBlur={(e: any) => onSave(e.target.innerText)}
      className={`outline-none focus:ring-1 focus:ring-[#f4a100]/50 rounded px-1 -mx-1 transition-all ${className}`}
    >
      {text}
    </Tag>
  );

  // Image replacement overlay component (for existing images)
  const ImageOverlay = ({ onImageUpload, className = "" }: { onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void, className?: string }) => (
    <div className={`absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-10 ${className}`}>
      <label className="cursor-pointer flex flex-col items-center gap-2">
        <CameraIcon className="w-8 h-8 text-white" />
        <span className="text-white text-[10px] md:text-xs font-bold uppercase tracking-wider">Replace Image</span>
        <input type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
      </label>
    </div>
  );

  // "Add Your Own Image" placeholder for empty image slots
  const ImagePlaceholder = ({ onImageUpload, heightClass = "h-64" }: { onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void, heightClass?: string }) => (
    <label className={`cursor-pointer flex flex-col items-center justify-center w-full ${heightClass} bg-[#1a1a1a] border-2 border-dashed border-[#f4a100]/30 hover:border-[#f4a100] transition-all`}>
      <CameraIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]/50 mb-3" />
      <span className="text-[#f4a100]/70 text-[10px] md:text-xs font-bold uppercase tracking-wider">Add Your Own Image</span>
      <input type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
    </label>
  );

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

  const handleClaimSite = async () => {
    setIsDeploying(true);
    setDeploymentResult(null);

    try {
      // Use the pre-computed slug as siteId (matches the URL preview shown to the user)
      const siteId = siteSlug;

      // Step 1: Prepare images to upload (only base64 data URLs)
      const imagesToUpload: Array<{ key: string; filename: string; base64: string }> = [];

      if (siteData.hero.imageUrl && siteData.hero.imageUrl.startsWith('data:')) {
        imagesToUpload.push({ key: 'hero', filename: 'hero.jpg', base64: siteData.hero.imageUrl });
      }
      if (siteData.about.imageUrl && siteData.about.imageUrl.startsWith('data:')) {
        imagesToUpload.push({ key: 'about', filename: 'about.jpg', base64: siteData.about.imageUrl });
      }
      siteData.gallery.forEach((imageUrl, index) => {
        if (imageUrl && imageUrl.startsWith('data:')) {
          imagesToUpload.push({ key: `gallery${index}`, filename: `gallery-${index}.jpg`, base64: imageUrl });
        }
      });

      // Step 2: Upload images to GCS via proxy
      const imageUrlMap: Record<string, string> = {};

      if (imagesToUpload.length > 0) {
        console.log(`[Claim] Uploading ${imagesToUpload.length} images via proxy...`);

        await Promise.all(
          imagesToUpload.map(async (image) => {
            const uploadResponse = await fetch('/api/upload-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ siteId, filename: image.filename, base64: image.base64 }),
            });

            if (!uploadResponse.ok) {
              const errText = await uploadResponse.text().catch(() => '');
              throw new Error(`[Upload ${image.filename}] HTTP ${uploadResponse.status}: ${errText}`);
            }

            const { publicUrl } = await uploadResponse.json();
            imageUrlMap[image.key] = publicUrl;
            console.log(`[Claim] Uploaded ${image.key} -> ${publicUrl}`);
          })
        );
      }

      // Also include images that are already GCS URLs
      if (siteData.hero.imageUrl && siteData.hero.imageUrl.startsWith('http')) {
        imageUrlMap['hero'] = siteData.hero.imageUrl;
      }
      if (siteData.about.imageUrl && siteData.about.imageUrl.startsWith('http')) {
        imageUrlMap['about'] = siteData.about.imageUrl;
      }
      siteData.gallery.forEach((url, index) => {
        if (url && url.startsWith('http')) {
          imageUrlMap[`gallery${index}`] = url;
        }
      });

      // Step 3: Save to localStorage (text + GCS URLs only, no base64)
      const pendingSite = {
        siteId,
        siteData: {
          ...siteData,
          hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] ? 'uploaded' : '' },
          about: { ...siteData.about, imageUrl: imageUrlMap['about'] ? 'uploaded' : '' },
          gallery: siteData.gallery.map((_, i) => imageUrlMap[`gallery${i}`] ? 'uploaded' : ''),
          services: siteData.services.map(s => ({ ...s, imageUrl: '' })),
        },
        imageUrlMap,
        timestamp: Date.now(),
      };

      localStorage.setItem('pendingSite', JSON.stringify(pendingSite));
      console.log('[Claim] Saved pending site to localStorage, redirecting to Stripe...');

      // Step 4: Redirect to Stripe Payment Link
      window.location.href = `https://buy.stripe.com/test_eVq5kC8e016e5N05Ma3cc01?client_reference_id=${encodeURIComponent(siteId)}`;

    } catch (error: any) {
      console.error('Claim site error:', error);
      setDeploymentResult({ error: error.message || 'Failed to prepare site for payment.' });
      setIsDeploying(false);
    }
  };

  const formattedPhone = siteData.phone.replace(/\s+/g, '');

  return (
    <div className="bg-[#0d0d0d] text-white overflow-hidden scroll-smooth pt-[40px] md:pt-[50px]">
      {/* Instructional Banner */}
      <div className="fixed top-0 left-0 w-full bg-[#cc0000] text-white py-2 md:py-3 px-4 z-[70] text-center shadow-lg">
        <p className="text-[10px] md:text-sm font-bold uppercase tracking-wider flex items-center justify-center gap-2">
          <span className="shrink-0">Text and images can be edited. Once ready, click Claim Site to start $10/month website hosting and launch your site.</span>
        </p>
      </div>

      {/* Header */}
      <header className={`fixed top-[40px] md:top-[50px] left-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-[#1a1a1a]/95 backdrop-blur-md shadow-xl py-3 md:py-4' : 'bg-black/20 py-5 md:py-8'}`}>
        <div className="container mx-auto flex justify-between items-center px-4 md:px-6">
          <div className="flex items-center gap-4 md:gap-8">
            <div className="flex items-center gap-3 md:gap-5">
              <ScissorsIcon className="w-8 h-8 md:w-12 md:h-12 text-[#f4a100]" />
              <span className="font-montserrat font-black text-lg md:text-3xl lg:text-4xl tracking-[1px] md:tracking-[2px] uppercase whitespace-nowrap">
                <EditableText
                  text={siteData.shopName.split(' ')[0]}
                  onSave={(val) => {
                    const rest = siteData.shopName.split(' ').slice(1).join(' ');
                    handleTextChange('shopName', `${val} ${rest}`);
                  }}
                /> <span className="text-[#f4a100]">
                  <EditableText
                    text={siteData.shopName.split(' ').slice(1).join(' ')}
                    onSave={(val) => {
                      const first = siteData.shopName.split(' ')[0];
                      handleTextChange('shopName', `${first} ${val}`);
                    }}
                  />
                </span>
              </span>
            </div>

            <a
              href={`tel:${formattedPhone}`}
              className="flex items-center gap-2 md:gap-4 text-[#f4a100] border-l-2 border-white/20 pl-4 md:pl-8 hover:text-white transition-colors hidden sm:flex"
            >
              <PhoneIcon className="w-5 h-5 md:w-7 md:h-7" />
              <span className="text-sm md:text-xl lg:text-2xl font-bold tracking-tight">
                <EditableText text={siteData.phone} onSave={(val) => handleTextChange('phone', val)} />
              </span>
            </a>
          </div>

          <div className="flex items-center">
            <button
              onClick={onBack}
              className="px-4 py-2 md:px-7 md:py-3 border-2 border-[#f4a100] text-[#f4a100] text-[10px] md:text-[13px] font-black uppercase tracking-widest hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all"
            >
              BACK
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="home" className="relative h-screen flex flex-col justify-center items-center overflow-hidden">
        <div className="absolute inset-0 z-0 group">
          {siteData.hero.imageUrl ? (
            <>
              <img src={siteData.hero.imageUrl} alt="Main Hero" className="w-full h-full object-cover" />
              <ImageOverlay onImageUpload={(e) => handleImageChange('hero.imageUrl', e)} />
            </>
          ) : (
            <ImagePlaceholder onImageUpload={(e) => handleImageChange('hero.imageUrl', e)} heightClass="h-full" />
          )}
          <div className="absolute inset-0 bg-black/70 bg-gradient-to-b from-black/60 via-transparent to-[#0d0d0d] pointer-events-none"></div>
        </div>

        <div className="relative z-10 text-center px-4 md:px-6 max-w-5xl -mt-20 md:mt-0">
          <p className="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
            <EditableText text={siteData.hero.tagline} onSave={(val) => handleTextChange('hero.tagline', val)} />
          </p>

          <h1 className="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
            <EditableText text={siteData.hero.heading} onSave={(val) => handleTextChange('hero.heading', val)} />
          </h1>

          <a
            href={`tel:${formattedPhone}`}
            className="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base"
          >
            <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 group-hover:scale-110 transition-transform" />
            <span>Call Now: <EditableText text={siteData.phone} onSave={(val) => handleTextChange('phone', val)} /></span>
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
              <EditableText text={siteData.about.heading} onSave={(val) => handleTextChange('about.heading', val)} />
            </h2>
            <div className="space-y-4 md:space-y-6 text-[#cccccc] font-light leading-relaxed text-sm md:text-base">
              {siteData.about.description.map((p, i) => (
                <div key={i}>
                  <EditableText
                    text={p}
                    tagName="p"
                    onSave={(val) => {
                      const newDesc = [...siteData.about.description];
                      newDesc[i] = val;
                      handleTextChange('about.description', newDesc as any);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="relative group mt-6 lg:mt-0">
            <div className="absolute -inset-2 md:-inset-4 border border-[#f4a100]/30 -z-10 transform translate-x-2 translate-y-2 md:translate-x-4 md:translate-y-4 transition-transform duration-500"></div>
            {siteData.about.imageUrl ? (
              <>
                <img src={siteData.about.imageUrl} alt="Barber Shop Atmosphere" className="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl" />
                <ImageOverlay onImageUpload={(e) => handleImageChange('about.imageUrl', e)} />
              </>
            ) : (
              <ImagePlaceholder onImageUpload={(e) => handleImageChange('about.imageUrl', e)} heightClass="h-64 md:h-96" />
            )}
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
                  <div className="bg-[#1a1a1a] p-1 border border-white/5 relative group">
                    {siteData.gallery[2] ? (
                      <>
                        <img src={siteData.gallery[2]} alt="Professional Barber Tools" className="w-full h-40 md:h-64 object-cover" />
                        <ImageOverlay onImageUpload={(e) => handleImageChange('gallery.2', e)} />
                      </>
                    ) : (
                      <ImagePlaceholder onImageUpload={(e) => handleImageChange('gallery.2', e)} heightClass="h-40 md:h-64" />
                    )}
                  </div>
                  <div className="bg-[#1a1a1a] p-1 border border-white/5 relative group">
                    {siteData.gallery[3] ? (
                      <>
                        <img src={siteData.gallery[3]} alt="Clean Haircut Detail" className="w-full h-32 md:h-48 object-cover" />
                        <ImageOverlay onImageUpload={(e) => handleImageChange('gallery.3', e)} />
                      </>
                    ) : (
                      <ImagePlaceholder onImageUpload={(e) => handleImageChange('gallery.3', e)} heightClass="h-32 md:h-48" />
                    )}
                  </div>
                </div>
                <div className="space-y-4 pt-8">
                  <div className="bg-[#1a1a1a] p-1 border border-white/5 relative group">
                    {siteData.gallery[4] ? (
                      <>
                        <img src={siteData.gallery[4]} alt="Shaving Ritual" className="w-full h-32 md:h-48 object-cover" />
                        <ImageOverlay onImageUpload={(e) => handleImageChange('gallery.4', e)} />
                      </>
                    ) : (
                      <ImagePlaceholder onImageUpload={(e) => handleImageChange('gallery.4', e)} heightClass="h-32 md:h-48" />
                    )}
                  </div>
                  <div className="bg-[#1a1a1a] p-1 border border-white/5 relative group">
                    {siteData.gallery[5] ? (
                      <>
                        <img src={siteData.gallery[5]} alt="Hair Styling Session" className="w-full h-40 md:h-64 object-cover" />
                        <ImageOverlay onImageUpload={(e) => handleImageChange('gallery.5', e)} />
                      </>
                    ) : (
                      <ImagePlaceholder onImageUpload={(e) => handleImageChange('gallery.5', e)} heightClass="h-40 md:h-64" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:w-1/2 order-1 lg:order-2">
              <h3 className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4">Master Barbers</h3>
              <h2 className="text-3xl md:text-5xl font-montserrat font-black text-white leading-tight uppercase tracking-[2px] mb-8">
                The Pinnacle of <br /> Professional Craftsmanship
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
            {siteData.services.map((service, i) => (
              <div key={i} className="group border-2 border-[#f4a100] p-6 md:p-12 text-center flex flex-col items-center hover:bg-[#1a1a1a] transition-all duration-500">
                <div className="mb-4 md:mb-8 transform group-hover:scale-110 transition-transform duration-300">
                  {getServiceIcon(service.icon)}
                </div>
                <h3 className="font-montserrat font-black text-white text-base md:text-xl tracking-[1.5px] mb-2 uppercase">
                  <EditableText
                    text={service.title}
                    onSave={(val) => {
                      const newServices = [...siteData.services];
                      newServices[i].title = val;
                      handleTextChange('services', newServices as any);
                    }}
                  />
                </h3>
                <p className="text-[#f4a100] text-[9px] md:text-[11px] font-bold tracking-[2px] mb-3 md:mb-4 uppercase">
                  <EditableText
                    text={service.subtitle}
                    onSave={(val) => {
                      const newServices = [...siteData.services];
                      newServices[i].subtitle = val;
                      handleTextChange('services', newServices as any);
                    }}
                  />
                </p>
                <p className="text-[#999999] text-xs md:text-sm leading-relaxed">
                  <EditableText
                    text={service.description}
                    onSave={(val) => {
                      const newServices = [...siteData.services];
                      newServices[i].description = val;
                      handleTextChange('services', newServices as any);
                    }}
                  />
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Section */}
      <section id="contact-us" className="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
        <div className="container mx-auto max-w-4xl shadow-2xl overflow-hidden bg-[#1a1a1a]">
          <div className="w-full p-8 md:p-20 flex flex-col items-center text-center bg-[#1a1a1a]">
            <h2 className="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]">Visit Us</h2>
            <div className="grid md:grid-cols-3 gap-8 md:gap-12 w-full">
              <div className="flex flex-col items-center gap-4">
                <MapPinIcon className="w-8 h-8 text-[#f4a100]" />
                <div>
                  <h4 className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-2 font-montserrat uppercase">Location</h4>
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed">
                    <EditableText text={siteData.contact.address} onSave={(val) => handleTextChange('contact.address', val)} />
                  </p>
                </div>
              </div>
              <a href={`tel:${formattedPhone}`} className="flex flex-col items-center gap-4 group">
                <PhoneIcon className="w-8 h-8 text-[#f4a100] group-hover:scale-110 transition-transform" />
                <div>
                  <h4 className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-2 font-montserrat uppercase">Phone</h4>
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed group-hover:text-white transition-colors">
                    <EditableText text={siteData.phone} onSave={(val) => handleTextChange('phone', val)} />
                  </p>
                </div>
              </a>
              <div className="flex flex-col items-center gap-4">
                <MailIcon className="w-8 h-8 text-[#f4a100]" />
                <div>
                  <h4 className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-2 font-montserrat uppercase">Email</h4>
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed">
                    <EditableText text={siteData.contact.email} onSave={(val) => handleTextChange('contact.email', val)} />
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 md:py-20 bg-[#0a0a0a] border-t border-white/5 text-center">
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-center gap-2 md:gap-3 mb-3 md:mb-4">
            <ScissorsIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />
            <span className="font-montserrat font-black text-sm md:text-2xl tracking-[2px] md:tracking-[4px] uppercase">
              <EditableText
                text={siteData.shopName.split(' ')[0]}
                onSave={(val) => {
                  const rest = siteData.shopName.split(' ').slice(1).join(' ');
                  handleTextChange('shopName', `${val} ${rest}`);
                }}
              /> <span className="text-[#f4a100]">
                <EditableText
                  text={siteData.shopName.split(' ').slice(1).join(' ')}
                  onSave={(val) => {
                    const first = siteData.shopName.split(' ')[0];
                    handleTextChange('shopName', `${first} ${val}`);
                  }}
                />
              </span>
            </span>
          </div>
          <p className="text-[#666666] text-[8px] md:text-xs uppercase tracking-[2px] md:tracking-[4px] mb-8 md:mb-12 max-w-lg mx-auto leading-loose px-4">
            Premium Grooming Excellence in <EditableText text={siteData.area} onSave={(val) => handleTextChange('area', val)} />
          </p>

          <div className="pt-8 md:pt-10 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
            Copyright &copy; 2025 <EditableText text={siteData.shopName} onSave={(val) => handleTextChange('shopName', val)} />. Built by Prime Barber AI.
          </div>
        </div>
      </footer>

      {/* Claim Site Popup */}
      <div className="fixed bottom-4 right-4 md:bottom-8 md:right-8 z-[60] scale-[0.85] md:scale-100 origin-bottom-right">
        <div className="bg-[#f4a100] text-[#1a1a1a] p-4 md:p-6 shadow-2xl rounded-sm border border-[#1a1a1a]/20 max-w-[220px] md:max-w-[280px]">
          <h5 className="font-montserrat font-black text-[10px] md:text-sm tracking-widest uppercase mb-1 md:mb-2">
            Claim Your Website
          </h5>

          {!deploymentResult && (
            <>
              <p className="text-[9px] md:text-[11px] font-bold uppercase mb-3 md:mb-4 opacity-90 leading-tight">
                Launch your custom barbershop website for $10/month.
              </p>
              <button
                onClick={handleClaimSite}
                disabled={isDeploying}
                className="block w-full text-center py-2 bg-[#1a1a1a] text-[#f4a100] text-[9px] md:text-[10px] font-bold tracking-widest uppercase hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeploying ? 'UPLOADING IMAGES...' : 'CLAIM SITE'}
              </button>
              <p className="text-[6px] md:text-[8px] mt-2 opacity-70 uppercase tracking-tighter text-center italic">
                You'll be redirected to secure checkout
              </p>
            </>
          )}

          {deploymentResult?.error && (
            <>
              <p className="text-[9px] md:text-[11px] font-bold mb-3 md:mb-4 text-red-800 leading-tight">
                {deploymentResult.error}
              </p>
              <button
                onClick={handleClaimSite}
                disabled={isDeploying}
                className="block w-full text-center py-2 bg-[#1a1a1a] text-[#f4a100] text-[9px] md:text-[10px] font-bold tracking-widest uppercase hover:bg-black transition-colors"
              >
                TRY AGAIN
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
