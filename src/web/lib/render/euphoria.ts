// Euphoria static renderer.
//
// Lifted out of components/EuphoriaWebsite.tsx so the SERVER can render a site without
// pulling in React, the editor component, or anything DOM-shaped.
// The browser preview and /api/publish call the SAME function, so the page
// a customer previews is the page that deploys — there is no second
// implementation to drift.
//
// Pure: WebsiteData in, HTML string out. Keep it that way.
import type { WebsiteData } from '../../types';

// Shared Euphoria CSS — scoped inside `.euphoria-root` so it can't leak into the Luxe flow.
// Mirrors euphoria-build/styles.css custom properties + typography + section rhythm.
export const EUPHORIA_SCOPED_CSS = `
.euphoria-root {
  --eu-bg:        #000000;
  --eu-bg-2:      #0c0c0c;
  --eu-bg-3:      #141414;
  --eu-ink:       #f0ece4;
  --eu-ink-soft:  #9a958e;
  --eu-ink-muted: #6e6962;
  --eu-line:      rgba(255,255,255,0.22);
  --eu-line-soft: rgba(255,255,255,0.10);
  --eu-brand:     #d4a64a;
  --eu-brand-bright: #e8c074;
  background: var(--eu-bg);
  color: var(--eu-ink);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-weight: 400;
}
.euphoria-root .eu-serif { font-family: 'Newsreader', Georgia, serif; }
.euphoria-root .eu-display {
  font-family: 'Newsreader', Georgia, serif;
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.05;
}
.euphoria-root h1, .euphoria-root h2, .euphoria-root h3 {
  font-family: 'Newsreader', Georgia, serif;
  font-weight: 500;
  letter-spacing: -0.01em;
}
.euphoria-root .eu-eyebrow {
  font-family: 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.28em;
  font-size: 11px;
  color: var(--eu-ink-muted);
}
.euphoria-root .eu-section { padding: 96px 24px; }
@media (min-width: 768px) { .euphoria-root .eu-section { padding: 128px 48px; } }
.euphoria-root .eu-container { max-width: 1200px; margin: 0 auto; }
.euphoria-root .eu-rule { height: 1px; background: var(--eu-line-soft); width: 100%; }
.euphoria-root .eu-cta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 28px;
  border: 1px solid var(--eu-line);
  color: var(--eu-ink);
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 11px;
  font-weight: 500;
  background: transparent;
  text-decoration: none;
  transition: background 200ms ease, color 200ms ease, border-color 200ms ease;
}
.euphoria-root .eu-cta:hover { background: var(--eu-ink); color: var(--eu-bg); border-color: var(--eu-ink); }
.euphoria-root .eu-cta-solid {
  background: var(--eu-ink);
  color: var(--eu-bg);
}
.euphoria-root .eu-cta-solid:hover { background: var(--eu-brand-bright); border-color: var(--eu-brand-bright); color: var(--eu-bg); }
.euphoria-root .eu-editable {
  outline: none;
  border-radius: 2px;
  padding: 0 2px;
  margin: 0 -2px;
  transition: box-shadow 150ms ease;
}
.euphoria-root .eu-editable:focus { box-shadow: 0 0 0 1px var(--eu-brand-bright); }
.euphoria-root .eu-img-tile {
  position: relative;
  overflow: hidden;
  background: var(--eu-bg-3);
}
.euphoria-root .eu-img-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* Full-cover click target: tapping ANYWHERE on the image opens the file
   picker (not just a small pill). z-index:1 sits above the photo but below
   any section content (e.g. the hero CTAs/text, which we raise to z-index:2)
   so those stay clickable/editable. The pill (.eu-img-pill) is a
   visual-only affordance, pinned bottom-right, that survives mobile (no
   hover) and never collides with the fixed editor header at the top. */
.euphoria-root .eu-img-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 12px;
  cursor: pointer;
  background: transparent;
  transition: background 150ms ease;
}
.euphoria-root .eu-img-overlay:hover { background: rgba(0,0,0,0.12); }
.euphoria-root .eu-img-pill {
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(0,0,0,0.72);
  color: #fff;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.12);
}
.euphoria-root .eu-img-overlay:hover .eu-img-pill { background: rgba(0,0,0,0.88); }
.euphoria-root .eu-img-pill svg { width: 11px; height: 11px; }
.euphoria-root .eu-img-placeholder {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  width: 100%; height: 100%;
  background: var(--eu-bg-3);
  border: 1px dashed var(--eu-line);
  cursor: pointer;
  color: var(--eu-ink-soft);
}
.euphoria-root .eu-services-list { display: grid; gap: 0; }
.euphoria-root .eu-service-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 24px;
  padding: 32px 0;
  border-top: 1px solid var(--eu-line-soft);
  align-items: baseline;
}
.euphoria-root .eu-service-row:last-child { border-bottom: 1px solid var(--eu-line-soft); }
.euphoria-root .eu-service-num {
  font-family: 'Newsreader', Georgia, serif;
  font-style: italic;
  color: var(--eu-ink-muted);
  font-size: 14px;
  letter-spacing: 0.06em;
  min-width: 40px;
}
.euphoria-root .eu-gallery-mosaic {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}
@media (max-width: 767px) {
  .euphoria-root .eu-gallery-mosaic { grid-template-columns: repeat(2, 1fr); }
}
`;
export const EUPHORIA_FONT_LINK_ID = 'euphoria-fonts';
export const EUPHORIA_STYLE_ID = 'euphoria-scoped-styles';
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Resolve the picked color theme onto Euphoria's CSS variables. Shared by the
// editor preview AND the deployed static HTML so they stay identical. Returns
// null for the default gold (falls through to EUPHORIA_SCOPED_CSS defaults).
export function resolveEuphoriaTheme(slug?: string):
  | { brand: string; brandBright: string; bg: string; bg2: string; bg3: string }
  | null {
  if (slug && slug.charAt(0) === '#') return { brand: slug, brandBright: slug, bg: '#000', bg2: '#0c0c0c', bg3: '#141414' };
  if (slug === 'blackWhite') return { brand: '#ffffff', brandBright: '#f5f5f5', bg: '#000', bg2: '#0c0c0c', bg3: '#141414' };
  if (slug === 'redBlack')   return { brand: '#dc2626', brandBright: '#ef4444', bg: '#000', bg2: '#0c0c0c', bg3: '#141414' };
  if (slug === 'purpleGreen') return { brand: '#22c55e', brandBright: '#4ade80', bg: '#160328', bg2: '#1f0436', bg3: '#2a0747' };
  return null;
}
// Build the inline style string that overrides Euphoria's root CSS vars from a
// resolved theme. Empty when the theme is the default (no override needed).
export function euphoriaRootStyle(slug?: string): string {
  const t = resolveEuphoriaTheme(slug);
  if (!t) return '';
  return `--eu-brand:${t.brand};--eu-brand-bright:${t.brandBright};--eu-bg:${t.bg};--eu-bg-2:${t.bg2};--eu-bg-3:${t.bg3};background:${t.bg};`;
}
// Extracts the trailing "City, State" portion of an area string so the
// hero eyebrow never echoes a full street address even if the user
// pastes one in. Inputs with two or fewer comma-separated parts pass
// through unchanged.
export const cityStateOnly = (raw: string): string => {
  const parts = (raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return raw || '';
  return parts.slice(-2).join(', ');
};
// Exported so App.tsx / publish path can reuse for post-payment deploy
export function generateEuphoriaHTMLWithPlaceholders(siteData: WebsiteData): string {
  const formattedPhone = siteData.phone.replace(/\s+/g, '');
  const safeName = escapeHtml(siteData.shopName);
  const safeArea = escapeHtml(siteData.area);
  const safeAreaShort = escapeHtml(cityStateOnly(siteData.area));
  const mapQuery = encodeURIComponent(`${siteData.shopName} ${siteData.area}`);
  const rootStyle = euphoriaRootStyle((siteData as any).colorTheme);

  const galleryTiles = siteData.gallery
    .map((url, i) => ({ url, i }))
    .filter(t => t.url);

  const galleryMarkup = galleryTiles.length > 0
    ? `<section class="eu-section" style="padding-top:64px;padding-bottom:96px;">
  <div class="eu-container">
    <div style="margin-bottom:48px;">
      <div class="eu-eyebrow">Gallery</div>
      <h2 class="eu-display" style="font-size:42px;margin-top:12px;">Our work, on the chair.</h2>
    </div>
    <div class="eu-gallery-mosaic">
      ${galleryTiles.map((t, idx) => {
        const span = idx % 5 < 2 ? 'grid-column: span 3; aspect-ratio: 4/3;'
                                 : 'grid-column: span 2; aspect-ratio: 1/1;';
        return `<div class="eu-img-tile" style="${span}"><img src="{{gallery${t.i}}}" alt="Gallery image ${idx + 1}"></div>`;
      }).join('')}
    </div>
  </div>
</section>`
    : '';

  const aboutImageMarkup = siteData.about.imageUrl
    ? `<div class="eu-img-tile" style="aspect-ratio: 4/5;"><img src="{{about}}" alt="${safeName}"></div>`
    : '';

  // Cache-bust marker so each publish forces a fresh fetch.
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
  <meta name="description" content="${safeName}. A refined barbershop in ${safeArea}. Quiet luxury. Precise cuts. Book online.">
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "w5jdq6huun");
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #000; color: #f0ece4; font-family: 'Inter', system-ui, sans-serif; }
    a { color: inherit; }
    img { max-width: 100%; height: auto; }
${EUPHORIA_SCOPED_CSS}
  </style>
</head>
<body>
<div class="euphoria-root"${rootStyle ? ` style="${rootStyle}"` : ''}>

  <!-- Nav -->
  <nav style="position:sticky;top:0;z-index:50;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--eu-line-soft);">
    <div class="eu-container" style="display:flex;align-items:center;justify-content:space-between;padding:18px 24px;">
      <a href="#top" style="text-decoration:none;color:var(--eu-ink);font-family:'Newsreader',serif;font-size:20px;letter-spacing:0.04em;">${safeName}</a>
      <a href="tel:${formattedPhone}" class="eu-cta" style="padding:10px 18px;font-size:10px;">Book now</a>
    </div>
  </nav>

  <!-- Hero -->
  <section id="top" style="position:relative;min-height:80vh;display:flex;align-items:center;justify-content:center;overflow:hidden;">
    ${siteData.hero.imageUrl ? `<img src="{{hero}}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.45;">` : ''}
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0.4) 0%,rgba(0,0,0,0.7) 100%);"></div>
    <div class="eu-container" style="position:relative;text-align:center;padding:96px 24px;">
      <div class="eu-eyebrow" style="margin-bottom:24px;">${safeAreaShort}</div>
      <h1 class="eu-display" style="font-size:clamp(40px,8vw,96px);margin:0 0 28px;font-weight:500;color:var(--eu-ink);">
        ${escapeHtml(siteData.hero.heading)}
      </h1>
      <p class="eu-serif" style="font-size:clamp(16px,2.2vw,22px);font-style:italic;color:var(--eu-ink-soft);max-width:640px;margin:0 auto 40px;">
        ${escapeHtml(siteData.hero.tagline)}
      </p>
      <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
        <a href="tel:${formattedPhone}" class="eu-cta eu-cta-solid">Call ${escapeHtml(siteData.phone)}</a>
        ${siteData.bookingUrl ? `<a href="${escapeHtml(siteData.bookingUrl)}" target="_blank" rel="noopener noreferrer" class="eu-cta eu-cta-solid">Book Appointment</a>` : ''}
        <a href="#services" class="eu-cta">View services</a>
      </div>
    </div>
  </section>

  <!-- About -->
  <section class="eu-section">
    <div class="eu-container" style="display:grid;grid-template-columns:${siteData.about.imageUrl ? '1fr 1fr' : '1fr'};gap:64px;align-items:center;">
      <div>
        <div class="eu-eyebrow" style="margin-bottom:16px;">About</div>
        <h2 class="eu-display" style="font-size:clamp(32px,5vw,56px);margin:0 0 32px;">${escapeHtml(siteData.about.heading)}</h2>
        ${siteData.about.description.map(p => `<p class="eu-serif" style="font-size:18px;line-height:1.6;color:var(--eu-ink-soft);margin:0 0 20px;">${escapeHtml(p)}</p>`).join('')}
      </div>
      ${aboutImageMarkup}
    </div>
  </section>

  <!-- Services -->
  <section id="services" class="eu-section" style="background:var(--eu-bg-2);">
    <div class="eu-container">
      <div style="margin-bottom:48px;text-align:center;">
        <div class="eu-eyebrow">Services</div>
        <h2 class="eu-display" style="font-size:clamp(32px,5vw,56px);margin-top:16px;">Considered grooming.</h2>
      </div>
      <div class="eu-services-list">
        ${siteData.services.map((s, i) => `
          <div class="eu-service-row">
            <div class="eu-service-num">0${i + 1}</div>
            <div>
              <h3 style="font-size:24px;margin:0 0 8px;font-weight:500;">${escapeHtml(s.title)}</h3>
              <div class="eu-eyebrow" style="margin-bottom:12px;font-size:10px;">${escapeHtml(s.subtitle)}</div>
              <p style="color:var(--eu-ink-soft);font-size:15px;line-height:1.6;margin:0;max-width:640px;">${escapeHtml(s.description)}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  </section>

  ${galleryMarkup}

  <!-- Visit -->
  <section class="eu-section" style="background:var(--eu-bg-2);">
    <div class="eu-container" style="display:grid;grid-template-columns:1fr 1fr;gap:64px;">
      <div>
        <div class="eu-eyebrow" style="margin-bottom:16px;">Visit</div>
        <h2 class="eu-display" style="font-size:clamp(28px,4vw,44px);margin:0 0 32px;">Come in.</h2>
        <div style="display:grid;gap:24px;color:var(--eu-ink-soft);font-size:16px;line-height:1.6;">
          <div><div style="color:var(--eu-ink-muted);font-size:11px;letter-spacing:0.28em;text-transform:uppercase;margin-bottom:6px;">Location</div>${escapeHtml(siteData.contact.address)}</div>
          <div><div style="color:var(--eu-ink-muted);font-size:11px;letter-spacing:0.28em;text-transform:uppercase;margin-bottom:6px;">Phone</div><a href="tel:${formattedPhone}" style="color:var(--eu-ink);text-decoration:none;">${escapeHtml(siteData.phone)}</a></div>
          ${siteData.contact.email ? `<div><div style="color:var(--eu-ink-muted);font-size:11px;letter-spacing:0.28em;text-transform:uppercase;margin-bottom:6px;">Email</div><a href="mailto:${escapeHtml(siteData.contact.email)}" style="color:var(--eu-ink);text-decoration:none;">${escapeHtml(siteData.contact.email)}</a></div>` : ''}
          ${siteData.bookingUrl ? `<div style="margin-top:16px;"><a href="${escapeHtml(siteData.bookingUrl)}" target="_blank" rel="noopener noreferrer" class="eu-cta eu-cta-solid">Book Appointment</a></div>` : ''}
        </div>
      </div>
      <div>
        <iframe
          src="https://maps.google.com/maps?q=${mapQuery}&output=embed"
          width="100%" height="360" style="border:0;display:block;"
          loading="lazy" referrerpolicy="no-referrer-when-downgrade"
          title="${safeName} on Google Maps"></iframe>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer style="padding:48px 24px;border-top:1px solid var(--eu-line-soft);text-align:center;">
    <div class="eu-container">
      <div class="eu-serif" style="font-size:18px;color:var(--eu-ink);margin-bottom:8px;">${safeName}</div>
      <div class="eu-eyebrow">© 2025 · Built by AIBarber</div>
    </div>
  </footer>

</div>
</body>
</html>`;
}
