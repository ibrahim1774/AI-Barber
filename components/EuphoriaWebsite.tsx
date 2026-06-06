import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { WebsiteData, SiteInstance, SaveStatus } from '../types';
import { CameraIcon } from './Icons';
import { EditorToolbar } from './EditorToolbar';
import { PublishOverlay } from './PublishOverlay';
import { useAutoSave } from '../hooks/useAutoSave';
import { useResetOnReturnFromStripe } from '../hooks/useResetOnReturnFromStripe';
import PrePaymentBanner from './PrePaymentBanner.tsx';

interface EuphoriaWebsiteProps {
  data: WebsiteData;
  onBack: () => void;
  site?: SiteInstance;
  onNavigateDashboard?: () => void;
  isPostPayment?: boolean;
  userId?: string | null;
}

// Shared Euphoria CSS — scoped inside `.euphoria-root` so it can't leak into the Luxe flow.
// Mirrors euphoria-build/styles.css custom properties + typography + section rhythm.
const EUPHORIA_SCOPED_CSS = `
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
/* Always-visible corner pill so the Replace affordance survives
   mobile (no hover) and never depends on .eu-img-tile wrapping.
   On desktop hover, the tile dims slightly via .eu-img-tile:hover
   so the pill still reads as the primary action. */
.euphoria-root .eu-img-overlay {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(0,0,0,0.72);
  color: #fff;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12);
  transition: background 150ms ease, transform 150ms ease;
}
.euphoria-root .eu-img-overlay:hover { background: rgba(0,0,0,0.88); transform: translateY(-1px); }
.euphoria-root .eu-img-overlay svg { width: 14px; height: 14px; }
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

const EUPHORIA_FONT_LINK_ID = 'euphoria-fonts';
const EUPHORIA_STYLE_ID = 'euphoria-scoped-styles';

function useEuphoriaAssets() {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (!document.getElementById(EUPHORIA_FONT_LINK_ID)) {
      const link = document.createElement('link');
      link.id = EUPHORIA_FONT_LINK_ID;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600&display=swap';
      document.head.appendChild(link);
    }

    if (!document.getElementById(EUPHORIA_STYLE_ID)) {
      const styleEl = document.createElement('style');
      styleEl.id = EUPHORIA_STYLE_ID;
      styleEl.textContent = EUPHORIA_SCOPED_CSS;
      document.head.appendChild(styleEl);
    }
  }, []);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Extracts the trailing "City, State" portion of an area string so the
// hero eyebrow never echoes a full street address even if the user
// pastes one in. Inputs with two or fewer comma-separated parts pass
// through unchanged.
const cityStateOnly = (raw: string): string => {
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
<div class="euphoria-root">

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
      <div class="eu-eyebrow">© 2025 · Built by Prime Barber AI</div>
    </div>
  </footer>

</div>
</body>
</html>`;
}

