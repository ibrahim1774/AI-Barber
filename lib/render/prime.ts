// Prime (Design 2) static renderer.
//
// Lifted out of components/PrimeWebsite.tsx so the SERVER can render a site without
// pulling in React, the editor component, or anything DOM-shaped.
// The browser preview and /api/publish call the SAME function, so the page
// a customer previews is the page that deploys — there is no second
// implementation to drift.
//
// Pure: WebsiteData in, HTML string out. Keep it that way.
import type { WebsiteData } from '../../types';
import { safeHref } from './safeHref.js';
import { bookStripHtml, isSiteBookLink, shopPreviewHtml, type SectionSkin } from './subpages.js';
import {
  aggregateToShow, copyrightYear, displayPrice, galleryIsAllOwnPhotos, hasServices, nicheCopy, photoAlt,
  displayPhone, nicheOf, photosAreFromBookingPage, policyToShow, reviewStars, reviewsSourceLabel, serviceMeta,
  siteDescription, siteTitle, teamBookLink, teamOf, firstName, visibleReviews, withoutLegacyCopy,
} from './honest.js';
import { ratingLineCustom, t, type LabelKey } from './labels.js';
import { hasFilePages } from './pages.js';
import { HEADER_CSS, NAV_CSS, headerHtml, navItemsFor, navListHtml, type RenderCtx } from './shell.js';

