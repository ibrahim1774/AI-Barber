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
import { safeHref } from './safeHref.js';
import { mapMarked, unwrapMarked } from './markers.js';
import { bookStripHtml, isSiteBookLink, shopPreviewHtml, type SectionSkin } from './subpages.js';
import {
  aggregateToShow, copyrightYear, displayPrice, footerLine, hasServices, photoAlt, reviewStars, to12h,
  displayPhone, firstName, nicheOf, reviewsSourceLabel, serviceMeta, siteDescription, siteTitle, teamBookLink, teamOf, visibleReviews, withoutLegacyCopy,
} from './honest.js';
import { ratingLineCustom, t, type LabelKey } from './labels.js';
import { hasFilePages } from './pages.js';
import { NAV_CSS, navItemsFor, reportLinkHtml, navListHtml, type RenderCtx } from './shell.js';

// 24h → 12h with AM/PM. Idempotent: if the input already contains an
// AM/PM marker, return it unchanged. Handles "09:00", "9:00", "9", "20:30".
// Anything that doesn't parse cleanly is returned as-is so user-typed
// values like "9am-1pm" or "By appointment" survive unchanged.
export { to12h };
// Extracts the trailing "City, State [ZIP]" portion of an area string so
// the footer "<niche> in ..." line never echoes the
// full street address even if the user pastes one in. Inputs with two
// or fewer comma-separated parts pass through unchanged.
export const cityStateOnly = (raw: string): string => {
  // A value in the editor's markers keeps its wrapper round the cut text (markers.ts): the result stays tappable.
  return mapMarked(raw || '', (text) => {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 2) return text;
    return parts.slice(-2).join(', ');
  });
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
const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Book strip and Shop preview in LUXE's look (accent rides on the .aib-themed overrides).
const LUXE_SKIN: SectionSkin = {
  section: 'py-12 md:py-24 bg-[#0d0d0d] px-6 border-y border-white/5',
  inner: 'container mx-auto max-w-5xl text-center',
  heading: 'text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px] mb-8',
  list: 'max-w-xl mx-auto mb-8 divide-y divide-white/10 text-left',
  item: 'flex items-center justify-between gap-4 py-3',
  name: 'font-montserrat font-bold text-white uppercase tracking-[1px] text-sm md:text-base',
  price: 'font-montserrat font-black text-[#f4a100] whitespace-nowrap',
  button: 'inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-8 py-4 md:px-12 md:py-5 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-sm',
  grid: 'grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-8 text-left',
  link: 'inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-8 py-4 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 text-xs md:text-sm',
  css: '.ab-sp-card{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:inherit}'
    + '.ab-sp-img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#1a1a1a}'
    + ".ab-sp-name{font-family:'Montserrat',sans-serif;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#fff}"
    + ".ab-sp-price{font-family:'Montserrat',sans-serif;font-weight:900;color:var(--aib-accent,#f4a100)}",
};