export const EuphoriaWebsite: React.FC<EuphoriaWebsiteProps> = ({ data, onBack, site, onNavigateDashboard, isPostPayment = false, userId = null }) => {
  useEuphoriaAssets();

  const [siteData, setSiteData] = useState<WebsiteData>(data);
  const [isDeploying, setIsDeploying] = useState(false);
  const [, setDeploymentResult] = useState<{ error?: string } | null>(null);
  // Same Stripe-return reset as GeneratedWebsite — without this the
  // Publish button stays stuck when the user comes back from Stripe
  // without paying.
  const { markRedirecting } = useResetOnReturnFromStripe(useCallback(() => {
    setIsDeploying(false);
    setDeploymentResult(null);
  }, []));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishOverlay, setShowPublishOverlay] = useState(false);
  const [imageInputKey, setImageInputKey] = useState(0);
  const [showBookingToast, setShowBookingToast] = useState(false);

  useEffect(() => {
    if (!showBookingToast) return;
    const t = setTimeout(() => setShowBookingToast(false), 4000);
    return () => clearTimeout(t);
  }, [showBookingToast]);

  // Pre-deploy: explain instead of navigating. Post-deploy: follow the link.
  const handleBookClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPostPayment) {
      e.preventDefault();
      setShowBookingToast(true);
    }
  };

  const siteRef = useRef<SiteInstance | null>(site ?? null);
  useEffect(() => {
    if (siteRef.current) siteRef.current = { ...siteRef.current, data: siteData };
  }, [siteData]);

  const getSite = useCallback(() => siteRef.current, []);
  const { triggerSave, saveNow } = useAutoSave(getSite, userId, setSaveStatus);

  const siteSlug = useMemo(() => {
    return siteData.shopName
      .toLowerCase()
      .replace(/[''`]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }, [siteData.shopName]);

  const handleTextChange = (path: string, value: string | string[]) => {
    const newData: any = { ...siteData };
    const parts = path.split('.');
    if (parts[0] === 'hero') newData.hero = { ...newData.hero };
    else if (parts[0] === 'about') newData.about = { ...newData.about };
    else if (parts[0] === 'gallery') newData.gallery = [...newData.gallery];
    else if (parts[0] === 'contact') newData.contact = { ...newData.contact };
    else if (parts[0] === 'services') newData.services = [...newData.services];

    let current: any = newData;
    for (let i = 0; i < parts.length - 1; i++) current = current[parts[i]];
    current[parts[parts.length - 1]] = value;
    setSiteData(newData);
    if (isPostPayment) triggerSave();
  };

  const compressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
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
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.80));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });

  const handleImageChange = async (path: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const base64String = await compressImage(file);
      const newData: any = { ...siteData };
      const parts = path.split('.');
      if (parts[0] === 'hero') newData.hero = { ...newData.hero };
      else if (parts[0] === 'about') newData.about = { ...newData.about };
      else if (parts[0] === 'gallery') newData.gallery = [...newData.gallery];

      let current: any = newData;
      for (let i = 0; i < parts.length - 1; i++) current = current[parts[i]];
      current[parts[parts.length - 1]] = base64String;
      setSiteData(newData);
      setImageInputKey(prev => prev + 1);
      if (isPostPayment) triggerSave();
    } catch (err) {
      console.error('Image compression failed:', err);
    }
  };

  const Editable: React.FC<{ text: string; onSave: (v: string) => void; tag?: React.ElementType; style?: React.CSSProperties; className?: string }> = ({ text, onSave, tag: Tag = 'span', style, className = '' }) => (
    React.createElement(Tag as any, {
      contentEditable: true,
      suppressContentEditableWarning: true,
      onBlur: (e: any) => onSave(e.target.innerText),
      className: `eu-editable ${className}`,
      style,
    }, text)
  );

  const ImageOverlay: React.FC<{ onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void }> = ({ onUpload }) => (
    <label className="eu-img-overlay">
      <CameraIcon />
      <span>Replace photo</span>
      <input key={imageInputKey} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUpload} />
    </label>
  );

  const ImagePlaceholder: React.FC<{ onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; aspectRatio?: string }> = ({ onUpload, aspectRatio = '4 / 5' }) => (
    <label className="eu-img-placeholder" style={{ aspectRatio }}>
      <CameraIcon className="w-10 h-10" />
      <span style={{ marginTop: 12, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600 }}>Add image</span>
      <input key={imageInputKey} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUpload} />
    </label>
  );

  const handleClaimSite = async (plan: 'monthly' | 'monthly-booksy' | 'yearly' | 'five' | 'seven' = 'monthly') => {
    setIsDeploying(true);
    setDeploymentResult(null);
    try {
      const siteId = siteSlug;
      const imagesToUpload: Array<{ key: string; filename: string; base64: string }> = [];
      const timestamp = Date.now();

      if (siteData.hero.imageUrl?.startsWith('data:')) imagesToUpload.push({ key: 'hero', filename: `hero-${timestamp}.jpg`, base64: siteData.hero.imageUrl });
      if (siteData.about.imageUrl?.startsWith('data:')) imagesToUpload.push({ key: 'about', filename: `about-${timestamp}.jpg`, base64: siteData.about.imageUrl });
      siteData.gallery.forEach((url, i) => {
        if (url?.startsWith('data:')) imagesToUpload.push({ key: `gallery${i}`, filename: `gallery-${i}-${timestamp}.jpg`, base64: url });
      });

      const imageUrlMap: Record<string, string> = {};
      if (imagesToUpload.length > 0) {
        await Promise.all(imagesToUpload.map(async (image) => {
          const r = await fetch('/api/upload-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, filename: image.filename, base64: image.base64 }),
          });
          if (!r.ok) {
            const err = await r.text().catch(() => '');
            throw new Error(`[Upload ${image.filename}] HTTP ${r.status}: ${err}`);
          }
          const { publicUrl } = await r.json();
          imageUrlMap[image.key] = publicUrl;
        }));
      }
      if (siteData.hero.imageUrl?.startsWith('http')) imageUrlMap['hero'] = siteData.hero.imageUrl;
      if (siteData.about.imageUrl?.startsWith('http')) imageUrlMap['about'] = siteData.about.imageUrl;
      siteData.gallery.forEach((url, i) => { if (url?.startsWith('http')) imageUrlMap[`gallery${i}`] = url; });

      const pendingSite = {
        siteId,
        // Same draft-preservation as GeneratedWebsite — pass the
        // existing site UUID so handleStripeReturn mutates the draft
        // in place instead of orphaning it.
        existingSiteId: site?.id ?? null,
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

      // Fire FB + TikTok InitiateCheckout (pixel + CAPI) before the
      // Stripe redirect. Shared event_id so Meta/TikTok dedupe the
      // browser pixel against the server-side CAPI hit.
      try {
        const checkoutEventId =
          typeof crypto !== 'undefined' && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : `co_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const PLAN_VALUES: Record<string, number> = {
          monthly: 9,
          'monthly-booksy': 10,
          yearly: 72,
          five: 5,
          seven: 7,
        };
        const checkoutValue = PLAN_VALUES[plan] ?? 9;
        const checkoutCurrency = 'USD';
        (window as any).fbq?.(
          'track',
          'InitiateCheckout',
          { value: checkoutValue, currency: checkoutCurrency },
          { eventID: checkoutEventId },
        );
        (window as any).ttq?.track(
          'InitiateCheckout',
          { value: checkoutValue, currency: checkoutCurrency },
          { event_id: checkoutEventId },
        );
        fetch('/api/fb-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: checkoutEventId,
            value: checkoutValue,
            currency: checkoutCurrency,
            eventSourceUrl: window.location.href,
            clientUserAgent: navigator.userAgent,
          }),
        }).catch(err => console.error('[FB CAPI InitiateCheckout] Failed:', err));
        fetch('/api/tiktok-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'InitiateCheckout',
            event_id: checkoutEventId,
            event_source_url: window.location.href,
            user_agent: navigator.userAgent,
            value: checkoutValue,
            currency: checkoutCurrency,
          }),
        }).catch(err => console.error('[TikTok CAPI InitiateCheckout] Failed:', err));
      } catch (e) {
        console.error('[InitiateCheckout] Tracking failed:', e);
      }

      const checkoutResponse = await fetch('/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, plan }),
      });
      const checkoutData = await checkoutResponse.json();
      if (!checkoutResponse.ok || !checkoutData.url) {
        throw new Error(checkoutData.error || 'Failed to create checkout session');
      }
      // Mark the Stripe redirect so the reset-on-return hook clears
      // isDeploying when the user comes back without paying.
      markRedirecting();
      window.location.href = checkoutData.url;
    } catch (error: any) {
      console.error('Claim site error:', error);
      setDeploymentResult({ error: error.message || 'Failed to prepare site for payment.' });
      setIsDeploying(false);
    }
  };

  const formattedPhone = siteData.phone.replace(/\s+/g, '');
  const mapQuery = encodeURIComponent(`${siteData.shopName} ${siteData.area}`);

  const handlePublish = () => { setShowPublishOverlay(true); setIsPublishing(true); };
  const handlePublishComplete = (url: string) => {
    setIsPublishing(false);
    if (siteRef.current) siteRef.current = { ...siteRef.current, deployedUrl: url, deploymentStatus: 'deployed' };
  };
  const handlePublishError = () => setIsPublishing(false);
  const handlePublishClose = () => { setShowPublishOverlay(false); setIsPublishing(false); };
  const handleImageUrlsUpdated = (imageUrlMap: Record<string, string>) => {
    setSiteData(prev => ({
      ...prev,
      hero: { ...prev.hero, imageUrl: imageUrlMap['hero'] || prev.hero.imageUrl },
      about: { ...prev.about, imageUrl: imageUrlMap['about'] || prev.about.imageUrl },
      gallery: prev.gallery.map((url, i) => imageUrlMap[`gallery${i}`] || url || ''),
    }));
  };

  // Editor-time gallery: at least 4 slots, expand if user has more
  const editorGalleryIndices = useMemo(() => {
    const filledCount = siteData.gallery.filter(Boolean).length;
    return Array.from({ length: Math.max(filledCount, 4) }, (_, i) => i);
  }, [siteData.gallery]);

  // Resolve color theme — matches the set used by GeneratedWebsite. Override
  // the existing Euphoria CSS variables on the root rather than rewriting
  // every utility — Euphoria is already token-driven.
  const themeOverride = (() => {
    const slug = (siteData as any).colorTheme as string;
    if (slug === 'blackWhite') return { brand: '#ffffff', brandBright: '#f5f5f5', bg: '#000', bg2: '#0c0c0c', bg3: '#141414' };
    if (slug === 'redBlack')   return { brand: '#dc2626', brandBright: '#ef4444', bg: '#000', bg2: '#0c0c0c', bg3: '#141414' };
    if (slug === 'purpleGreen') return { brand: '#22c55e', brandBright: '#4ade80', bg: '#160328', bg2: '#1f0436', bg3: '#2a0747' };
    return null; // goldBlack falls through to the defaults defined in EUPHORIA_SCOPED_CSS
  })();
  const themeStyle: React.CSSProperties = themeOverride
    ? {
        ['--eu-brand' as any]: themeOverride.brand,
        ['--eu-brand-bright' as any]: themeOverride.brandBright,
        ['--eu-bg' as any]: themeOverride.bg,
        ['--eu-bg-2' as any]: themeOverride.bg2,
        ['--eu-bg-3' as any]: themeOverride.bg3,
        background: themeOverride.bg,
      }
    : {};

  return (
    <div className={`euphoria-root pt-[32px] md:pt-[40px] ${!isPostPayment ? 'pb-[250px] md:pb-[180px]' : ''}`} style={themeStyle}>
      {/* Toolbar / pre-payment banner */}
      {isPostPayment ? (
        <EditorToolbar
          saveStatus={saveStatus}
          onSave={saveNow}
          onPublish={handlePublish}
          onBack={() => onNavigateDashboard?.()}
          isPublishing={isPublishing}
        />
      ) : (
        <div className="fixed top-0 left-0 w-full bg-[#0c0c0c] border-b border-white/10 text-white py-1.5 px-2 md:py-2 md:px-3 z-[70] shadow-lg flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <button onClick={onBack} className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <p className="text-[8px] md:text-[10px] font-bold uppercase tracking-wider text-[#e8c074] truncate">
              Tap to edit text &amp; images, then publish below.
            </p>
          </div>
          <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5">
            <span className="text-[#9a958e] text-[8px] uppercase tracking-wider font-bold">Editor · Euphoria</span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 32, zIndex: 40, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--eu-line-soft)' }}>
        <div className="eu-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px' }}>
          <span className="eu-serif" style={{ fontSize: 20, letterSpacing: '0.04em' }}>
            <Editable text={siteData.shopName} onSave={v => handleTextChange('shopName', v)} />
          </span>
          <a href={`tel:${formattedPhone}`} className="eu-cta" style={{ padding: '10px 18px', fontSize: 10 }}>Book now</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ position: 'relative', minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} className="group">
        {siteData.hero.imageUrl ? (
          <>
            <img src={siteData.hero.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
            <ImageOverlay onUpload={e => handleImageChange('hero.imageUrl', e)} />
          </>
        ) : (
          <div style={{ position: 'absolute', inset: 0 }}>
            <ImagePlaceholder onUpload={e => handleImageChange('hero.imageUrl', e)} aspectRatio="auto" />
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0.4) 0%,rgba(0,0,0,0.7) 100%)', pointerEvents: 'none' }} />
        <div className="eu-container" style={{ position: 'relative', textAlign: 'center', padding: '96px 24px' }}>
          <div className="eu-eyebrow" style={{ marginBottom: 24 }}>
            <Editable text={cityStateOnly(siteData.area)} onSave={v => handleTextChange('area', v)} />
          </div>
          <h1 className="eu-display" style={{ fontSize: 'clamp(40px,8vw,96px)', margin: '0 0 28px', fontWeight: 500 }}>
            <Editable text={siteData.hero.heading} onSave={v => handleTextChange('hero.heading', v)} />
          </h1>
          <p className="eu-serif" style={{ fontSize: 'clamp(16px,2.2vw,22px)', fontStyle: 'italic', color: 'var(--eu-ink-soft)', maxWidth: 640, margin: '0 auto 40px' }}>
            <Editable text={siteData.hero.tagline} onSave={v => handleTextChange('hero.tagline', v)} />
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={`tel:${formattedPhone}`} className="eu-cta eu-cta-solid">
              Call <Editable text={siteData.phone} onSave={v => handleTextChange('phone', v)} />
            </a>
            {siteData.bookingUrl && (
              <a
                href={siteData.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleBookClick}
                className="eu-cta eu-cta-solid"
              >
                Book Appointment
              </a>
            )}
            <a href="#services" className="eu-cta">View services</a>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="eu-section">
        <div className="eu-container" style={{ display: 'grid', gridTemplateColumns: siteData.about.imageUrl ? '1fr 1fr' : '1fr', gap: 64, alignItems: 'center' }}>
          <div>
            <div className="eu-eyebrow" style={{ marginBottom: 16 }}>About</div>
            <h2 className="eu-display" style={{ fontSize: 'clamp(32px,5vw,56px)', margin: '0 0 32px' }}>
              <Editable text={siteData.about.heading} onSave={v => handleTextChange('about.heading', v)} />
            </h2>
            {siteData.about.description.map((p, i) => (
              <p key={i} className="eu-serif" style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--eu-ink-soft)', margin: '0 0 20px' }}>
                <Editable
                  text={p}
                  onSave={v => {
                    const next = [...siteData.about.description];
                    next[i] = v;
                    handleTextChange('about.description', next);
                  }}
                />
              </p>
            ))}
          </div>
          {siteData.about.imageUrl ? (
            <div className="eu-img-tile" style={{ aspectRatio: '4 / 5' }}>
              <img src={siteData.about.imageUrl} alt={siteData.shopName} />
              <ImageOverlay onUpload={e => handleImageChange('about.imageUrl', e)} />
            </div>
          ) : (
            <ImagePlaceholder onUpload={e => handleImageChange('about.imageUrl', e)} aspectRatio="4 / 5" />
          )}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="eu-section" style={{ background: 'var(--eu-bg-2)' }}>
        <div className="eu-container">
          <div style={{ marginBottom: 48, textAlign: 'center' }}>
            <div className="eu-eyebrow">Services</div>
            <h2 className="eu-display" style={{ fontSize: 'clamp(32px,5vw,56px)', marginTop: 16 }}>Considered grooming.</h2>
          </div>
          <div className="eu-services-list">
            {siteData.services.map((s, i) => (
              <div key={i} className="eu-service-row">
                <div className="eu-service-num">0{i + 1}</div>
                <div>
                  <h3 style={{ fontSize: 24, margin: '0 0 8px', fontWeight: 500 }}>
                    <Editable text={s.title} onSave={v => {
                      const next = [...siteData.services];
                      next[i] = { ...next[i], title: v };
                      handleTextChange('services', next as any);
                    }} />
                  </h3>
                  <div className="eu-eyebrow" style={{ marginBottom: 12, fontSize: 10 }}>
                    <Editable text={s.subtitle} onSave={v => {
                      const next = [...siteData.services];
                      next[i] = { ...next[i], subtitle: v };
                      handleTextChange('services', next as any);
                    }} />
                  </div>
                  <p style={{ color: 'var(--eu-ink-soft)', fontSize: 15, lineHeight: 1.6, margin: 0, maxWidth: 640 }}>
                    <Editable text={s.description} onSave={v => {
                      const next = [...siteData.services];
                      next[i] = { ...next[i], description: v };
                      handleTextChange('services', next as any);
                    }} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery */}
      <section className="eu-section" style={{ paddingTop: 64, paddingBottom: 96 }}>
        <div className="eu-container">
          <div style={{ marginBottom: 48 }}>
            <div className="eu-eyebrow">Gallery</div>
            <h2 className="eu-display" style={{ fontSize: 'clamp(28px,4vw,42px)', marginTop: 12 }}>Our work, on the chair.</h2>
          </div>
          <div className="eu-gallery-mosaic">
            {editorGalleryIndices.map((idx) => {
              const url = siteData.gallery[idx];
              const span = idx % 5 < 2 ? 'span 3' : 'span 2';
              const ratio = idx % 5 < 2 ? '4 / 3' : '1 / 1';
              return (
                <div key={idx} className="eu-img-tile" style={{ gridColumn: span, aspectRatio: ratio }}>
                  {url ? (
                    <>
                      <img src={url} alt={`Gallery ${idx + 1}`} />
                      <ImageOverlay onUpload={e => handleImageChange(`gallery.${idx}`, e)} />
                    </>
                  ) : (
                    <ImagePlaceholder onUpload={e => handleImageChange(`gallery.${idx}`, e)} aspectRatio={ratio} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Visit */}
      <section className="eu-section" style={{ background: 'var(--eu-bg-2)' }}>
        <div className="eu-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64 }}>
          <div>
            <div className="eu-eyebrow" style={{ marginBottom: 16 }}>Visit</div>
            <h2 className="eu-display" style={{ fontSize: 'clamp(28px,4vw,44px)', margin: '0 0 32px' }}>Come in.</h2>
            <div style={{ display: 'grid', gap: 24, color: 'var(--eu-ink-soft)', fontSize: 16, lineHeight: 1.6 }}>
              <div>
                <div className="eu-eyebrow" style={{ marginBottom: 6 }}>Location</div>
                <Editable text={siteData.contact.address} onSave={v => handleTextChange('contact.address', v)} />
              </div>
              <div>
                <div className="eu-eyebrow" style={{ marginBottom: 6 }}>Phone</div>
                <Editable text={siteData.phone} onSave={v => handleTextChange('phone', v)} />
              </div>
              {siteData.contact.email && (
                <div>
                  <div className="eu-eyebrow" style={{ marginBottom: 6 }}>Email</div>
                  <Editable text={siteData.contact.email} onSave={v => handleTextChange('contact.email', v)} />
                </div>
              )}
              {siteData.bookingUrl && (
                <div style={{ marginTop: 16 }}>
                  <a
                    href={siteData.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleBookClick}
                    className="eu-cta eu-cta-solid"
                  >
                    Book Appointment
                  </a>
                </div>
              )}
            </div>
          </div>
          <div>
            <iframe
              src={`https://maps.google.com/maps?q=${mapQuery}&output=embed`}
              width="100%" height={360} style={{ border: 0, display: 'block' }}
              loading="lazy" referrerPolicy="no-referrer-when-downgrade"
              title={`${siteData.shopName} on Google Maps`}
            />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '48px 24px', borderTop: '1px solid var(--eu-line-soft)', textAlign: 'center' }}>
        <div className="eu-container">
          <div className="eu-serif" style={{ fontSize: 18, marginBottom: 8 }}>{siteData.shopName}</div>
          <div className="eu-eyebrow">© 2025 · Built by Prime Barber AI</div>
        </div>
      </footer>

      {/* PrePaymentBanner (pre-payment only) */}
      {!isPostPayment && (
        <PrePaymentBanner
          onDeploy={handleClaimSite}
          isDeploying={isDeploying}
          industry="barbershop"
        />
      )}

      {/* Publish Overlay (post-payment only) */}
      {showPublishOverlay && siteRef.current && (
        <PublishOverlay
          site={siteRef.current}
          userId={userId}
          onComplete={handlePublishComplete}
          onImageUrlsUpdated={handleImageUrlsUpdated}
          onError={handlePublishError}
          onClose={handlePublishClose}
        />
      )}

      {/* Pre-deploy hint when the user taps a Book Appointment button in the preview */}
      {showBookingToast && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'none' }}
          aria-live="polite"
        >
          <div
            style={{
              pointerEvents: 'auto',
              maxWidth: 480, width: '100%',
              background: '#0c0c0c',
              border: '1px solid rgba(232,192,116,0.4)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              padding: '20px',
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}
          >
            <div style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: '#e8c074', marginTop: 8 }} />
            <p style={{ flex: 1, margin: 0, color: '#f0ece4', fontSize: 15, lineHeight: 1.5 }}>
              After you publish below, customers who tap <strong style={{ color: '#e8c074' }}>Book Appointment</strong> will land on your booking page.
            </p>
            <button
              onClick={() => setShowBookingToast(false)}
              style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 0, marginTop: -4, marginRight: -4 }}
              aria-label="Dismiss"
            >
              <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