// Policy: there is NO default. A shop's policy is a fact only the barber
// can state, so the "Please note" block renders only from barber-written
// text (honest.ts policyToShow). DEFAULT_POLICY stays exported, empty, for
// callers that seed `policy` — an empty body never renders.
// Pull-quote: a generic line true of any barbershop; editable.
export const DEFAULT_POLICY: { title: string; body: string } = {
  title: '',
  body: '',
};
export const DEFAULT_PULLQUOTE: { text: string; accent?: string } = {
  text: "A great cut isn't a transaction — it's a craft.",
};
// Even 2-column × 3-row grid of compact square tiles (matches the PrimeHub
// barber "The Work" gallery). Each tile spans 6 of 12 columns (→ 2 per row)
// at a 1:1 aspect, so the gallery reads as a tidy block, not a mixed mosaic.
export const GALLERY_SPEC: { col: string; ratio: string }[] = [
  { col: 'span 6', ratio: '1 / 1' },
  { col: 'span 6', ratio: '1 / 1' },
  { col: 'span 6', ratio: '1 / 1' },
  { col: 'span 6', ratio: '1 / 1' },
  { col: 'span 6', ratio: '1 / 1' },
  { col: 'span 6', ratio: '1 / 1' },
];
// Scoped CSS — everything lives under `.prime-root` so it can't leak into
// the luxe / euphoria flows. Gold/black tokens by default; the color picker
// overrides --p-brand via inline style on the root.
export const PRIME_SCOPED_CSS = `
.prime-root {
  --p-bg:        #0a0a0a;
  --p-bg-2:      #111111;
  --p-bg-3:      #161616;
  --p-ink:       #f0ece4;
  --p-ink-soft:  #9a958e;
  --p-ink-muted: #6e6962;
  --p-line:      rgba(255,255,255,0.18);
  --p-line-soft: rgba(255,255,255,0.08);
  --p-brand:        #d4a64a;
  --p-brand-bright: #e8c074;
  --p-brand-deep:   #a87f30;
  --p-cream:     #f0ece4;
  background: var(--p-bg);
  color: var(--p-ink);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-weight: 400;
  line-height: 1.7;
}
.prime-root .p-serif { font-family: 'Newsreader', Georgia, serif; }
.prime-root .p-display { font-family: 'Newsreader', Georgia, serif; font-weight: 500; letter-spacing: -0.01em; line-height: 1.05; }
.prime-root h1, .prime-root h2, .prime-root h3, .prime-root h4 { font-family: 'Newsreader', Georgia, serif; font-weight: 500; letter-spacing: -0.01em; }
.prime-root .p-italic { font-style: italic; }
.prime-root .p-eyebrow { font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.3em; font-size: 11px; color: var(--p-brand); }
.prime-root .p-section { padding: 72px 6vw; }
.prime-root .p-container { max-width: 1200px; margin: 0 auto; }
.prime-root .p-rule { height: 1px; background: var(--p-line-soft); width: 100%; }
.prime-root .p-cta {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 14px 28px; border: 1px solid var(--p-brand); color: var(--p-ink);
  text-transform: uppercase; letter-spacing: 0.22em; font-size: 11px; font-weight: 600;
  background: transparent; text-decoration: none; border-radius: 2px;
  font-family: 'Inter', sans-serif; transition: all 200ms ease; white-space: nowrap;
}
.prime-root .p-cta:hover { background: var(--p-brand); color: #1a1a1a; }
.prime-root .p-cta-solid { background: var(--p-brand); color: #1a1a1a; border-color: var(--p-brand); }
.prime-root .p-cta-solid:hover { background: var(--p-brand-bright); border-color: var(--p-brand-bright); color: #1a1a1a; }
.prime-root .p-editable { outline: none; border-radius: 2px; padding: 0 2px; margin: 0 -2px; transition: box-shadow 150ms ease; }
.prime-root .p-editable:focus { box-shadow: 0 0 0 1px var(--p-brand-bright); }
.prime-root .p-welcome {
  display: flex; align-items: center; justify-content: center; gap: 14px;
  padding: 9px 16px; border-bottom: 1px solid var(--p-line-soft); background: #000;
  font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.34em; color: var(--p-brand);
}
.prime-root .p-dropcap::first-letter {
  font-family: 'Newsreader', Georgia, serif; font-style: italic; font-weight: 700;
  color: var(--p-brand); float: left; font-size: 5rem; line-height: 0.8; padding: 8px 14px 0 0;
}
.prime-root .p-img-tile { position: relative; overflow: hidden; background: var(--p-bg-3); }
.prime-root .p-img-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.prime-root .p-img-overlay {
  position: absolute; inset: 0; z-index: 1; display: flex; align-items: flex-end; justify-content: flex-end;
  padding: 12px; cursor: pointer; background: transparent; transition: background 150ms ease;
}
.prime-root .p-img-overlay:hover { background: rgba(0,0,0,0.18); }
.prime-root .p-img-pill {
  pointer-events: none; display: inline-flex; align-items: center; gap: 5px; padding: 6px 10px;
  border-radius: 999px; background: rgba(0,0,0,0.72); color: #fff; font-family: 'Inter', sans-serif;
  font-size: 8px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.12);
}
.prime-root .p-img-pill svg { width: 11px; height: 11px; }
/* Large hero variant — matches Design 1's hero "Replace Photo" pill size. */
.prime-root .p-img-overlay--lg { padding: 18px; }
.prime-root .p-img-pill--lg { font-size: 11px; padding: 11px 18px; gap: 8px; }
.prime-root .p-img-pill--lg svg { width: 18px; height: 18px; }
.prime-root .p-img-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 100%; height: 100%; background: var(--p-bg-3); border: 1px dashed var(--p-line);
  cursor: pointer; color: var(--p-ink-soft);
}
.prime-root .p-svc { border: 1px solid var(--p-line); background: var(--p-bg-2); }
.prime-root .p-svc-row {
  display: grid; grid-template-columns: 1fr auto; gap: 20px; padding: 18px 28px;
  border-bottom: 1px dashed rgba(212,166,74,0.22); align-items: baseline;
}
.prime-root .p-svc-row:last-child { border-bottom: none; }
.prime-root .p-gallery { display: grid; grid-template-columns: repeat(12, 1fr); gap: 12px; max-width: 760px; margin: 0 auto; }
.prime-root .p-review-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.prime-root .p-review-card { background: var(--p-bg-3); border: 1px solid var(--p-line); border-radius: 4px; padding: 22px; transition: all 200ms ease; }
.prime-root .p-review-card:hover { border-color: var(--p-brand); transform: translateY(-3px); box-shadow: 0 8px 24px rgba(212,166,74,0.08); }
.prime-root .p-avatar {
  width: 38px; height: 38px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
  font-family: 'Newsreader', serif; font-style: italic; color: #1a1a1a;
  background: linear-gradient(135deg, var(--p-brand), var(--p-brand-deep));
}
.prime-root .p-hours-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--p-line-soft); }
@media (max-width: 767px) {
  .prime-root .p-gallery { grid-template-columns: repeat(2, 1fr); }
  .prime-root .p-gallery > div { grid-column: span 1 !important; }
  .prime-root .p-review-grid { grid-template-columns: 1fr; }
  .prime-root .p-section { padding: 52px 6vw; }
  .prime-root .p-grid-2 { grid-template-columns: 1fr !important; }
}
`;
export const PRIME_FONT_LINK_ID = 'prime-fonts';
export const PRIME_STYLE_ID = 'prime-scoped-styles';
export function escapeHtml(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// 24h → 12h with AM/PM. Idempotent (passes AM/PM strings through). Same
// helper used by the luxe renderer so hours read consistently.
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
export const fmtHours = (h: { open: string; close: string; closed?: boolean }, closedText = 'Closed'): string =>
  h.closed ? closedText : `${to12h(h.open)} – ${to12h(h.close)}`;
// Trailing "City, State" only — keeps the hero eyebrow from echoing a full
// street address even if one is pasted in.
export const cityStateOnly = (raw: string): string => {
  const parts = (raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return raw || '';
  return parts.slice(-2).join(', ');
};
// Resolve the gold trio from a colorTheme slug or raw hex. Mirrors the
// preset set used by the luxe/euphoria renderers so a picked color carries
// across designs.
export function resolvePrimeTheme(slug?: string): { brand: string; bright: string; deep: string; bg: string; bg2: string; bg3: string } | null {
  if (!slug) return null;
  if (slug.charAt(0) === '#') return { brand: slug, bright: slug, deep: slug, bg: '#0a0a0a', bg2: '#111111', bg3: '#161616' };
  if (slug === 'blackWhite') return { brand: '#ffffff', bright: '#f5f5f5', deep: '#cccccc', bg: '#0a0a0a', bg2: '#111111', bg3: '#161616' };
  if (slug === 'redBlack') return { brand: '#dc2626', bright: '#ef4444', deep: '#991b1b', bg: '#0a0a0a', bg2: '#111111', bg3: '#161616' };
  if (slug === 'purpleGreen') return { brand: '#22c55e', bright: '#4ade80', deep: '#15803d', bg: '#160328', bg2: '#1f0436', bg3: '#2a0747' };
  return null; // goldBlack / unknown → defaults from PRIME_SCOPED_CSS
}
// The inline style that puts a picked colour theme on the root element ('' for the default gold).
export function primeRootStyle(slug?: string): string {
  const theme = resolvePrimeTheme(slug);
  return theme
    ? `--p-brand:${theme.brand};--p-brand-bright:${theme.bright};--p-brand-deep:${theme.deep};--p-bg:${theme.bg};--p-bg-2:${theme.bg2};--p-bg-3:${theme.bg3};background:${theme.bg};`
    : '';
}
// ===========================================================================
// Deploy export — builds the static HTML with {{image}} placeholders that
// /api/deploy-site swaps for uploaded URLs. Mirrors the luxe/euphoria
// builders; only the prime sections differ. Reviews / hours / gallery render
// only when data is present, matching the live editor.
// ===========================================================================
// Book strip and Shop preview in PRIME's look (brand colour from the theme vars).
const PRIME_SKIN: SectionSkin = {
  section: 'p-section',
  inner: 'p-container ab-sub',
  heading: 'p-display',
  list: 'p-svc ab-sub-list',
  item: 'p-svc-row',
  name: 'p-serif p-italic ab-sub-name',
  price: 'p-serif p-italic ab-sub-price',
  button: 'p-cta p-cta-solid',
  grid: 'ab-sub-grid',
  link: 'p-cta',
  css: '.ab-sub{text-align:center}.ab-sub .p-display{font-size:clamp(28px,5vw,46px);margin:0 0 28px}'
    + '.ab-sub-list{max-width:640px;margin:0 auto 28px;text-align:left}.ab-sub-name{font-size:1.2rem;font-weight:600}'
    + '.ab-sub-price{font-size:1.4rem;color:var(--p-brand-bright);white-space:nowrap}'
    + '.ab-sub-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin:0 auto 28px;max-width:880px;text-align:left}'
    + '@media(min-width:768px){.ab-sub-grid{grid-template-columns:repeat(4,1fr)}}'
    + '.ab-sp-card{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:var(--p-ink)}'
    + '.ab-sp-img{width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--p-bg-3)}'
    + ".ab-sp-name{font-family:'Newsreader',Georgia,serif;font-style:italic;font-size:1.05rem}"
    + '.ab-sp-price{color:var(--p-brand-bright)}',
};

export function generatePrimeHTMLWithPlaceholders(input: WebsiteData, ctx?: RenderCtx): string {
  // Older stored sites: drop the copy we invented for them (honest.ts).
  const siteData = withoutLegacyCopy(input);
  const bookingUrl = safeHref(siteData.bookingUrl);
  const shopUrl = safeHref(siteData.shopUrl);
  // The site's own /book page opens in the same tab; another booking site in a new one.
  const bookTarget = bookingUrl && !isSiteBookLink(bookingUrl) ? ' target="_blank" rel="noopener noreferrer"' : '';
  // Homepage previews of the site's own /book and /shop pages (lib/render/subpages.ts).
  const bookStrip = bookStripHtml(siteData, PRIME_SKIN, { heading: t(siteData.labels, 'bookStripHeading', undefined, siteData), button: t(siteData.labels, 'bookStripButton', undefined, siteData) });
  const shopPreview = shopPreviewHtml(siteData, PRIME_SKIN);
  const formattedPhone = escapeHtml((siteData.phone || '').replace(/\s+/g, ''));
  const phoneDigits = (siteData.phone || '').replace(/\D/g, '');
  // Book: the booking link, else a call. Neither → no booking buttons.
  const bookHref = bookingUrl || (phoneDigits ? `tel:+1${phoneDigits}` : '');
  // Small visible text comes from the label registry (labels.ts); t() escapes.
  const copy = nicheCopy(siteData);
  const niche = nicheOf(siteData);
  const L = (key: LabelKey) => t(siteData.labels, key, niche, siteData);
  // A multi-page site (lib/render/site.ts passes its page set): the header carries the page menu.
  // Without a page set, or with Home alone, this is the single-page site every web publish ships.
  const menuSet = ctx?.pages && hasFilePages(ctx.pages) ? ctx.pages : null;
  const safeName = escapeHtml(siteData.shopName);
  const safeAreaShort = escapeHtml(cityStateOnly(siteData.area));
  const mapQuery = encodeURIComponent(`${siteData.shopName} ${siteData.area}`);
  const rootStyle = primeRootStyle(siteData.colorTheme);

  // Only a scraped aggregate; unreadable → none.
  const agg = aggregateToShow(siteData);
  // The barber's own wording around the real figures (labels.ts), else the standard text.
  const ratingCustom = ratingLineCustom(siteData);
  const altAttr = escapeHtml(photoAlt(siteData));
  const showServices = hasServices(siteData);
  const ratingChip = agg
    ? `<span style="color:var(--p-brand);">★ ${agg.rating.toFixed(1)}${agg.count > 0 ? ` · ${agg.count.toLocaleString()} reviews` : ''}</span>`
    : '';

  // About stat ribbon (rating / reviews) — only with an aggregate rating.
  const statRibbon = agg
    ? `<div class="p-grid-2" style="display:grid;grid-template-columns:${agg.count > 0 ? '1fr 1fr' : '1fr'};gap:1px;margin-top:28px;border:1px solid rgba(212,166,74,0.25);background:rgba(212,166,74,0.04);">
        <div style="text-align:center;padding:18px;"><div class="p-serif p-italic" style="font-size:2rem;color:var(--p-brand);">${agg.rating.toFixed(1)}</div><div class="p-eyebrow" style="font-size:9px;margin-top:4px;color:var(--p-ink-muted);">${L('primeStatRating')}</div></div>
        ${agg.count > 0 ? `<div style="text-align:center;padding:18px;border-left:1px solid rgba(212,166,74,0.25);"><div class="p-serif p-italic" style="font-size:2rem;color:var(--p-brand);">${agg.count.toLocaleString()}</div><div class="p-eyebrow" style="font-size:9px;margin-top:4px;color:var(--p-ink-muted);">${L('primeStatReviews')}</div></div>` : ''}
      </div>`
    : '';

  const aboutImageMarkup = siteData.about.imageUrl
    ? `<div class="p-img-tile" style="aspect-ratio:4/5;"><img src="{{about}}" alt="${altAttr}"></div>`
    : '';

  // Services + prices table.
  const services = (siteData.services || []).filter((s) => (s?.title || '').trim());
  const servicesSection = showServices
    ? `<section id="services" class="p-section">
  <div class="p-container">
    <div style="text-align:center;margin-bottom:36px;">
      <div class="p-eyebrow">${L('primeServicesEyebrow')}</div>
      <h2 class="p-display" style="font-size:clamp(28px,5vw,46px);margin-top:14px;">${L('primeServicesLead')} <span class="p-italic" style="color:var(--p-brand);">${L('primeServicesAccent')}</span></h2>
    </div>
    <div class="p-svc" style="max-width:880px;margin:0 auto;">
      ${services.map((s) => {
        const meta = serviceMeta(s);
        const price = displayPrice(s.price);
        const cat = s.category ? ` · ${escapeHtml(s.category)}` : '';
        return `<div class="p-svc-row">
          <div>
            <div class="p-serif p-italic" style="font-size:1.25rem;font-weight:600;">${escapeHtml(s.title)}</div>
            ${meta ? `<div class="p-eyebrow" style="font-size:10px;margin-top:6px;">${escapeHtml(meta)}${cat}</div>` : ''}
            ${s.description ? `<p class="p-serif" style="color:var(--p-ink-soft);font-size:0.9rem;margin-top:8px;max-width:560px;">${escapeHtml(s.description)}</p>` : ''}
          </div>
          ${price ? `<div class="p-serif p-italic" style="font-size:1.6rem;color:var(--p-brand-bright);white-space:nowrap;">${escapeHtml(price)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  </div>
</section>`
    : '';

  // Policy — barber-written only, and independent of the services list.
  const policy = policyToShow(siteData);
  const policySection = policy
    ? `<section class="p-section" style="padding-top:${showServices ? '0' : '48px'};">
  <div class="p-container">
    <div style="max-width:880px;margin:0 auto;display:grid;grid-template-columns:auto 1fr;gap:28px;padding:24px 28px;border:1px solid var(--p-brand-deep);background:rgba(212,166,74,0.05);" class="p-grid-2">
      <div class="p-eyebrow" style="white-space:nowrap;">${L('primePolicyEyebrow')}</div>
      <div>${policy.title ? `<h3 style="font-size:1.2rem;margin:0 0 8px;">${escapeHtml(policy.title)}</h3>` : ''}<p class="p-serif" style="color:var(--p-ink-soft);font-size:0.95rem;margin:0;">${escapeHtml(policy.body)}</p></div>
    </div>
  </div>
</section>`
    : '';

  // Gallery mosaic (first 6 filled photos).
  const galleryTiles = (siteData.gallery || []).slice(0, 6).map((url, i) => ({ url, i })).filter(t => t.url);
  const gallerySection = galleryTiles.length > 0
    ? `<section class="p-section" style="padding-top:48px;">
  <div class="p-container">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;margin-bottom:32px;">
      <div><div class="p-eyebrow">${L('primeGalleryEyebrow')}</div><h2 class="p-display" style="font-size:clamp(28px,4.5vw,44px);margin-top:12px;"><span class="p-italic" style="color:var(--p-brand);">${L('primeGalleryHeading')}</span></h2></div>
      ${photosAreFromBookingPage(siteData) && galleryIsAllOwnPhotos(galleryTiles.map((t) => t.url)) ? `<p class="p-serif p-italic" style="color:var(--p-ink-soft);">Real cuts from inside the shop — no stock photos.</p>` : ''}
    </div>
    <div class="p-gallery">
      ${galleryTiles.map((t) => {
        const spec = GALLERY_SPEC[t.i] || GALLERY_SPEC[0];
        return `<div class="p-img-tile" style="grid-column:${spec.col};aspect-ratio:${spec.ratio};"><img src="{{gallery${t.i}}}" alt="${altAttr}"></div>`;
      }).join('')}
    </div>
  </div>
</section>`
    : '';

  // Team (honest.ts teamOf: max 5 cards, the stored staff[] is never cut). Book button rules: teamBookLink.
  const team = teamOf(siteData);
  const bookingLive = isSiteBookLink(siteData.bookingUrl);
  const teamSection = team.length > 0
    ? `<section id="team" class="p-section" style="padding-top:48px;">
  <style>.ab-team-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;max-width:1000px;margin:0 auto}.ab-team-card{text-align:center;display:flex;flex-direction:column;gap:8px}.ab-team-photo{width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--p-bg-3);display:flex;align-items:center;justify-content:center;font-size:2.4rem;color:var(--p-brand)}.ab-team-bio{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.ab-team-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}.ab-team-chip{font-size:10px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--p-line);padding:3px 8px}</style>
  <div class="p-container">
    <div style="text-align:center;margin-bottom:32px;">
      <div class="p-eyebrow">${L('primeTeamEyebrow')}</div>
      <h2 class="p-display" style="font-size:clamp(28px,4.5vw,44px);margin-top:12px;"><span class="p-italic" style="color:var(--p-brand);">${L('primeTeamHeading')}</span></h2>
    </div>
    <div class="ab-team-grid">
      ${team.map((m) => {
        const link = teamBookLink(siteData, m, bookingLive);
        return `<div class="p-review-card ab-team-card" id="team-${escapeHtml(m.slug)}">
        ${m.photo ? `<img class="ab-team-photo" src="{{staff${m.index}}}" alt="${escapeHtml(m.name)}">` : `<div class="ab-team-photo" aria-hidden="true">${escapeHtml(Array.from(m.name)[0].toUpperCase())}</div>`}
        <h3 class="p-serif" style="font-size:1.2rem;margin:0;">${escapeHtml(m.name)}</h3>
        ${m.role ? `<div class="p-eyebrow" style="font-size:10px;">${escapeHtml(m.role)}</div>` : ''}
        ${m.bio ? `<p class="p-serif p-italic ab-team-bio" style="color:var(--p-ink-soft);font-size:0.9rem;">${escapeHtml(m.bio)}</p>` : ''}
        ${m.serviceNames ? `<div class="ab-team-chips">${m.serviceNames.map((n) => `<span class="ab-team-chip">${escapeHtml(n)}</span>`).join('')}</div>` : ''}
        ${link ? `<a href="${escapeHtml(link.href)}"${link.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''} class="p-cta" style="padding:10px 14px;font-size:10px;justify-content:center;">${link.kind === 'member' ? `${L('teamBookWith')} ${escapeHtml(firstName(m.name))}` : L('primeNavBook')}</a>` : ''}
      </div>`;
      }).join('')}
    </div>
  </div>
</section>`
    : '';

  // Reviews.
  const reviews = visibleReviews(siteData);
  const reviewsSection = reviews.length > 0
    ? `<section class="p-section" style="background:var(--p-bg-2);">
  <div class="p-container">
    <div style="text-align:center;margin-bottom:32px;">
      <div class="p-eyebrow">${L('primeReviewsEyebrow')}</div>
      <h2 class="p-display" style="font-size:clamp(28px,5vw,46px);margin-top:14px;">${L('primeReviewsLead')} <span class="p-italic" style="color:var(--p-brand);">${L('primeReviewsAccent')}</span></h2>
      ${reviewsSourceLabel(siteData) ? `<p data-reviews-source class="p-serif p-italic" style="color:var(--p-ink-soft);margin:10px 0 0;">${escapeHtml(reviewsSourceLabel(siteData))}</p>` : ''}
    </div>
    ${agg ? `<div style="max-width:820px;margin:0 auto 32px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:22px 28px;border:1px solid var(--p-brand);background:linear-gradient(135deg,rgba(212,166,74,0.18),rgba(212,166,74,0.05));" class="p-grid-2">
      <div><h3 style="font-size:1.15rem;margin:0;">${ratingCustom !== null ? escapeHtml(ratingCustom) : `${agg.rating.toFixed(1)} stars${agg.count > 0 ? ` across ${agg.count.toLocaleString()} reviews` : ''}`}</h3></div>
      <div style="text-align:right;"><div class="p-serif p-italic" style="font-size:2.4rem;color:var(--p-brand);">${agg.rating.toFixed(1)}</div><div style="color:var(--p-brand);">${'★'.repeat(Math.round(agg.rating))}</div></div>
    </div>` : ''}
    <div class="p-review-grid">
      ${reviews.slice(0, 6).map((r) => `<div class="p-review-card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div class="p-avatar">${escapeHtml((r.author || '★').charAt(0).toUpperCase())}</div>
          <div><div class="p-serif" style="font-weight:600;font-size:1.05rem;">${escapeHtml(r.author || 'Client')}</div>${r.date ? `<div class="p-eyebrow" style="font-size:9.5px;margin-top:2px;color:var(--p-ink-muted);">${escapeHtml(r.date)}</div>` : ''}</div>
        </div>
        ${(() => { const n = reviewStars(r); return n !== null ? `<div style="color:var(--p-brand);margin-bottom:8px;">${'★'.repeat(n)}</div>` : ''; })()}
        <p class="p-serif p-italic" style="color:var(--p-ink-soft);font-size:0.95rem;margin:0;">${escapeHtml(r.comment || '')}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`
    : '';

  // Pull quote.
  // The barber's own pull quote, else a generic line for their niche.
  const pullQuote = siteData.pullQuote && (siteData.pullQuote.text || '').trim()
    ? siteData.pullQuote
    : { text: copy.pullQuote };
  const pullQuoteSection = `<section class="p-section" style="background:radial-gradient(ellipse at center, rgba(212,166,74,0.07) 0%, transparent 60%), var(--p-bg);text-align:center;">
  <div style="max-width:1000px;margin:0 auto;">
    <p class="p-serif p-italic" style="font-size:clamp(1.5rem,3.6vw,2.7rem);line-height:1.3;color:var(--p-ink);margin:0;">${escapeHtml(pullQuote.text)}${pullQuote.accent ? ` <span style="color:var(--p-brand);font-weight:600;">${escapeHtml(pullQuote.accent)}</span>` : ''}</p>
  </div>
</section>`;

  // Hours — or a map fallback when none, mirroring the editor's Visit column.
  const hours = siteData.hours || [];
  const hoursMarkup = hours.length > 0
    ? `<div>
        <div class="p-eyebrow" style="margin-bottom:14px;">${L('primeHoursEyebrow')}</div>
        <ul style="list-style:none;margin:0;padding:0;">
          ${hours.map((h) => `<li class="p-hours-row"><span style="text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">${escapeHtml(h.day)}</span><span class="p-serif p-italic" style="font-size:1.05rem;color:var(--p-brand);">${h.closed ? L('primeClosedLabel') : escapeHtml(fmtHours(h))}</span></li>`).join('')}
        </ul>
      </div>`
    : `<div><iframe src="https://maps.google.com/maps?q=${mapQuery}&output=embed" width="100%" height="320" style="border:0;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${safeName} on Google Maps"></iframe></div>`;

  // Booking-strip note (e.g. a walk-in line): barber-written only.
  const bookingNote = L('bookingNote');

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
  <title>${escapeHtml(siteTitle(siteData))}</title>
  <meta name="description" content="${escapeHtml(siteDescription(siteData))}">
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "w5jdq6huun");
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #0a0a0a; color: #f0ece4; font-family: 'Inter', system-ui, sans-serif; }
    a { color: inherit; }
    img { max-width: 100%; height: auto; }
${PRIME_SCOPED_CSS}${menuSet ? HEADER_CSS.prime + NAV_CSS.prime : ''}
  </style>
</head>
<body>
<div class="prime-root" style="${rootStyle}">

  <!-- Welcome bar -->
  <div class="p-welcome"><span>${L('primeWelcome')}</span>${safeAreaShort ? `<span style="color:var(--p-ink-muted);">${safeAreaShort}</span>` : ''}${ratingChip}</div>

  <!-- Nav -->
  ${menuSet ? headerHtml('prime', { name: siteData.shopName, cta: bookHref ? { href: bookHref, label: L('primeNavBook'), newTab: bookTarget !== '' } : null, nav: navListHtml(navItemsFor('prime', menuSet, siteData, 'home'), L('pgMenu')) }) : `<nav style="position:sticky;top:0;z-index:50;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--p-line-soft);">
    <div class="p-container" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 6vw;">
      <a href="#top" class="p-serif" style="text-decoration:none;color:var(--p-ink);font-size:20px;letter-spacing:0.04em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeName}</a>${shopUrl ? `
      <a href="${escapeHtml(shopUrl)}" class="p-eyebrow" style="text-decoration:none;flex-shrink:0;white-space:nowrap;">${L('primeNavShop')}</a>` : ''}
      ${bookHref ? `<a href="${escapeHtml(bookHref)}"${bookTarget} class="p-cta p-cta-solid" style="padding:10px 18px;font-size:10px;flex-shrink:0;">${L('primeNavBook')}</a>` : ''}
    </div>
  </nav>`}

  <!-- Hero -->
  <section id="top" style="position:relative;min-height:42vh;display:flex;align-items:center;justify-content:center;overflow:hidden;">
    ${siteData.hero.imageUrl ? `<img src="{{hero}}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(0.5) contrast(1.08);">` : ''}
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 70%), linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.7) 100%);"></div>
    <div class="p-container" style="position:relative;text-align:center;padding:32px 6vw;">
      <div class="p-eyebrow" style="margin-bottom:12px;">${L('primeHeroEyebrow')}</div>
      <h1 class="p-display p-italic" style="font-size:clamp(2.2rem,5.5vw,4.6rem);margin:0 0 14px;color:var(--p-brand);">${escapeHtml(siteData.hero.heading)}</h1>
      <p class="p-serif p-italic" style="font-size:clamp(1rem,2.2vw,1.4rem);color:var(--p-ink-soft);max-width:640px;margin:0 auto 22px;">${escapeHtml(siteData.hero.tagline)}</p>
      <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
        ${bookHref ? `<a href="${escapeHtml(bookHref)}"${bookTarget} class="p-cta p-cta-solid">${L('primeBookButton')}</a>` : ''}
        ${showServices ? `<a href="#services" class="p-cta">${L('primeViewServices')}</a>` : ''}
      </div>
      ${agg ? `<div style="margin-top:28px;color:var(--p-ink-soft);font-size:13px;"><span style="color:var(--p-brand);">${'★'.repeat(Math.round(agg.rating))}</span> ${ratingCustom !== null ? escapeHtml(ratingCustom) : `${agg.rating.toFixed(1)}${agg.count > 0 ? ` · ${agg.count.toLocaleString()} reviews` : ''}`}</div>` : ''}
    </div>
  </section>

  <!-- About -->
  <section class="p-section">
    <div class="p-container p-grid-2" style="display:grid;grid-template-columns:${siteData.about.imageUrl ? '1fr 1fr' : '1fr'};gap:56px;align-items:start;">
      <div>
        <div class="p-eyebrow" style="margin-bottom:14px;">${L('primeAboutEyebrow')}</div>
        <h2 class="p-display" style="font-size:clamp(2rem,4.2vw,3.2rem);margin:0 0 28px;">${escapeHtml(siteData.about.heading)}</h2>
        ${siteData.about.description.map((p, i) => `<p class="p-serif ${i === 0 ? 'p-dropcap' : ''}" style="font-size:1.06rem;line-height:1.75;color:var(--p-ink-soft);margin:0 0 18px;">${escapeHtml(p)}</p>`).join('')}
        ${statRibbon}
      </div>
      ${aboutImageMarkup}
    </div>
  </section>

  ${servicesSection}${bookStrip}

  ${policySection}

  ${gallerySection}${teamSection}

  ${reviewsSection}

  ${pullQuoteSection}${shopPreview}

  <!-- Booking strip -->
  <section style="background:var(--p-cream);color:#1a1a1a;text-align:center;padding:64px 6vw;">
    <div class="p-eyebrow" style="color:var(--p-brand-deep);margin-bottom:14px;">${L('primeBookingEyebrow')}</div>
    <h2 class="p-display" style="font-size:clamp(2rem,5vw,3rem);margin:0 0 16px;color:#1a1a1a;">${L('primeBookingLead')} <span class="p-italic">${L('primeBookingNext')}</span></h2>
    ${bookingNote ? `<p class="p-serif p-italic" style="color:#555;margin:0 0 28px;">${bookingNote}</p>` : ''}
    ${bookHref ? `<a href="${escapeHtml(bookHref)}"${bookTarget} class="p-cta" style="background:#1a1a1a;color:var(--p-brand);border-color:#1a1a1a;">${L('primeBookButton')}</a>` : ''}
  </section>

  <!-- Visit -->
  <section class="p-section" style="background:var(--p-bg-2);">
    <div class="p-container p-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:48px;">
      <div>
        <div class="p-eyebrow" style="margin-bottom:16px;">${L('primeVisitEyebrow')}</div>
        <h2 class="p-display" style="font-size:clamp(1.8rem,4vw,2.8rem);margin:0 0 28px;">${L('primeVisitHeading')}</h2>
        <div style="display:grid;gap:22px;color:var(--p-ink-soft);font-size:16px;line-height:1.6;">
          ${siteData.contact.address ? `<div><div class="p-eyebrow" style="margin-bottom:6px;">${L('primeAddressLabel')}</div><div class="p-serif p-italic" style="color:var(--p-ink);font-size:1.2rem;">${escapeHtml(siteData.contact.address)}</div></div>` : ''}
          ${phoneDigits ? `<div><div class="p-eyebrow" style="margin-bottom:6px;">${L('primePhoneLabel')}</div><a href="tel:${formattedPhone}" class="p-serif p-italic" style="color:var(--p-ink);font-size:1.2rem;text-decoration:none;">${escapeHtml(displayPhone(siteData.phone))}</a></div>` : ''}
          ${bookingUrl ? `<div><div class="p-eyebrow" style="margin-bottom:6px;">${L('primeOnlineBookingLabel')}</div><a href="${escapeHtml(bookingUrl)}"${bookTarget} class="p-serif p-italic" style="color:var(--p-ink);font-size:1.1rem;">${L('primeBookOnlineLink')}</a></div>` : ''}${shopUrl ? `
          <div><div class="p-eyebrow" style="margin-bottom:6px;">${L('primeShopLabel')}</div><a href="${escapeHtml(shopUrl)}" class="p-serif p-italic" style="color:var(--p-ink);font-size:1.1rem;">${L('primeShopLink')}</a></div>` : ''}
        </div>
      </div>
      ${hoursMarkup}
    </div>
  </section>

  <!-- Footer -->
  <footer style="padding:48px 6vw;border-top:1px solid var(--p-line-soft);text-align:center;">
    <div class="p-container">
      <div class="p-serif p-italic" style="font-size:18px;color:var(--p-brand);margin-bottom:8px;">${safeName}</div>
      <div class="p-eyebrow" style="color:var(--p-ink-muted);">© ${copyrightYear()} · Built by Prime Barber</div>
    </div>
  </footer>

</div>
</body>
</html>`;
}
