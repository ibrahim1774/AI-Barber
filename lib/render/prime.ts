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

// Seed copy used when a prime site has no policy / pull-quote of its own
// (e.g. an existing booksy luxe site switched over to Design 2). Both the
// editor and the deploy builder fall back to these so the design always
// looks complete; edits write back onto WebsiteData.policy / .pullQuote.
export const DEFAULT_POLICY: { title: string; body: string } = {
  title: 'Before you arrive',
  body: 'We work appointment-only — your booked time is held for you. Cancellations within 4 hours of the appointment, and no-shows, are billed in full. Please come freshly washed; products and a hot-towel finish are included in every cut.',
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
export const fmtHours = (h: { open: string; close: string; closed?: boolean }): string =>
  h.closed ? 'Closed' : `${to12h(h.open)} – ${to12h(h.close)}`;
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
// ===========================================================================
// Deploy export — builds the static HTML with {{image}} placeholders that
// /api/deploy-site swaps for uploaded URLs. Mirrors the luxe/euphoria
// builders; only the prime sections differ. Reviews / hours / gallery render
// only when data is present, matching the live editor.
// ===========================================================================
export function generatePrimeHTMLWithPlaceholders(siteData: WebsiteData): string {
  const formattedPhone = (siteData.phone || '').replace(/\s+/g, '');
  const phoneE164 = '+1' + (siteData.phone || '').replace(/\D/g, '');
  const bookHref = siteData.bookingUrl || `tel:${phoneE164}`;
  const safeName = escapeHtml(siteData.shopName);
  const safeArea = escapeHtml(siteData.area);
  const safeAreaShort = escapeHtml(cityStateOnly(siteData.area));
  const mapQuery = encodeURIComponent(`${siteData.shopName} ${siteData.area}`);
  const theme = resolvePrimeTheme(siteData.colorTheme);
  const rootStyle = theme
    ? `--p-brand:${theme.brand};--p-brand-bright:${theme.bright};--p-brand-deep:${theme.deep};--p-bg:${theme.bg};--p-bg-2:${theme.bg2};--p-bg-3:${theme.bg3};background:${theme.bg};`
    : '';

  const agg = siteData.aggregateRating;
  const ratingChip = agg
    ? `<span style="color:var(--p-brand);">★ ${agg.rating.toFixed(1)}${agg.count > 0 ? ` · ${agg.count.toLocaleString()} reviews` : ''}</span>`
    : '';

  // About stat ribbon (rating / reviews) — only with an aggregate rating.
  const statRibbon = agg
    ? `<div class="p-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:28px;border:1px solid rgba(212,166,74,0.25);background:rgba(212,166,74,0.04);">
        <div style="text-align:center;padding:18px;"><div class="p-serif p-italic" style="font-size:2rem;color:var(--p-brand);">${agg.rating.toFixed(1)}</div><div class="p-eyebrow" style="font-size:9px;margin-top:4px;color:var(--p-ink-muted);">Rating</div></div>
        <div style="text-align:center;padding:18px;border-left:1px solid rgba(212,166,74,0.25);"><div class="p-serif p-italic" style="font-size:2rem;color:var(--p-brand);">${agg.count.toLocaleString()}</div><div class="p-eyebrow" style="font-size:9px;margin-top:4px;color:var(--p-ink-muted);">Reviews</div></div>
      </div>`
    : '';

  const aboutImageMarkup = siteData.about.imageUrl
    ? `<div class="p-img-tile" style="aspect-ratio:4/5;"><img src="{{about}}" alt="${safeName}"></div>`
    : '';

  // Services + prices table.
  const services = siteData.services || [];
  const servicesSection = services.length > 0
    ? `<section id="services" class="p-section">
  <div class="p-container">
    <div style="text-align:center;margin-bottom:36px;">
      <div class="p-eyebrow">Services &amp; Prices</div>
      <h2 class="p-display" style="font-size:clamp(28px,5vw,46px);margin-top:14px;">A complete <span class="p-italic" style="color:var(--p-brand);">repertoire.</span></h2>
      <p class="p-serif p-italic" style="color:var(--p-ink-soft);margin-top:10px;">From the cut to the finish — every detail done in chair.</p>
    </div>
    <div class="p-svc" style="max-width:880px;margin:0 auto;">
      ${services.map((s) => {
        const meta = s.duration || s.subtitle || '';
        const cat = s.category ? ` · ${escapeHtml(s.category)}` : '';
        return `<div class="p-svc-row">
          <div>
            <div class="p-serif p-italic" style="font-size:1.25rem;font-weight:600;">${escapeHtml(s.title)}</div>
            ${meta ? `<div class="p-eyebrow" style="font-size:10px;margin-top:6px;">${escapeHtml(meta)}${cat}</div>` : ''}
            ${s.description ? `<p class="p-serif" style="color:var(--p-ink-soft);font-size:0.9rem;margin-top:8px;max-width:560px;">${escapeHtml(s.description)}</p>` : ''}
          </div>
          ${s.price ? `<div class="p-serif p-italic" style="font-size:1.6rem;color:var(--p-brand-bright);white-space:nowrap;">${escapeHtml(s.price)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${(() => { const policy = siteData.policy || DEFAULT_POLICY; return `<div style="max-width:880px;margin:28px auto 0;display:grid;grid-template-columns:auto 1fr;gap:28px;padding:24px 28px;border:1px solid var(--p-brand-deep);background:rgba(212,166,74,0.05);" class="p-grid-2">
      <div class="p-eyebrow" style="white-space:nowrap;">Please Note</div>
      <div><h3 style="font-size:1.2rem;margin:0 0 8px;">${escapeHtml(policy.title)}</h3><p class="p-serif" style="color:var(--p-ink-soft);font-size:0.95rem;margin:0;">${escapeHtml(policy.body)}</p></div>
    </div>`; })()}
  </div>
</section>`
    : '';

  // Gallery mosaic (first 6 filled photos).
  const galleryTiles = (siteData.gallery || []).slice(0, 6).map((url, i) => ({ url, i })).filter(t => t.url);
  const gallerySection = galleryTiles.length > 0
    ? `<section class="p-section" style="padding-top:48px;">
  <div class="p-container">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px;margin-bottom:32px;">
      <div><div class="p-eyebrow">The Work</div><h2 class="p-display" style="font-size:clamp(28px,4.5vw,44px);margin-top:12px;">Hand-cut, <span class="p-italic" style="color:var(--p-brand);">head by head.</span></h2></div>
      <p class="p-serif p-italic" style="color:var(--p-ink-soft);">Real cuts from inside the shop — no stock photos.</p>
    </div>
    <div class="p-gallery">
      ${galleryTiles.map((t) => {
        const spec = GALLERY_SPEC[t.i] || GALLERY_SPEC[0];
        return `<div class="p-img-tile" style="grid-column:${spec.col};aspect-ratio:${spec.ratio};"><img src="{{gallery${t.i}}}" alt="Gallery ${t.i + 1}"></div>`;
      }).join('')}
    </div>
  </div>
</section>`
    : '';

  // Reviews.
  const reviews = siteData.reviews || [];
  const reviewsSection = reviews.length > 0
    ? `<section class="p-section" style="background:var(--p-bg-2);">
  <div class="p-container">
    <div style="text-align:center;margin-bottom:32px;">
      <div class="p-eyebrow">Client Reviews</div>
      <h2 class="p-display" style="font-size:clamp(28px,5vw,46px);margin-top:14px;">What clients <span class="p-italic" style="color:var(--p-brand);">are saying.</span></h2>
    </div>
    ${agg ? `<div style="max-width:820px;margin:0 auto 32px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:22px 28px;border:1px solid var(--p-brand);background:linear-gradient(135deg,rgba(212,166,74,0.18),rgba(212,166,74,0.05));" class="p-grid-2">
      <div><h3 style="font-size:1.15rem;margin:0;">${agg.rating.toFixed(1)} stars across ${agg.count.toLocaleString()} verified reviews</h3><p class="p-serif p-italic" style="color:var(--p-ink-soft);margin:6px 0 0;">Pulled directly from the booking page.</p></div>
      <div style="text-align:right;"><div class="p-serif p-italic" style="font-size:2.4rem;color:var(--p-brand);">${agg.rating.toFixed(1)}</div><div style="color:var(--p-brand);">${'★'.repeat(Math.round(agg.rating))}</div></div>
    </div>` : ''}
    <div class="p-review-grid">
      ${reviews.slice(0, 6).map((r) => `<div class="p-review-card">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
          <div class="p-avatar">${escapeHtml((r.author || '★').charAt(0).toUpperCase())}</div>
          <div><div class="p-serif" style="font-weight:600;font-size:1.05rem;">${escapeHtml(r.author || 'Client')}</div>${r.date ? `<div class="p-eyebrow" style="font-size:9.5px;margin-top:2px;color:var(--p-ink-muted);">${escapeHtml(r.date)}</div>` : ''}</div>
        </div>
        <div style="color:var(--p-brand);margin-bottom:8px;">${'★'.repeat(Math.max(1, Math.min(5, r.rating || 5)))}</div>
        <p class="p-serif p-italic" style="color:var(--p-ink-soft);font-size:0.95rem;margin:0;">${escapeHtml(r.comment || '')}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`
    : '';

  // Pull quote.
  const pullQuote = siteData.pullQuote || DEFAULT_PULLQUOTE;
  const pullQuoteSection = `<section class="p-section" style="background:radial-gradient(ellipse at center, rgba(212,166,74,0.07) 0%, transparent 60%), var(--p-bg);text-align:center;">
  <div style="max-width:1000px;margin:0 auto;">
    <p class="p-serif p-italic" style="font-size:clamp(1.5rem,3.6vw,2.7rem);line-height:1.3;color:var(--p-ink);margin:0;">${escapeHtml(pullQuote.text)}${pullQuote.accent ? ` <span style="color:var(--p-brand);font-weight:600;">${escapeHtml(pullQuote.accent)}</span>` : ''}</p>
  </div>
</section>`;

  // Hours — or a map fallback when none, mirroring the editor's Visit column.
  const hours = siteData.hours || [];
  const hoursMarkup = hours.length > 0
    ? `<div>
        <div class="p-eyebrow" style="margin-bottom:14px;">Hours of Service</div>
        <ul style="list-style:none;margin:0;padding:0;">
          ${hours.map((h) => `<li class="p-hours-row"><span style="text-transform:uppercase;font-size:12px;letter-spacing:0.08em;">${escapeHtml(h.day)}</span><span class="p-serif p-italic" style="font-size:1.05rem;color:var(--p-brand);">${escapeHtml(fmtHours(h))}</span></li>`).join('')}
        </ul>
      </div>`
    : `<div><iframe src="https://maps.google.com/maps?q=${mapQuery}&output=embed" width="100%" height="320" style="border:0;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="${safeName} on Google Maps"></iframe></div>`;

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
  <title>${safeName} — Barbershop in ${safeArea}</title>
  <meta name="description" content="${safeName}. A premium barbershop in ${safeArea}. Precision cuts, classic grooming. Book online.">
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
${PRIME_SCOPED_CSS}
  </style>
</head>
<body>
<div class="prime-root" style="${rootStyle}">

  <!-- Welcome bar -->
  <div class="p-welcome"><span>Welcome</span>${safeAreaShort ? `<span style="color:var(--p-ink-muted);">${safeAreaShort}</span>` : ''}${ratingChip}</div>

  <!-- Nav -->
  <nav style="position:sticky;top:0;z-index:50;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--p-line-soft);">
    <div class="p-container" style="display:flex;align-items:center;justify-content:space-between;padding:16px 6vw;">
      <a href="#top" class="p-serif" style="text-decoration:none;color:var(--p-ink);font-size:20px;letter-spacing:0.04em;">${safeName}</a>
      <a href="${escapeHtml(bookHref)}"${siteData.bookingUrl ? ' target="_blank" rel="noopener noreferrer"' : ''} class="p-cta p-cta-solid" style="padding:10px 18px;font-size:10px;">Book Now</a>
    </div>
  </nav>

  <!-- Hero -->
  <section id="top" style="position:relative;min-height:42vh;display:flex;align-items:center;justify-content:center;overflow:hidden;">
    ${siteData.hero.imageUrl ? `<img src="{{hero}}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(0.5) contrast(1.08);">` : ''}
    <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 70%), linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.7) 100%);"></div>
    <div class="p-container" style="position:relative;text-align:center;padding:32px 6vw;">
      <div class="p-eyebrow" style="margin-bottom:12px;">Welcome to</div>
      <h1 class="p-display p-italic" style="font-size:clamp(2.2rem,5.5vw,4.6rem);margin:0 0 14px;color:var(--p-brand);">${escapeHtml(siteData.hero.heading)}</h1>
      <p class="p-serif p-italic" style="font-size:clamp(1rem,2.2vw,1.4rem);color:var(--p-ink-soft);max-width:640px;margin:0 auto 22px;">${escapeHtml(siteData.hero.tagline)}</p>
      <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
        <a href="${escapeHtml(bookHref)}"${siteData.bookingUrl ? ' target="_blank" rel="noopener noreferrer"' : ''} class="p-cta p-cta-solid">Book an Appointment</a>
        <a href="#services" class="p-cta">View Services</a>
      </div>
      ${agg ? `<div style="margin-top:28px;color:var(--p-ink-soft);font-size:13px;"><span style="color:var(--p-brand);">${'★'.repeat(Math.round(agg.rating))}</span> ${agg.rating.toFixed(1)} · ${agg.count.toLocaleString()} reviews</div>` : ''}
    </div>
  </section>

  <!-- About -->
  <section class="p-section">
    <div class="p-container p-grid-2" style="display:grid;grid-template-columns:${siteData.about.imageUrl ? '1fr 1fr' : '1fr'};gap:56px;align-items:start;">
      <div>
        <div class="p-eyebrow" style="margin-bottom:14px;">Our Story</div>
        <h2 class="p-display" style="font-size:clamp(2rem,4.2vw,3.2rem);margin:0 0 28px;">${escapeHtml(siteData.about.heading)}</h2>
        ${siteData.about.description.map((p, i) => `<p class="p-serif ${i === 0 ? 'p-dropcap' : ''}" style="font-size:1.06rem;line-height:1.75;color:var(--p-ink-soft);margin:0 0 18px;">${escapeHtml(p)}</p>`).join('')}
        ${statRibbon}
      </div>
      ${aboutImageMarkup}
    </div>
  </section>

  ${servicesSection}

  ${gallerySection}

  ${reviewsSection}

  ${pullQuoteSection}

  <!-- Booking strip -->
  <section style="background:var(--p-cream);color:#1a1a1a;text-align:center;padding:64px 6vw;">
    <div class="p-eyebrow" style="color:var(--p-brand-deep);margin-bottom:14px;">Take a Chair</div>
    <h2 class="p-display" style="font-size:clamp(2rem,5vw,3rem);margin:0 0 16px;color:#1a1a1a;">Ready for <span class="p-italic">your next cut?</span></h2>
    <p class="p-serif p-italic" style="color:#555;margin:0 0 28px;">Appointments recommended — walk-ins welcomed when chairs allow.</p>
    <a href="${escapeHtml(bookHref)}"${siteData.bookingUrl ? ' target="_blank" rel="noopener noreferrer"' : ''} class="p-cta" style="background:#1a1a1a;color:var(--p-brand);border-color:#1a1a1a;">Book an Appointment</a>
  </section>

  <!-- Visit -->
  <section class="p-section" style="background:var(--p-bg-2);">
    <div class="p-container p-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:48px;">
      <div>
        <div class="p-eyebrow" style="margin-bottom:16px;">Find the chair</div>
        <h2 class="p-display" style="font-size:clamp(1.8rem,4vw,2.8rem);margin:0 0 28px;">Pay a visit.</h2>
        <div style="display:grid;gap:22px;color:var(--p-ink-soft);font-size:16px;line-height:1.6;">
          ${siteData.contact.address ? `<div><div class="p-eyebrow" style="margin-bottom:6px;">The Address</div><div class="p-serif p-italic" style="color:var(--p-ink);font-size:1.2rem;">${escapeHtml(siteData.contact.address)}</div></div>` : ''}
          <div><div class="p-eyebrow" style="margin-bottom:6px;">By Phone</div><a href="tel:${formattedPhone}" class="p-serif p-italic" style="color:var(--p-ink);font-size:1.2rem;text-decoration:none;">${escapeHtml(siteData.phone)}</a></div>
          ${siteData.bookingUrl ? `<div><div class="p-eyebrow" style="margin-bottom:6px;">Online Booking</div><a href="${escapeHtml(siteData.bookingUrl)}" target="_blank" rel="noopener noreferrer" class="p-serif p-italic" style="color:var(--p-ink);font-size:1.1rem;">Book online → confirmed instantly</a></div>` : ''}
        </div>
      </div>
      ${hoursMarkup}
    </div>
  </section>

  <!-- Footer -->
  <footer style="padding:48px 6vw;border-top:1px solid var(--p-line-soft);text-align:center;">
    <div class="p-container">
      <div class="p-serif p-italic" style="font-size:18px;color:var(--p-brand);margin-bottom:8px;">${safeName}</div>
      <div class="p-eyebrow" style="color:var(--p-ink-muted);">© 2025 · Built by AIBarber</div>
    </div>
  </footer>

</div>
</body>
</html>`;
}