export function generateHTMLWithPlaceholders(input: WebsiteData, ctx?: RenderCtx): string {
  // Older stored sites: drop the copy we invented for them (honest.ts).
  const siteData = withoutLegacyCopy(input);
  // Every barber / scraped value is escaped before it lands in the page.
  const esc = (v: unknown): string => escapeAttr(String(v ?? ''));
  const bookingUrl = safeHref(siteData.bookingUrl);
  const shopUrl = safeHref(siteData.shopUrl);
  // The site's own /book page opens in the same tab; another booking site in a new one.
  const bookTarget = bookingUrl && !isSiteBookLink(bookingUrl) ? ' target="_blank" rel="noopener noreferrer"' : '';
  // Homepage previews of the site's own /book and /shop pages (lib/render/subpages.ts).
  const bookStrip = bookStripHtml(siteData, LUXE_SKIN, { heading: t(siteData.labels, 'bookStripHeading', undefined, siteData), button: t(siteData.labels, 'bookStripButton', undefined, siteData) });
  const shopPreview = shopPreviewHtml(siteData, LUXE_SKIN, { heading: t(siteData.labels, 'shopStripHeading', undefined, siteData), link: t(siteData.labels, 'shopStripLink', undefined, siteData) });
  const formattedPhone = esc((siteData.phone || '').replace(/\s+/g, ''));
  // The number as printed: "(512) 555-0142" for a plain ten-digit number (honest.ts displayPhone).
  const shownPhone = esc(displayPhone(siteData.phone));
  const hasPhone = !!(siteData.phone || '').trim();
  // tel: links only for a phone with digits ("call us" gets no link).
  const canCall = /\d/.test(siteData.phone || '');
  // Non-optional on purpose: a site with no contact block is malformed and
  // must fail the render (publishSite's dry render relies on that).
  const address = (siteData.contact.address || '').trim();
  // The logo prints the first word and the rest apart; a name in the editor's markers keeps its wrapper (same id) round each part.
  const [nameOpen, nameText, nameClose] = unwrapMarked(siteData.shopName);
  const nameWords = nameText.split(' ');
  const nameFirst = esc(nameOpen + nameWords[0] + nameClose);
  const nameRest = nameWords.length > 1 ? esc(nameOpen + nameWords.slice(1).join(' ') + nameClose) : '';
  // Picked theme — applied via .aib-themed CSS vars on <body> so the deployed
  // site matches the editor preview. Defaults to gold/black when unset.
  const luxeTheme = resolveAibTheme(siteData);

  // Owner-editable label override lookup. Falls back to the hardcoded
  // default when the key is absent, so older saved sites render unchanged.
  // t() escapes (registry: lib/render/labels.ts); the default is the literal that was here before.
  const niche = nicheOf(siteData);
  const lbl = (key: LabelKey) => t(siteData.labels, key, niche, siteData);
  // A multi-page site (lib/render/site.ts passes its page set): the menu lists the pages. Without a
  // page set, or with Home alone, this is the single-page site every web publish still ships.
  const menuSet = ctx?.pages && hasFilePages(ctx.pages) ? ctx.pages : null;

  // Gallery — slot 0 doubles as the about-section seed and slot 1 as
  // the hero/about fallback, so the gallery renders
  // slots [2..7] (6 photos max). Renders only the filled slots so
  // partial galleries don't leave empty tiles.
  const GALLERY_PORTFOLIO_INDICES = [2, 3, 4, 5, 6, 7];
  const galleryImages = GALLERY_PORTFOLIO_INDICES
    .map((idx) => ({ url: siteData.gallery[idx], index: idx }))
    .filter((item) => item.url);

  // Neutral alt text: the photo may be a sample, never "our work".
  const altAttr = escapeAttr(photoAlt(siteData));

  const gallerySection = galleryImages.length > 0
    ? `<section class="py-16 md:py-32 bg-[#0d0d0d] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-5xl">
      <div class="text-center mb-10 md:mb-16">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('galleryEyebrow')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('galleryHeading')}</h2>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
        ${galleryImages.map((g) => `<div class="bg-[#1a1a1a] p-1 border border-white/5 group relative overflow-hidden"><img src="{{gallery${g.index}}}" alt="${altAttr}" class="w-full h-48 sm:h-56 md:h-64 object-cover transition-transform duration-700 group-hover:scale-105"></div>`).join('')}
      </div>
    </div>
  </section>`
    : '';

  // ── Bio section — shows the shop's Booksy description as a pull
  //    quote between hero and about. Skipped when bio is empty (e.g.
  //    manual-form sites or platforms without descriptions).
  const bioSection = siteData.bio && unwrapMarked(siteData.bio.trim())[1].trim().length > 20
    ? `<section class="py-12 md:py-20 bg-[#0d0d0d] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-3xl text-center">
      <svg class="w-8 h-8 mx-auto mb-6 text-[#f4a100]/40" viewBox="0 0 24 24" fill="currentColor"><path d="M6 17h3l2-4V7H5v6h3l-2 4zm8 0h3l2-4V7h-6v6h3l-2 4z"/></svg>
      <p class="text-white/85 text-base md:text-xl leading-relaxed" style="font-family:'Instrument Serif',Georgia,serif;font-style:italic;">${esc(siteData.bio)}</p>
    </div>
  </section>`
    : '';

  // ── Meet the Team section — cards: photo, name, role, 1-line bio, up to 3 service chips and a
  //    "Book with <first name>" button (honest.ts teamOf: at most 5 entries with a memberId, older
  //    entries stay uncapped as before; the stored staff[] is never cut; teamBookLink holds the button rules). Skipped when there is no team.
  const team = teamOf(siteData, { legacyUncapped: true });
  const bookingLive = isSiteBookLink(siteData.bookingUrl);
  const teamSection = team.length > 0
    ? `<section id="team" class="py-16 md:py-28 bg-[#0a0a0a] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-6xl">
      <div class="text-center mb-10 md:mb-16">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('teamEyebrow')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('teamHeading')}</h2>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
        ${team.map((s) => {
          const link = teamBookLink(siteData, s, bookingLive);
          return `
          <div class="flex flex-col items-center text-center group" id="team-${esc(s.slug)}">
            <div class="relative w-full aspect-square mb-3 overflow-hidden bg-[#1a1a1a] border border-white/5">
              ${s.photo ? `<img src="{{staff${s.index}}}" alt="${esc(s.name)}" class="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700">` : `<div class="w-full h-full flex items-center justify-center text-[#f4a100]/30"><svg class="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 22v-2c0-3.31 3.58-6 8-6s8 2.69 8 6v2H4z"/></svg></div>`}
            </div>
            <h4 class="font-montserrat font-black text-white text-sm md:text-base tracking-[1px] uppercase">${esc(s.name)}</h4>
            ${s.role ? `<p class="text-[#f4a100] text-[10px] md:text-[11px] font-bold tracking-[2px] uppercase mt-1">${esc(s.role)}</p>` : ''}
            ${s.bio ? `<p class="text-white/70 text-xs md:text-sm mt-2" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(s.bio)}</p>` : ''}
            ${s.serviceNames ? `<div class="flex flex-wrap justify-center gap-1.5 mt-2">${s.serviceNames.map((n) => `<span class="text-[9px] tracking-[1px] uppercase border border-white/15 text-white/60 px-2 py-0.5">${esc(n)}</span>`).join('')}</div>` : ''}
            ${link ? `<a href="${esc(link.href)}"${link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''} class="mt-3 inline-flex items-center border border-[#f4a100] text-[#f4a100] px-4 py-2 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 text-[10px]">${link.kind === 'member' ? `${lbl('teamBookWith')} ${esc(firstName(s.name))}` : lbl('bookButton')}</a>` : ''}
          </div>
        `;
        }).join('')}
      </div>
    </div>
  </section>`
    : '';

  // ── Hours section — Mon-Sun rows. Skipped when no hours array.
  const hoursSection = siteData.hours && siteData.hours.length > 0
    ? `<section class="py-16 md:py-24 bg-[#0d0d0d] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-2xl">
      <div class="text-center mb-8 md:mb-12">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('hoursEyebrow')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('hoursHeading')}</h2>
      </div>
      <div class="bg-[#1a1a1a] border border-white/5 divide-y divide-white/5">
        ${siteData.hours.map((h) => `
          <div class="flex items-center justify-between px-5 md:px-8 py-3.5 md:py-4">
            <span class="text-white text-sm md:text-base font-bold uppercase tracking-[2px]">${esc(h.day)}</span>
            <span class="text-[#f4a100] text-sm md:text-base font-bold tracking-[1px]">${h.closed ? lbl('closedLabel') : `${esc(to12h(h.open))} – ${esc(to12h(h.close))}`}</span>
          </div>
        `).join('')}
      </div>
    </div>
  </section>`
    : '';

  // ── Aggregate-rating header — small block above the existing
  //    reviews grid when set. Renderer (and template) read .reviews
  //    separately so the header alone doesn't try to render reviews.
  const agg = aggregateToShow(siteData);
  // The barber's own wording around the real figures (labels.ts), else the standard markup.
  const ratingCustom = ratingLineCustom(siteData);
  const ratingHeader = agg
    ? `<div class="text-center mb-10 md:mb-12">
        <div class="inline-flex items-center gap-3 bg-[#1a1a1a] border border-[#f4a100]/30 px-5 py-3 md:px-7 md:py-4">
          <span class="text-[#f4a100] text-2xl md:text-3xl">★</span>
          ${ratingCustom !== null ? `<span class="text-white text-base md:text-xl font-montserrat font-black">${esc(ratingCustom)}</span>` : `<span class="text-white text-2xl md:text-3xl font-montserrat font-black">${agg.rating.toFixed(1)}</span>
          ${agg.count > 0 ? `<span class="text-white/60 text-[10px] md:text-xs uppercase tracking-[2px] font-bold">from ${agg.count.toLocaleString()} reviews</span>` : ''}`}
        </div>
      </div>`
    : '';

  // ── Reviews — render up to 12, with optional aggregate-rating
  //    header above. Skipped when no reviews.
  const shownReviews = visibleReviews(siteData);
  const reviewsSection = shownReviews.length > 0
    ? `<section class="py-16 md:py-28 bg-[#0a0a0a] px-6 border-y border-white/5">
    <div class="container mx-auto max-w-6xl">
      ${ratingHeader}
      <div class="text-center mb-10 md:mb-14">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('reviewsEyebrow')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('reviewsHeading')}</h2>
        ${reviewsSourceLabel(siteData) ? `<p data-reviews-source class="text-white/50 text-[10px] md:text-xs uppercase tracking-[2px] font-bold mt-4">${esc(reviewsSourceLabel(siteData))}</p>` : ''}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        ${shownReviews.slice(0, 12).map((r) => {
          // No readable rating → no star row (never a made-up 5).
          const stars = reviewStars(r);
          return `
          <div class="border border-white/10 bg-[#111111] p-5 md:p-7 flex flex-col gap-3">
            ${stars !== null ? `<div class="flex items-center gap-1">${Array.from({ length: 5 }, (_, s) => `<span class="${s < stars ? 'text-[#f4a100]' : 'text-white/15'}">★</span>`).join('')}</div>` : ''}
            <p class="text-white/80 text-sm md:text-base leading-relaxed italic">"${esc(r.comment)}"</p>
            <div class="flex items-center justify-between text-[10px] uppercase tracking-[2px] text-white/50 mt-auto pt-2 border-t border-white/5">
              <span class="font-bold text-white/80">${esc(r.author || 'Customer')}</span>
              ${r.date ? `<span>${esc(r.date)}</span>` : ''}
            </div>
          </div>
        `;
        }).join('')}
      </div>
    </div>
  </section>`
    : '';

  // Services — only what the barber ticked or their booking page lists.
  // None → no section (and no nav link to it).
  const showServices = hasServices(siteData);
  const servicesSection = showServices
    ? `<section id="services" class="py-12 md:py-32 bg-[#0d0d0d] px-6">
    <div class="container mx-auto max-w-7xl">
      <div class="text-center mb-10 md:mb-16">
        <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat">${lbl('servicesEyebrow')}</h3>
        <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]">${lbl('servicesHeading')}</h2>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        ${siteData.services.filter((service) => (service?.title || '').trim()).map((service) => {
          const price = displayPrice(service.price);
          const meta = serviceMeta(service);
          return `
          <div class="group border-2 border-[#f4a100] p-6 md:p-10 flex flex-col hover:bg-[#1a1a1a] transition-all duration-500">
            <div class="flex items-start justify-between gap-3 mb-3 md:mb-4">
              <h3 class="font-montserrat font-black text-white text-base md:text-lg tracking-[1px] uppercase leading-tight flex-1">${esc(service.title)}</h3>
              ${price ? `<span class="font-montserrat font-black text-[#f4a100] text-base md:text-lg whitespace-nowrap">${esc(price)}</span>` : ''}
            </div>
            ${meta ? `<p class="text-[#f4a100] text-[10px] md:text-[11px] font-bold tracking-[2px] mb-3 uppercase">${esc(meta)}</p>` : ''}
            ${service.description ? `<p class="text-[#999999] text-xs md:text-sm leading-relaxed">${esc(service.description)}</p>` : ''}
          </div>
        `;
        }).join('')}
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
        <img src="{{about}}" alt="${altAttr}" class="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl">
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
  <title>${escapeAttr(siteTitle(siteData))}</title>
  <meta name="description" content="${escapeAttr(siteDescription(siteData))}">
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
    /* Header on a narrow phone: the number never wraps; under 380px the call link is the icon alone
       (the full number stays in the hero button and the contact section). */
    @media (max-width: 379px) { .ab-call-text { display: none; } .ab-call svg { width: 1.75rem; height: 1.75rem; } }
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
  <style>${AIB_THEME_CSS}</style>${menuSet ? `
  <style>${NAV_CSS.luxe}</style>` : ''}
</head>
<body class="aib-themed bg-[#0d0d0d] text-white overflow-x-hidden" style="${aibThemeVars(luxeTheme)}">
  <header id="header" class="fixed top-0 left-0 w-full z-50 transition-all duration-300 bg-black/20 py-5 md:py-8">
    <div class="container mx-auto flex justify-between items-center px-4 md:px-6">
      <div class="flex items-center gap-3 md:gap-8 min-w-0">
        <div class="flex items-center gap-3 md:gap-5 min-w-0">
          <svg class="w-8 h-8 md:w-12 md:h-12 shrink-0 text-[#f4a100]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M6 18L18 6"></path>
          </svg>
          <span class="font-montserrat font-black text-lg md:text-3xl lg:text-4xl tracking-[1px] md:tracking-[2px] uppercase whitespace-nowrap min-w-0 truncate">
            ${nameFirst} <span class="text-[#f4a100]">${nameRest}</span>
          </span>
        </div>
        ${canCall ? `<a href="tel:${formattedPhone}" aria-label="Call ${shownPhone}" class="ab-call flex items-center shrink-0 gap-2 md:gap-4 text-[#f4a100] border-l-2 border-white/20 pl-3 md:pl-8 hover:text-white transition-colors">
          <svg class="w-5 h-5 md:w-7 md:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path>
          </svg>
          <span class="ab-call-text whitespace-nowrap text-sm md:text-xl lg:text-2xl font-bold tracking-tight">${shownPhone}</span>
        </a>` : ''}
      </div>
      ${menuSet ? navListHtml(navItemsFor('luxe', menuSet, siteData, 'home'), lbl('pgMenu'), lbl('pgMore')) : `<nav class="hidden lg:flex items-center gap-10">
        <a href="#home" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">${lbl('navHome')}</a>
${showServices ? `        <a href="#services" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">${lbl('navServices')}</a>
` : ''}        <a href="#contact" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">${lbl('navContact')}</a>${shopUrl ? `
        <a href="${escapeAttr(shopUrl)}" class="text-[12px] font-montserrat font-bold tracking-[2px] hover:text-[#f4a100] transition-colors">${lbl('navShop')}</a>` : ''}
      </nav>`}
    </div>
  </header>

  <section id="home" class="relative h-[55vh] flex flex-col justify-center items-center overflow-hidden">
    <div class="absolute inset-0 z-0">
      <img src="{{hero}}" alt="${altAttr}" class="w-full h-full object-cover">
      <div class="absolute inset-0 bg-black/40 bg-gradient-to-b from-black/30 via-transparent to-[#0d0d0d]"></div>
    </div>
    <div class="relative z-10 text-center px-4 md:px-6 max-w-5xl pb-28 md:pb-32 pt-20 md:pt-0">
      <p class="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
        ${esc(siteData.hero.tagline)}
      </p>
      <h1 class="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
        ${esc(siteData.hero.heading)}
      </h1>
      <div class="flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4">
        ${canCall ? `<a href="tel:${formattedPhone}" class="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base">
          <span>${lbl('callNow')} ${shownPhone}</span>
        </a>` : ''}
        ${bookingUrl ? `<a href="${escapeAttr(bookingUrl)}"${bookTarget} class="inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-base"><span>${lbl('bookButton')}</span></a>` : ''}
      </div>
    </div>
  </section>

  ${bioSection}

  <section id="about-us" class="py-12 md:py-32 px-6 bg-[#1a1a1a]">
    <div class="container mx-auto grid ${siteData.about.imageUrl ? 'lg:grid-cols-2' : ''} gap-10 md:gap-20 items-center">
      <div class="relative">
        <h2 class="text-2xl md:text-5xl font-montserrat font-black text-white mb-6 md:mb-8 leading-tight uppercase tracking-[2px]">
          ${esc(siteData.about.heading)}
        </h2>
        <div class="space-y-4 md:space-y-6 text-[#cccccc] font-light leading-relaxed text-sm md:text-base">
          ${siteData.about.description.map(p => `<p>${esc(p)}</p>`).join('')}
        </div>
      </div>
      ${aboutImageSection}
    </div>
  </section>

  ${gallerySection}

  ${servicesSection}${bookStrip}

  ${reviewsSection}

  ${teamSection}

  ${hoursSection}

  ${craftSection}${shopPreview}

  <section id="contact" class="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
    <div class="container mx-auto max-w-6xl bg-[#1a1a1a] p-8 md:p-20">
      <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]">${lbl('contactHeading')}</h2>
      <div class="space-y-6 md:space-y-10">
        ${address ? `<div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">${lbl('contactLocationLabel')}</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${esc(mapMarked(address, (a) => a.charAt(0).toUpperCase() + a.slice(1)))}</p>
        </div>` : ''}
        ${hasPhone ? `<div>
          <h4 class="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-1 md:mb-2 font-montserrat">${lbl('contactPhoneLabel')}</h4>
          <p class="text-[#cccccc] text-xs md:text-sm leading-relaxed">${shownPhone}</p>
        </div>` : ''}
        ${bookingUrl ? `<div class="pt-4"><a href="${escapeAttr(bookingUrl)}"${bookTarget} class="inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-8 py-4 md:px-12 md:py-5 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-sm">${lbl('bookButton')}</a></div>` : ''}${shopUrl ? `
        <div class="pt-4"><a href="${escapeAttr(shopUrl)}" class="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-8 py-4 md:px-12 md:py-5 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 text-xs md:text-sm">${lbl('shopButton')}</a></div>` : ''}
      </div>
    </div>
  </section>

  <section id="find-us" class="py-12 md:py-20 bg-[#0d0d0d] px-4 md:px-6 border-t border-white/5">
    <div class="container mx-auto max-w-4xl text-center">
      <h3 class="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-3 md:mb-4 font-montserrat">${lbl('mapEyebrow')}</h3>
      <h2 class="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px] mb-8 md:mb-12">${lbl('mapHeading')}</h2>
      <div class="bg-[#1a1a1a] p-1 border border-white/5">
        <iframe
          title="${esc(siteData.shopName)} on Google Maps"
          src="https://maps.google.com/maps?q=${encodeURIComponent(`${siteData.shopName} ${address}`)}&output=embed"
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
        ${nameFirst} <span class="text-[#f4a100]">${nameRest}</span>
      </span>
      <p class="text-[#666666] text-[8px] md:text-xs uppercase tracking-[2px] md:tracking-[4px] mt-8 mb-12">
        ${lbl('footerLine')}
      </p>
      <div class="pt-8 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
        Copyright &copy; ${copyrightYear()} ${esc(siteData.shopName)}. ${lbl('footerCredit')}. ${reportLinkHtml()}
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
