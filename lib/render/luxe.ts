// Luxe (Design 1, the default) static renderer.
//
// Lifted out of components/GeneratedWebsite.tsx so the SERVER can render a site without
// pulling in React, the editor component, or anything DOM-shaped.
// The browser preview and /api/publish call the SAME function, so the page
// a customer previews is the page that deploys — there is no second
// implementation to drift.
//
// Pure: WebsiteData in, HTML string out. Keep it that way.
import type { WebsiteData } from '../../types';

// 24h → 12h with AM/PM. Idempotent: if the input already contains an
// AM/PM marker, return it unchanged. Handles "09:00", "9:00", "9", "20:30".
// Anything that doesn't parse cleanly is returned as-is so user-typed
// values like "9am-1pm" or "By appointment" survive unchanged.
export const to12h = (raw: string | null | undefined): string => {
  if (!raw) return raw ?? '';
  const s = String(raw).trim();
  if (!s) return s;
  if (/\b(AM|PM|am|pm|noon|midnight)\b/i.test(s)) return s.replace(/\s+/g, ' ').toUpperCase().replace('NOON', 'Noon').replace('MIDNIGHT', 'Midnight');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return s;
  const h24 = parseInt(m[1], 10);
  const mm = m[2] || '00';
  if (isNaN(h24) || h24 < 0 || h24 > 24) return s;
  const period = h24 >= 12 && h24 < 24 ? 'PM' : 'AM';
  const h12 = h24 === 0 || h24 === 24 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${mm} ${period}`;
};
// Extracts the trailing "City, State [ZIP]" portion of an area string so
// the hero "Premium Grooming Excellence in ..." line never echoes the
// full street address even if the user pastes one in. Inputs with two
// or fewer comma-separated parts pass through unchanged.
export const cityStateOnly = (raw: string): string => {
  const parts = (raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return raw || '';
  return parts.slice(-2).join(', ');
};
// ---------------------------------------------------------------------------
// Color themes — picked on the GeneratorForm. The slug is persisted on
// WebsiteData.colorTheme. Renderer sets CSS variables on its root and
// a scoped <style> block rewires the hardcoded #f4a100 / #0d0d0d
// utility classes so the same JSX paints correctly for every theme.
// ---------------------------------------------------------------------------
export interface AibTheme {
  bgRgb: string;
  textRgb: string;
  accent: string;
  accentHover: string;
}
export const AIB_THEMES: Record<string, AibTheme> = {
  goldBlack:   { bgRgb: '13 13 13',  textRgb: '255 255 255', accent: '#f4a100', accentHover: '#ffb43a' },
  blackWhite:  { bgRgb: '13 13 13',  textRgb: '245 245 245', accent: '#ffffff', accentHover: '#e5e5e5' },
  redBlack:    { bgRgb: '13 13 13',  textRgb: '255 255 255', accent: '#dc2626', accentHover: '#ef4444' },
  purpleGreen: { bgRgb: '22 3 40',   textRgb: '240 236 228', accent: '#22c55e', accentHover: '#4ade80' },
};
// Theming CSS shared by the editor preview (<style> in the component) and the
// deployed static HTML (generateHTMLWithPlaceholders) so a picked color looks
// identical live and in the editor. Scoped under .aib-themed; rewires LUXE's
// hardcoded color utilities onto the CSS variables set on the root element.
export const AIB_THEME_CSS = `
        /* Glossy LUXE pass — gradient depth + hairline section seam +
           gold glow on accent buttons + glass-card treatment. */
        .aib-themed .serif-accent { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-weight: 400; }
        .aib-themed section + section { box-shadow: inset 0 1px 0 rgba(244,161,0,0.06); }
        .aib-themed a[class*="bg-[#f4a100]"][class*="px-"] {
          box-shadow: 0 0 30px rgba(244,161,0,0.18), 0 8px 20px rgba(0,0,0,0.35);
        }

        /* Rewire the hardcoded LUXE color utilities onto the picked theme.
           Specificity bump via .aib-themed parent so these win against
           the standalone utility classes. */
        .aib-themed.bg-\\[\\#0d0d0d\\], .aib-themed .bg-\\[\\#0d0d0d\\] { background-color: var(--aib-bg) !important; }
        .aib-themed .bg-\\[\\#111111\\] { background-color: rgb(var(--aib-bg-rgb) / 0.92) !important; }
        .aib-themed .bg-\\[\\#0c0c0c\\] { background-color: rgb(var(--aib-bg-rgb) / 0.95) !important; }
        .aib-themed .bg-\\[\\#1a1a1a\\] { background-color: rgb(var(--aib-bg-rgb) / 0.85) !important; }

        .aib-themed .text-\\[\\#f4a100\\] { color: var(--aib-accent) !important; }
        .aib-themed .bg-\\[\\#f4a100\\] { background-color: var(--aib-accent) !important; }
        .aib-themed .border-\\[\\#f4a100\\] { border-color: var(--aib-accent) !important; }
        .aib-themed .from-\\[\\#f4a100\\] { --tw-gradient-from: var(--aib-accent) !important; }
        .aib-themed .to-\\[\\#f4a100\\] { --tw-gradient-to: var(--aib-accent) !important; }
        .aib-themed .hover\\:bg-\\[\\#f4a100\\]:hover { background-color: var(--aib-accent) !important; }
        .aib-themed .hover\\:text-\\[\\#f4a100\\]:hover { color: var(--aib-accent) !important; }
        .aib-themed .hover\\:border-\\[\\#f4a100\\]:hover { border-color: var(--aib-accent) !important; }
        .aib-themed .focus\\:border-\\[\\#f4a100\\]:focus { border-color: var(--aib-accent) !important; }
        .aib-themed .ring-\\[\\#f4a100\\] { --tw-ring-color: var(--aib-accent) !important; }

        /* Light cream variants used for hovers / pull quotes */
        .aib-themed .text-\\[\\#e8c074\\] { color: var(--aib-accent-hover) !important; }
        .aib-themed .bg-\\[\\#e8c074\\] { background-color: var(--aib-accent-hover) !important; }
`;
// Resolve the picked color theme. A custom hex paints as the accent on the dark
// canvas; named slugs map to presets; unset/unknown falls back to gold/black.
export function resolveAibTheme(siteData: WebsiteData): AibTheme {
  const ctRaw = (siteData as any).colorTheme as string | undefined;
  return ctRaw && ctRaw.charAt(0) === '#'
    ? { bgRgb: '13 13 13', textRgb: '255 255 255', accent: ctRaw, accentHover: ctRaw }
    : (AIB_THEMES[ctRaw as string] || AIB_THEMES.goldBlack);
}
// Inline style string that sets the theme CSS vars on the deployed <body>.
export function aibThemeVars(theme: AibTheme): string {
  return `--aib-bg:rgb(${theme.bgRgb});--aib-bg-rgb:${theme.bgRgb};--aib-text:rgb(${theme.textRgb});--aib-text-rgb:${theme.textRgb};--aib-accent:${theme.accent};--aib-accent-hover:${theme.accentHover};`;
}
// Exported so App.tsx can reuse it for post-payment deploy
export function generateHTMLWithPlaceholders(siteData: WebsiteData): string {
  const formattedPhone = siteData.phone.replace(/\s+/g, '');
  // Picked theme — applied via .aib-themed CSS vars on <body> so the deployed
  // site matches the editor preview. Defaults to gold/black when unset.
  const luxeTheme = resolveAibTheme(siteData);

  // Owner-editable label override lookup. Falls back to the hardcoded
  // default when the key is absent, so older saved sites render unchanged.
  const lbl = (key: string, fallback: string) => (siteData.labels && siteData.labels[key]) || fallback;

  // Gallery — slot 0 doubles as the about-section seed and slot 1 as
  // the hero/about fallback, so the "Our Work" portfolio renders
  // slots [2..7] (6 photos max). Renders only the filled slots so
  // partial galleries don't leave empty tiles.
  const GALLERY_PORTFOLIO_INDICES = [2, 3, 4, 5, 6, 7];
  const galleryImages = GALLERY_PORTFOLIO_INDICES
    .map((idx) => ({ url: siteData.gallery[idx], index: idx }))
    .filter((item) => item.url);

  const gallerySection = galleryImages.length > 0
    ? `<section class="py-16 md:py-32 bg-[#0d0d0d] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-5xl">
      <div class="text-center mb-10 md:mb-16">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('galleryEyebrow', 'Gallery')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('galleryHeading', 'Our Work')}</h2>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        ${galleryImages.map((g) => `<div class="bg-[#1a1a1a] p-1 border border-white/5 group relative overflow-hidden"><img src="{{gallery${g.index}}}" alt="Gallery Image ${g.index - 1}" class="w-full h-48 sm:h-56 md:h-64 object-cover transition-transform duration-700 group-hover:scale-105"></div>`).join('')}
      </div>
    </div>
  </section>`
    : '';

  // ── Bio section — shows the shop's Booksy description as a pull
  //    quote between hero and about. Skipped when bio is empty (e.g.
  //    manual-form sites or platforms without descriptions).
  const bioSection = siteData.bio && siteData.bio.trim().length > 20
    ? `<section class="py-12 md:py-20 bg-[#0d0d0d] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-3xl text-center">
      <svg class="w-8 h-8 mx-auto mb-6 text-[#f4a100]/40" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z"/></svg>
      <p class="text-white/85 text-base md:text-xl leading-relaxed" style="font-family:'Instrument Serif',Georgia,serif;font-style:italic;">${siteData.bio.replace(/</g, '&lt;')}</p>
    </div>
  </section>`
    : '';

  // ── Meet the Team section — staff cards with photo + name + role.
  //    Skipped when no staff array.
  const teamSection = siteData.staff && siteData.staff.length > 0
    ? `<section class="py-16 md:py-28 bg-[#0a0a0a] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-6xl">
      <div class="text-center mb-10 md:mb-16">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('teamEyebrow', 'The Team')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('teamHeading', 'Meet Our Barbers')}</h2>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        ${siteData.staff.map((s, i) => `
          <div class="flex flex-col items-center text-center group">
            <div class="relative w-full aspect-square mb-3 overflow-hidden bg-[#1a1a1a] border border-white/5">
              ${s.photo ? `<img src="{{staff${i}}}" alt="${(s.name || 'Staff').replace(/"/g, '&quot;')}" class="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700">` : `<div class="w-full h-full flex items-center justify-center text-[#f4a100]/30"><svg class="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2c0-3.31 3.58-6 8-6s8 2.69 8 6v2H4z"/></svg></div>`}
            </div>
            <h4 class="font-montserrat font-black text-white text-sm md:text-base tracking-[1px] uppercase">${(s.name || '').replace(/</g, '&lt;')}</h4>
            ${s.role ? `<p class="text-[#f4a100] text-[10px] md:text-[11px] font-bold tracking-[2px] uppercase mt-1">${s.role.replace(/</g, '&lt;')}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  </section>`
    : '';

  // ── Hours section — Mon-Sun rows. Skipped when no hours array.
  const hoursSection = siteData.hours && siteData.hours.length > 0
    ? `<section class="py-16 md:py-24 bg-[#0d0d0d] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-2xl">
      <div class="text-center mb-8 md:mb-12">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('hoursEyebrow', 'Hours')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('hoursHeading', "When We're Open")}</h2>
      </div>
      <div class="bg-[#1a1a1a] border border-white/5 divide-y divide-white/5">
        ${siteData.hours.map((h) => `
          <div class="flex items-center justify-between px-5 md:px-8 py-3.5 md:py-4">
            <span class="text-white text-sm md:text-base font-bold uppercase tracking-[2px]">${h.day}</span>
            <span class="text-[#f4a100] text-sm md:text-base font-bold tracking-[1px]">${h.closed ? 'Closed' : `${to12h(h.open)} – ${to12h(h.close)}`}</span>
          </div>
        `).join('')}
      </div>
    </div>
  </section>`
    : '';

  // ── Aggregate-rating header — small block above the existing
  //    reviews grid when set. Renderer (and template) read .reviews
  //    separately so the header alone doesn't try to render reviews.
  const ratingHeader = siteData.aggregateRating
    ? `<div class="text-center mb-10 md:mb-12">
        <div class="inline-flex items-center gap-3 bg-[#1a1a1a] border border-[#f4a100]/30 px-5 py-3 md:px-7 md:py-4">
          <span class="text-[#f4a100] text-2xl md:text-3xl">★</span>
          <span class="text-white text-2xl md:text-3xl font-montserrat font-black">${siteData.aggregateRating.rating.toFixed(1)}</span>
          ${siteData.aggregateRating.count > 0 ? `<span class="text-white/60 text-[10px] md:text-xs uppercase tracking-[2px] font-bold">from ${siteData.aggregateRating.count.toLocaleString()} reviews</span>` : ''}
        </div>
      </div>`
    : '';

  // ── Reviews — render up to 12, with optional aggregate-rating
  //    header above. Skipped when no reviews.
  const reviewsSection = siteData.reviews && siteData.reviews.length > 0
    ? `<section class="py-16 md:py-28 bg-[#0a0a0a] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-6xl">
      ${ratingHeader}
      <div class="text-center mb-10 md:mb-14">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('reviewsEyebrow', 'Reviews')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('reviewsHeading', 'What Our Clients Say')}</h2>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        ${siteData.reviews.slice(0, 12).map((r) => `
          <div class="border border-white/10 bg-[#111111] p-5 md:p-7 flex flex-col gap-3">
            <div class="flex items-center gap-1">${Array.from({ length: 5 }, (_, s) => `<span class="${s < r.rating ? 'text-[#f4a100]' : 'text-white/15'}">★</span>`).join('')}</div>
            <p class="text-white/80 text-sm md:text-base leading-relaxed italic">"${(r.comment || '').replace(/</g, '&lt;').replace(/"/g, '&quot;')}"</p>
            <div class="flex items-center justify-between text-[10px] uppercase tracking-[2px] text-white/50 mt-auto pt-2 border-t border-white/5">
              <span class="font-bold text-white/80">${(r.author || 'Customer').replace(/</g, '&lt;')}</span>
              ${r.date ? `<span>${String(r.date).replace(/</g, '&lt;')}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </section>`
    : '';

  // "The Craft" / "An eye for the work" section removed per product
  // decision — keep craftImages data plumbing alive (defaults +
  // upload paths) so in-flight sites don't break, but the section
  // no longer renders on either the HTML template or the JSX
  // preview.
  const craftSection = '';

  const aboutImageSection = siteData.about.imageUrl
    ? `<div class="relative group mt-6 lg:mt-0">
        <img src="{{about}}" alt="Barber Shop Atmosphere" class="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl">
      </div>`
    : '';

  // Cache-bust marker so each publish forces a fresh fetch even if
  // a browser / CDN had the previous HTML cached. Combined with the
  // short Cache-Control header set by api/deploy-site, this means
  // "Publish" is genuinely real-time for repeat visitors.
  const publishedAt = String(Date.now());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="published-at" content="${publishedAt}">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>${siteData.shopName} - Premium Barbershop in ${siteData.area}</title>
  <meta name="description" content="Premium grooming services at ${siteData.shopName} in ${siteData.area}. Expert barbers, luxury experience.">
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "w5jdq6huun");
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700;900&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="styles.css">
  <style>
    * { font-family: 'Montserrat', sans-serif; }
    html { scroll-behavior: smooth; }
    /* Glossy LUXE pass — keeps every existing utility intact, layers
       depth via gradient surfaces + a hairline highlight on every
       section seam + a soft gold glow on accent buttons. Scoped tight
       so the upgrade doesn't bleed into elements that should stay flat. */
    .serif-accent { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-weight: 400; }
    section.py-12, section.py-16 {
      background-image: linear-gradient(180deg, rgba(255,255,255,0.025) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.4) 100%);
      background-blend-mode: overlay;
    }
    section + section { box-shadow: inset 0 1px 0 rgba(244,161,0,0.06); }
    a[href^="tel:"][class*="bg-[#f4a100]"], a[class*="bg-[#f4a100]"][class*="px-"] {
      box-shadow: 0 0 30px rgba(244,161,0,0.18), 0 8px 20px rgba(0,0,0,0.35);
    }
    /* Glass-card treatment on bordered service / review / team cards. */
    .border-2.border-\\[\\#f4a100\\], .border.border-white\\/10 {
      background-image: linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0));
      backdrop-filter: blur(2px);
    }
  </style>
  <style>${AIB_THEME_CSS}</style>
</head>
<body class="aib-themed bg-[#0d0d0d] text-white overflow-x-hidden" style="${aibThemeVars(luxeTheme)}">
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

  <section id="home" class="relative h-[55vh] flex flex-col justify-center items-center overflow-hidden">
    <div class="absolute inset-0 z-0">
      <img src="{{hero}}" alt="Main Hero" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-black/40 bg-gradient-to-b from-black/30 via-transparent to-[#0d0d0d]"></div>
    </div>
    <div class="relative z-10 text-center px-4 md:px-6 max-w-5xl pb-28 md:pb-32 pt-20 md:pt-0">
      <p class="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
        ${siteData.hero.tagline}
      </p>
      <h1 class="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
        ${siteData.hero.heading}
      </h1>
      <div class="flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4">
        <a href="tel:${formattedPhone}" class="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base">
          <span>Call Now: ${siteData.phone}</span>
        </a>
        ${siteData.bookingUrl ? `<a href="${siteData.bookingUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-base"><span>Book Appointment</span></a>` : ''}
      </div>
    </div>
  </section>

  ${bioSection}

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

  ${gallerySection}

  <section id="services" class="py-12 md:py-32 bg-[#0d0d0d] px-6">
    <div class="container mx-auto max-w-7xl">
      <div class="text-center mb-10 md:mb-16">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('servicesEyebrow', 'Services')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('servicesHeading', 'What We Offer')}</h2>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        ${siteData.services.map(service => `
          <div class="group border-2 border-[#f4a100] p-6 md:p-10 flex flex-col hover:bg-[#1a1a1a] transition-all duration-500">
            <div class="flex items-start justify-between gap-3 mb-3 md:mb-4">
              <h3 class="font-montserrat font-black text-white text-base md:text-lg tracking-[1px] uppercase leading-tight flex-1">${service.title}</h3>
              ${service.price ? `<span class="font-montserrat font-black text-[#f4a100] text-base md:text-lg whitespace-nowrap">${service.price}</span>` : ''}
            </div>
            ${(service.duration || service.subtitle) ? `<p class="text-[#f4a100] text-[10px] md:text-[11px] font-bold tracking-[2px] mb-3 uppercase">${service.duration || service.subtitle}</p>` : ''}
            <p class="text-[#999999] text-xs md:text-sm leading-relaxed">${service.description}</p>
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  ${reviewsSection}

  ${teamSection}

  ${hoursSection}

  ${craftSection}

  <section id="contact" class="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
    <div class="container mx-auto max-w-6xl bg-[#1a1a1a] p-8 md:p-20">
      <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]">${lbl('contactHeading', 'Contact Us')}</h2>
      <div class="space-y-6 md:space-y-10">
        <div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">${lbl('contactLocationLabel', 'LOCATION')}</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${siteData.contact.address.charAt(0).toUpperCase() + siteData.contact.address.slice(1)}</p>
        </div>
        <div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">${lbl('contactPhoneLabel', 'PHONE')}</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${siteData.phone}</p>
        </div>
        ${siteData.bookingUrl ? `<div class="pt-4"><a href="${siteData.bookingUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-8 py-4 md:px-12 md:py-5 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-sm">Book Appointment</a></div>` : ''}
      </div>
    </div>
  </section>

  <section id="find-us" class="py-12 md:py-20 bg-[#0d0d0d] px-4 md:px-6 border-t border-white/5">
    <div class="container mx-auto max-w-4xl text-center">
      <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-3 md:mb-4 font-montserrat">${lbl('mapEyebrow', 'Find Us')}</h3>
      <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px] mb-8 md:mb-12">${lbl('mapHeading', 'Stop By')}</h2>
      <div class="bg-[#1a1a1a] p-1 border border-white/5">
        <iframe
          title="${siteData.shopName.replace(/"/g, '&quot;')} on Google Maps"
          src="https://maps.google.com/maps?q=${encodeURIComponent(`${siteData.shopName} ${siteData.contact.address}`)}&output=embed"
          width="100%" height="360"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          style="border:0;display:block;filter:grayscale(0.2) contrast(1.05);"></iframe>
      </div>
    </div>
  </section>

  <footer class="py-12 md:py-20 bg-[#0a0a0a] border-t border-white/5 text-center">
    <div class="container mx-auto px-6">
      <span class="font-montserrat font-black text-sm md:text-2xl tracking-[2px] md:tracking-[4px] uppercase">
        ${siteData.shopName.split(' ')[0]} <span class="text-[#f4a100]">${siteData.shopName.split(' ').slice(1).join(' ')}</span>
      </span>
      <p class="text-[#666666] text-[8px] md:text-xs uppercase tracking-[2px] md:tracking-[4px] mt-8 mb-12">
        Premium Grooming Excellence in ${cityStateOnly(siteData.area)}
      </p>
      <div class="pt-8 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
        Copyright &copy; 2025 ${siteData.shopName}. Built by AIBarber.
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
