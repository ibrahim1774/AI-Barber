import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { WebsiteData, SiteInstance, SaveStatus } from '../types';
import { CameraIcon } from './Icons';
import { EditorToolbar } from './EditorToolbar';
import { EditorColorPicker } from './EditorColorPicker';
import { PublishOverlay } from './PublishOverlay';
import { useAutoSave } from '../hooks/useAutoSave';
import { useResetOnReturnFromStripe } from '../hooks/useResetOnReturnFromStripe';
import PrePaymentBanner from './PrePaymentBanner.tsx';
import { isCustomDesignAnyPath } from '../lib/dealMode.ts';
import { DEFAULT_POLICY, DEFAULT_PULLQUOTE, GALLERY_SPEC, PRIME_FONT_LINK_ID, PRIME_SCOPED_CSS, PRIME_STYLE_ID, cityStateOnly, resolvePrimeTheme, to12h } from '../lib/render/prime';

// ---------------------------------------------------------------------------
// PrimeWebsite — "Design 2" on /booksy. A faithful port of PrimeHub's live
// barbershop design (primehub.dev/barber, the "Premium Cuts" look): dark
// canvas, gold accent, Newsreader serif italic headings, Inter body. It is a
// sibling of GeneratedWebsite (luxe) and EuphoriaWebsite — same WebsiteData
// contract so switching designs never loses content. Reuses the exact
// publish / checkout / image-upload flow from those two, only the visible
// sections + styling differ. Unlike the older Euphoria template, this one
// natively renders reviews, hours, services-with-prices, a policy box, and a
// pull quote — each conditional on data presence (so a scraped Booksy site
// shows what was pulled, nothing empty).
// ---------------------------------------------------------------------------

interface PrimeWebsiteProps {
  data: WebsiteData;
  onBack: () => void;
  site?: SiteInstance;
  onNavigateDashboard?: () => void;
  isPostPayment?: boolean;
  userId?: string | null;
  onCheckoutFlowChange?: (open: boolean) => void;
  hidePrepaymentBanner?: boolean;
  // When provided, the component echoes its internal edited state up to the
  // parent on every user edit (not on prop-sync). The /booksy funnel uses
  // this so the floating design switcher re-skins with the EDITED content,
  // not the stale generated content — "keep content, re-skin only".
  onUpdate?: (data: WebsiteData) => void;
  // When true, shows the floating EditorColorPicker pre-payment too (not just
  // post-payment) so the visitor can recolor right after the site generates.
  showThemePicker?: boolean;
  // Where the pre-payment floating picker anchors ('below-design' default;
  // 'center' where there is no Design switcher).
  themePickerPlacement?: 'center' | 'below-design';
}





function usePrimeAssets() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(PRIME_FONT_LINK_ID)) {
      const link = document.createElement('link');
      link.id = PRIME_FONT_LINK_ID;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,600&family=Inter:wght@300;400;500;600;700&display=swap';
      document.head.appendChild(link);
    }
    if (!document.getElementById(PRIME_STYLE_ID)) {
      const styleEl = document.createElement('style');
      styleEl.id = PRIME_STYLE_ID;
      styleEl.textContent = PRIME_SCOPED_CSS;
      document.head.appendChild(styleEl);
    }
  }, []);
}







// ===========================================================================
// Editor component
// ===========================================================================
export const PrimeWebsite: React.FC<PrimeWebsiteProps> = ({ data, onBack, site, onNavigateDashboard, isPostPayment = false, userId = null, onCheckoutFlowChange, hidePrepaymentBanner, onUpdate, showThemePicker = false, themePickerPlacement = 'below-design' }) => {
  usePrimeAssets();

  const [siteData, setSiteData] = useState<WebsiteData>(data);
  // Echo guard: a prop-driven sync (parent → child) must NOT bounce back up
  // as an onUpdate (which would loop). Set true before each sync; the
  // siteData effect below clears it and skips that one echo. Starts true so
  // the initial mount/seed doesn't echo.
  const skipNextUpdate = useRef(true);
  useEffect(() => { skipNextUpdate.current = true; setSiteData(data); }, [data]);
  useEffect(() => {
    if (skipNextUpdate.current) { skipNextUpdate.current = false; return; }
    onUpdate?.(siteData);
  }, [siteData]);

  const [isDeploying, setIsDeploying] = useState(false);
  const [, setDeploymentResult] = useState<{ error?: string } | null>(null);
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

  // Theme color — written by the floating EditorColorPicker. The Prime
  // renderer (preview + deployed HTML) already reads siteData.colorTheme via
  // resolvePrimeTheme, so this is all the wiring it needs.
  const handleColorChange = (hex: string) => {
    setSiteData(prev => ({ ...prev, colorTheme: hex }));
    if (isPostPayment) triggerSave();
  };

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

  // Object/array branch edits (policy, pullQuote, reviews, hours) go through
  // a functional patch so we never mutate the previous object graph.
  const patch = (updater: (prev: WebsiteData) => WebsiteData) => {
    setSiteData(prev => updater(prev));
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
      className: `p-editable ${className}`,
      style,
    }, text)
  );

  const ImageOverlay: React.FC<{ onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; big?: boolean }> = ({ onUpload, big }) => (
    <label className={`p-img-overlay${big ? ' p-img-overlay--lg' : ''}`}>
      <span className={`p-img-pill${big ? ' p-img-pill--lg' : ''}`}>
        <CameraIcon />
        <span>Replace photo</span>
      </span>
      <input key={imageInputKey} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUpload} />
    </label>
  );

  const ImagePlaceholder: React.FC<{ onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; aspectRatio?: string }> = ({ onUpload, aspectRatio = '4 / 5' }) => (
    <label className="p-img-placeholder" style={{ aspectRatio }}>
      <CameraIcon className="w-10 h-10" />
      <span style={{ marginTop: 12, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600 }}>Add image</span>
      <input key={imageInputKey} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUpload} />
    </label>
  );

  const preparePendingSite = async (
    plan: 'monthly' | 'monthly-booksy' | 'monthly-free' | 'monthly-booking' | 'yearly' | 'yearly-booksy' | 'yearly-free' | 'yearly-booking' = 'monthly',
  ): Promise<{ siteId: string } | { error: string }> => {
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

      fetch('/api/save-pending-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, data: pendingSite }),
        keepalive: true,
      }).catch((err) => console.warn('[save-pending-site] non-blocking:', err));

      try {
        const checkoutEventId =
          typeof crypto !== 'undefined' && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : `co_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const PLAN_VALUES: Record<string, number> = {
          monthly: 9, 'monthly-booksy': 10, 'monthly-free': 7,
          yearly: 86, 'yearly-booksy': 67, 'yearly-free': 67,
        };
        const checkoutValue = PLAN_VALUES[plan] ?? 9;
        const checkoutCurrency = 'USD';
        const { getPlanContentMeta } = await import('../lib/pixelMeta');
        const m = getPlanContentMeta(plan, checkoutValue);
        const ph = (siteData as any)?.phone || null;
        (window as any).fbq?.('track', 'InitiateCheckout', { value: checkoutValue, currency: checkoutCurrency, content_ids: [m.content_id], content_type: m.content_type, contents: m.contents }, { eventID: checkoutEventId });
        (window as any).ttq?.track('InitiateCheckout', { value: checkoutValue, currency: checkoutCurrency, content_id: m.content_id, content_type: m.content_type, contents: m.contents }, { event_id: checkoutEventId });
        fetch('/api/fb-checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: checkoutEventId, value: checkoutValue, currency: checkoutCurrency, eventSourceUrl: window.location.href, clientUserAgent: navigator.userAgent, customerPhone: ph, content_id: m.content_id, content_name: m.content_name, content_type: m.content_type, contents: m.contents }),
        }).catch(err => console.error('[FB CAPI InitiateCheckout] Failed:', err));
        fetch('/api/tiktok-event', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'InitiateCheckout', event_id: checkoutEventId, event_source_url: window.location.href, user_agent: navigator.userAgent, value: checkoutValue, currency: checkoutCurrency, phone: ph, content_id: m.content_id, content_name: m.content_name, content_type: m.content_type, contents: m.contents }),
        }).catch(err => console.error('[TikTok CAPI InitiateCheckout] Failed:', err));
      } catch (e) {
        console.error('[InitiateCheckout] Tracking failed (non-blocking):', e);
      }

      return { siteId };
    } catch (error: any) {
      console.error('[preparePendingSite] failed:', error);
      return { error: error.message || 'Failed to prepare site for payment.' };
    }
  };

  const handleClaimSite = async (plan: 'monthly' | 'monthly-booksy' | 'monthly-free' | 'monthly-booking' | 'yearly' | 'yearly-booksy' | 'yearly-free' | 'yearly-booking' = 'monthly') => {
    setIsDeploying(true);
    setDeploymentResult(null);
    const prep = await preparePendingSite(plan);
    if ('error' in prep) {
      setDeploymentResult({ error: prep.error });
      setIsDeploying(false);
      return;
    }
    try {
      const checkoutResponse = await fetch('/api/create-checkout-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: prep.siteId, plan, page: window.location.pathname }),
      });
      const checkoutData = await checkoutResponse.json();
      if (!checkoutResponse.ok || !checkoutData.url) {
        throw new Error(checkoutData.error || 'Failed to create checkout session');
      }
      markRedirecting();
      window.location.href = checkoutData.url;
    } catch (error: any) {
      console.error('Claim site error:', error);
      setDeploymentResult({ error: error.message || 'Failed to prepare site for payment.' });
      setIsDeploying(false);
    }
  };

  const formattedPhone = (siteData.phone || '').replace(/\s+/g, '');
  const phoneE164 = '+1' + (siteData.phone || '').replace(/\D/g, '');
  const bookHref = siteData.bookingUrl || `tel:${phoneE164}`;
  const mapQuery = encodeURIComponent(`${siteData.shopName} ${siteData.area}`);
  const agg = siteData.aggregateRating;
  const policy = siteData.policy || DEFAULT_POLICY;
  const pullQuote = siteData.pullQuote || DEFAULT_PULLQUOTE;
  const reviews = siteData.reviews || [];
  const hours = siteData.hours || [];

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

  // Editor gallery: always offer the 6 mosaic slots so the owner can fill any.
  const editorGalleryIndices = useMemo(() => GALLERY_SPEC.map((_, i) => i), []);

  const theme = resolvePrimeTheme(siteData.colorTheme);
  const themeStyle: React.CSSProperties = theme
    ? {
        ['--p-brand' as any]: theme.brand,
        ['--p-brand-bright' as any]: theme.bright,
        ['--p-brand-deep' as any]: theme.deep,
        ['--p-bg' as any]: theme.bg,
        ['--p-bg-2' as any]: theme.bg2,
        ['--p-bg-3' as any]: theme.bg3,
        background: theme.bg,
      }
    : {};

  return (
    <div className={`prime-root pt-[32px] md:pt-[40px] ${!isPostPayment ? 'pb-[250px] md:pb-[180px]' : ''}`} style={themeStyle}>
      {/* Floating theme-color picker — post-payment always, and pre-payment
          when the generation flow opts in via showThemePicker. */}
      {(isPostPayment || showThemePicker) && (
        <EditorColorPicker current={siteData.colorTheme} onPick={handleColorChange} placement={isPostPayment ? 'center' : themePickerPlacement} />
      )}
      {/* Toolbar / pre-payment banner */}
      {isPostPayment ? (
        <>
          <EditorToolbar
            saveStatus={saveStatus}
            onSave={saveNow}
            onPublish={handlePublish}
            onBack={() => onNavigateDashboard?.()}
            isPublishing={isPublishing}
          />
        </>
      ) : (
        <div className="fixed top-0 left-0 w-full bg-[#0a0a0a] border-b border-white/10 text-white py-2 px-2 md:py-2.5 md:px-3 z-[70] shadow-lg flex items-center gap-2">
          <button onClick={onBack} className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <p className="flex-1 text-center text-[10px] md:text-[13px] font-bold uppercase tracking-wider text-[#e8c074]">
            {isCustomDesignAnyPath() ? 'Preview only \u2014 pick your design below, then get your custom site.' : 'Tap to edit text & images, then publish below.'}
          </p>
          <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5">
            <span className="text-[#9a958e] text-[8px] uppercase tracking-wider font-bold">Editor · Design 2</span>
          </div>
        </div>
      )}

      {/* Welcome bar */}
      <div className="p-welcome">
        <span>Welcome</span>
        {cityStateOnly(siteData.area) && <span style={{ color: 'var(--p-ink-muted)' }}><Editable text={cityStateOnly(siteData.area)} onSave={v => handleTextChange('area', v)} /></span>}
        {agg && <span style={{ color: 'var(--p-brand)' }}>★ {agg.rating.toFixed(1)}{agg.count > 0 ? ` · ${agg.count.toLocaleString()} reviews` : ''}</span>}
      </div>

      {/* Nav */}
      <nav style={{ position: 'sticky', top: 32, zIndex: 40, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--p-line-soft)' }}>
        <div className="p-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 6vw' }}>
          <span className="p-serif" style={{ fontSize: 20, letterSpacing: '0.04em' }}>
            <Editable text={siteData.shopName} onSave={v => handleTextChange('shopName', v)} />
          </span>
          <a href={bookHref} onClick={handleBookClick} {...(siteData.bookingUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="p-cta p-cta-solid" style={{ padding: '10px 18px', fontSize: 10 }}>Book Now</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ position: 'relative', minHeight: '42vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }} className="group">
        {siteData.hero.imageUrl ? (
          <>
            <img src={siteData.hero.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.5) contrast(1.08)' }} />
            {/* Full-bleed click target for the areas not covered by the
                centered hero text (which sits above at zIndex 2). */}
            <label className="p-img-overlay p-img-overlay--lg" aria-label="Replace hero photo">
              <input key={imageInputKey} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleImageChange('hero.imageUrl', e)} />
            </label>
            {/* Dedicated pill ABOVE the hero text (zIndex 3) so Replace photo
                stays clickable even where the text/CTA block overlaps. */}
            <label
              className="p-img-pill p-img-pill--lg"
              style={{ position: 'absolute', bottom: 18, right: 18, zIndex: 3, cursor: 'pointer', pointerEvents: 'auto' }}
            >
              <CameraIcon />
              <span>Replace photo</span>
              <input key={`${imageInputKey}-hero-pill`} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleImageChange('hero.imageUrl', e)} />
            </label>
          </>
        ) : (
          <div style={{ position: 'absolute', inset: 0 }}>
            <ImagePlaceholder onUpload={e => handleImageChange('hero.imageUrl', e)} aspectRatio="auto" />
          </div>
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 70%), linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.7) 100%)', pointerEvents: 'none' }} />
        <div className="p-container" style={{ position: 'relative', zIndex: 2, textAlign: 'center', padding: '32px 6vw' }}>
          <div className="p-eyebrow" style={{ marginBottom: 12 }}>Welcome to</div>
          <h1 className="p-display p-italic" style={{ fontSize: 'clamp(2.2rem,5.5vw,4.6rem)', margin: '0 0 14px', color: 'var(--p-brand)' }}>
            <Editable text={siteData.hero.heading} onSave={v => handleTextChange('hero.heading', v)} />
          </h1>
          <p className="p-serif p-italic" style={{ fontSize: 'clamp(1rem,2.2vw,1.4rem)', color: 'var(--p-ink-soft)', maxWidth: 640, margin: '0 auto 22px' }}>
            <Editable text={siteData.hero.tagline} onSave={v => handleTextChange('hero.tagline', v)} />
          </p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={bookHref} onClick={handleBookClick} {...(siteData.bookingUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="p-cta p-cta-solid">Book an Appointment</a>
            <a href="#services" className="p-cta">View Services</a>
          </div>
          {agg && (
            <div style={{ marginTop: 28, color: 'var(--p-ink-soft)', fontSize: 13 }}>
              <span style={{ color: 'var(--p-brand)' }}>{'★'.repeat(Math.round(agg.rating))}</span> {agg.rating.toFixed(1)} · {agg.count.toLocaleString()} reviews
            </div>
          )}
        </div>
      </section>

      {/* About */}
      <section className="p-section">
        <div className="p-container p-grid-2" style={{ display: 'grid', gridTemplateColumns: siteData.about.imageUrl ? '1fr 1fr' : '1fr', gap: 56, alignItems: 'start' }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 14 }}>Our Story</div>
            <h2 className="p-display" style={{ fontSize: 'clamp(2rem,4.2vw,3.2rem)', margin: '0 0 28px' }}>
              <Editable text={siteData.about.heading} onSave={v => handleTextChange('about.heading', v)} />
            </h2>
            {siteData.about.description.map((p, i) => (
              <p key={i} className={`p-serif ${i === 0 ? 'p-dropcap' : ''}`} style={{ fontSize: '1.06rem', lineHeight: 1.75, color: 'var(--p-ink-soft)', margin: '0 0 18px' }}>
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
            {agg && (
              <div className="p-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, marginTop: 28, border: '1px solid rgba(212,166,74,0.25)', background: 'rgba(212,166,74,0.04)' }}>
                <div style={{ textAlign: 'center', padding: 18 }}>
                  <div className="p-serif p-italic" style={{ fontSize: '2rem', color: 'var(--p-brand)' }}>{agg.rating.toFixed(1)}</div>
                  <div className="p-eyebrow" style={{ fontSize: 9, marginTop: 4, color: 'var(--p-ink-muted)' }}>Rating</div>
                </div>
                <div style={{ textAlign: 'center', padding: 18, borderLeft: '1px solid rgba(212,166,74,0.25)' }}>
                  <div className="p-serif p-italic" style={{ fontSize: '2rem', color: 'var(--p-brand)' }}>{agg.count.toLocaleString()}</div>
                  <div className="p-eyebrow" style={{ fontSize: 9, marginTop: 4, color: 'var(--p-ink-muted)' }}>Reviews</div>
                </div>
              </div>
            )}
          </div>
          {siteData.about.imageUrl ? (
            <div className="p-img-tile" style={{ aspectRatio: '4 / 5' }}>
              <img src={siteData.about.imageUrl} alt={siteData.shopName} />
              <ImageOverlay onUpload={e => handleImageChange('about.imageUrl', e)} />
            </div>
          ) : (
            <ImagePlaceholder onUpload={e => handleImageChange('about.imageUrl', e)} aspectRatio="4 / 5" />
          )}
        </div>
      </section>

      {/* Services + Policy */}
      {siteData.services.length > 0 && (
        <section id="services" className="p-section">
          <div className="p-container">
            <div style={{ textAlign: 'center', marginBottom: 36 }}>
              <div className="p-eyebrow">Services &amp; Prices</div>
              <h2 className="p-display" style={{ fontSize: 'clamp(28px,5vw,46px)', marginTop: 14 }}>A complete <span className="p-italic" style={{ color: 'var(--p-brand)' }}>repertoire.</span></h2>
              <p className="p-serif p-italic" style={{ color: 'var(--p-ink-soft)', marginTop: 10 }}>From the cut to the finish — every detail done in chair.</p>
            </div>
            <div className="p-svc" style={{ maxWidth: 880, margin: '0 auto' }}>
              {siteData.services.map((s, i) => (
                <div key={i} className="p-svc-row">
                  <div>
                    <div className="p-serif p-italic" style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                      <Editable text={s.title} onSave={v => { const next = [...siteData.services]; next[i] = { ...next[i], title: v }; handleTextChange('services', next as any); }} />
                    </div>
                    {(s.duration || s.subtitle) && (
                      <div className="p-eyebrow" style={{ fontSize: 10, marginTop: 6 }}>
                        <Editable text={s.duration || s.subtitle} onSave={v => { const next = [...siteData.services]; if (next[i].duration) next[i] = { ...next[i], duration: v }; else next[i] = { ...next[i], subtitle: v }; handleTextChange('services', next as any); }} />
                      </div>
                    )}
                    {s.description && (
                      <p className="p-serif" style={{ color: 'var(--p-ink-soft)', fontSize: '0.9rem', marginTop: 8, maxWidth: 560 }}>
                        <Editable text={s.description} onSave={v => { const next = [...siteData.services]; next[i] = { ...next[i], description: v }; handleTextChange('services', next as any); }} />
                      </p>
                    )}
                  </div>
                  {(s.price || '') && (
                    <div className="p-serif p-italic" style={{ fontSize: '1.6rem', color: 'var(--p-brand-bright)', whiteSpace: 'nowrap' }}>
                      <Editable text={s.price || ''} onSave={v => { const next = [...siteData.services]; next[i] = { ...next[i], price: v }; handleTextChange('services', next as any); }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="p-grid-2" style={{ maxWidth: 880, margin: '28px auto 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 28, padding: '24px 28px', border: '1px solid var(--p-brand-deep)', background: 'rgba(212,166,74,0.05)' }}>
              <div className="p-eyebrow" style={{ whiteSpace: 'nowrap' }}>Please Note</div>
              <div>
                <h3 style={{ fontSize: '1.2rem', margin: '0 0 8px' }}>
                  <Editable text={policy.title} onSave={v => patch(prev => ({ ...prev, policy: { ...(prev.policy || DEFAULT_POLICY), title: v } }))} />
                </h3>
                <p className="p-serif" style={{ color: 'var(--p-ink-soft)', fontSize: '0.95rem', margin: 0 }}>
                  <Editable text={policy.body} onSave={v => patch(prev => ({ ...prev, policy: { ...(prev.policy || DEFAULT_POLICY), body: v } }))} />
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Gallery */}
      <section className="p-section" style={{ paddingTop: 48 }}>
        <div className="p-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
            <div>
              <div className="p-eyebrow">The Work</div>
              <h2 className="p-display" style={{ fontSize: 'clamp(28px,4.5vw,44px)', marginTop: 12 }}>Hand-cut, <span className="p-italic" style={{ color: 'var(--p-brand)' }}>head by head.</span></h2>
            </div>
            <p className="p-serif p-italic" style={{ color: 'var(--p-ink-soft)' }}>Real cuts from inside the shop — no stock photos.</p>
          </div>
          <div className="p-gallery">
            {editorGalleryIndices.map((idx) => {
              const url = siteData.gallery[idx];
              const spec = GALLERY_SPEC[idx];
              return (
                <div key={idx} className="p-img-tile" style={{ gridColumn: spec.col, aspectRatio: spec.ratio }}>
                  {url ? (
                    <>
                      <img src={url} alt={`Gallery ${idx + 1}`} />
                      <ImageOverlay onUpload={e => handleImageChange(`gallery.${idx}`, e)} />
                    </>
                  ) : (
                    <ImagePlaceholder onUpload={e => handleImageChange(`gallery.${idx}`, e)} aspectRatio={spec.ratio} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Reviews */}
      {reviews.length > 0 && (
        <section className="p-section" style={{ background: 'var(--p-bg-2)' }}>
          <div className="p-container">
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div className="p-eyebrow">Client Reviews</div>
              <h2 className="p-display" style={{ fontSize: 'clamp(28px,5vw,46px)', marginTop: 14 }}>What clients <span className="p-italic" style={{ color: 'var(--p-brand)' }}>are saying.</span></h2>
            </div>
            {agg && (
              <div className="p-grid-2" style={{ maxWidth: 820, margin: '0 auto 32px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center', padding: '22px 28px', border: '1px solid var(--p-brand)', background: 'linear-gradient(135deg, rgba(212,166,74,0.18), rgba(212,166,74,0.05))' }}>
                <div>
                  <h3 style={{ fontSize: '1.15rem', margin: 0 }}>{agg.rating.toFixed(1)} stars across {agg.count.toLocaleString()} verified reviews</h3>
                  <p className="p-serif p-italic" style={{ color: 'var(--p-ink-soft)', margin: '6px 0 0' }}>Pulled directly from the booking page.</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="p-serif p-italic" style={{ fontSize: '2.4rem', color: 'var(--p-brand)' }}>{agg.rating.toFixed(1)}</div>
                  <div style={{ color: 'var(--p-brand)' }}>{'★'.repeat(Math.round(agg.rating))}</div>
                </div>
              </div>
            )}
            <div className="p-review-grid">
              {reviews.slice(0, 6).map((r, i) => (
                <div key={i} className="p-review-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div className="p-avatar">{(r.author || '★').charAt(0).toUpperCase()}</div>
                    <div>
                      <div className="p-serif" style={{ fontWeight: 600, fontSize: '1.05rem' }}>{r.author || 'Client'}</div>
                      {r.date && <div className="p-eyebrow" style={{ fontSize: 9.5, marginTop: 2, color: 'var(--p-ink-muted)' }}>{r.date}</div>}
                    </div>
                  </div>
                  <div style={{ color: 'var(--p-brand)', marginBottom: 8 }}>{'★'.repeat(Math.max(1, Math.min(5, r.rating || 5)))}</div>
                  <p className="p-serif p-italic" style={{ color: 'var(--p-ink-soft)', fontSize: '0.95rem', margin: 0 }}>{r.comment}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Pull quote */}
      <section className="p-section" style={{ background: 'radial-gradient(ellipse at center, rgba(212,166,74,0.07) 0%, transparent 60%), var(--p-bg)', textAlign: 'center' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <p className="p-serif p-italic" style={{ fontSize: 'clamp(1.5rem,3.6vw,2.7rem)', lineHeight: 1.3, color: 'var(--p-ink)', margin: 0 }}>
            <Editable text={pullQuote.text} onSave={v => patch(prev => ({ ...prev, pullQuote: { ...(prev.pullQuote || DEFAULT_PULLQUOTE), text: v } }))} />
          </p>
        </div>
      </section>

      {/* Booking strip */}
      <section style={{ background: 'var(--p-cream)', color: '#1a1a1a', textAlign: 'center', padding: '64px 6vw' }}>
        <div className="p-eyebrow" style={{ color: 'var(--p-brand-deep)', marginBottom: 14 }}>Take a Chair</div>
        <h2 className="p-display" style={{ fontSize: 'clamp(2rem,5vw,3rem)', margin: '0 0 16px', color: '#1a1a1a' }}>Ready for <span className="p-italic">your next cut?</span></h2>
        <p className="p-serif p-italic" style={{ color: '#555', margin: '0 0 28px' }}>Appointments recommended — walk-ins welcomed when chairs allow.</p>
        <a href={bookHref} onClick={handleBookClick} {...(siteData.bookingUrl ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="p-cta" style={{ background: '#1a1a1a', color: 'var(--p-brand)', borderColor: '#1a1a1a' }}>Book an Appointment</a>
      </section>

      {/* Visit + Hours */}
      <section className="p-section" style={{ background: 'var(--p-bg-2)' }}>
        <div className="p-container p-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 16 }}>Find the chair</div>
            <h2 className="p-display" style={{ fontSize: 'clamp(1.8rem,4vw,2.8rem)', margin: '0 0 28px' }}>Pay a visit.</h2>
            <div style={{ display: 'grid', gap: 22, color: 'var(--p-ink-soft)', fontSize: 16, lineHeight: 1.6 }}>
              <div>
                <div className="p-eyebrow" style={{ marginBottom: 6 }}>The Address</div>
                <Editable text={siteData.contact.address} tag="div" className="p-serif p-italic" style={{ color: 'var(--p-ink)', fontSize: '1.2rem' }} onSave={v => handleTextChange('contact.address', v)} />
              </div>
              <div>
                <div className="p-eyebrow" style={{ marginBottom: 6 }}>By Phone</div>
                <Editable text={siteData.phone} tag="div" className="p-serif p-italic" style={{ color: 'var(--p-ink)', fontSize: '1.2rem' }} onSave={v => handleTextChange('phone', v)} />
              </div>
              {siteData.bookingUrl && (
                <div>
                  <div className="p-eyebrow" style={{ marginBottom: 6 }}>Online Booking</div>
                  <a href={siteData.bookingUrl} target="_blank" rel="noopener noreferrer" onClick={handleBookClick} className="p-serif p-italic" style={{ color: 'var(--p-ink)', fontSize: '1.1rem' }}>Book online → confirmed instantly</a>
                </div>
              )}
              {/* Editor-only: booking URL input (never appears in deployed HTML) */}
              <div>
                <div className="p-eyebrow" style={{ marginBottom: 6 }}>Booking link (Book Appointment button)</div>
                <input
                  type="url"
                  defaultValue={siteData.bookingUrl || ''}
                  onBlur={e => handleTextChange('bookingUrl', e.target.value)}
                  placeholder="https://booksy.com/…"
                  className="p-editable"
                  style={{ width: '100%', background: 'rgba(212,166,74,0.06)', border: '1px solid rgba(212,166,74,0.3)', color: 'var(--p-ink)', fontSize: '1rem', padding: '6px 10px', outline: 'none' }}
                />
              </div>
            </div>
          </div>
          {hours.length > 0 ? (
            <div>
              <div className="p-eyebrow" style={{ marginBottom: 14 }}>Hours of Service</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {hours.map((h, i) => (
                  <li key={i} className="p-hours-row">
                    <Editable
                      text={h.day}
                      style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.08em' }}
                      onSave={v => patch(prev => { const next = [...(prev.hours || [])]; next[i] = { ...next[i], day: v }; return { ...prev, hours: next }; })}
                    />
                    {h.closed ? (
                      <button
                        onClick={() => patch(prev => { const next = [...(prev.hours || [])]; next[i] = { ...next[i], closed: false, open: next[i].open || '09:00', close: next[i].close || '19:00' }; return { ...prev, hours: next }; })}
                        className="p-serif p-italic"
                        style={{ fontSize: '1.05rem', color: 'var(--p-brand)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      >
                        Closed (tap to open)
                      </button>
                    ) : (
                      <span className="p-serif p-italic" style={{ fontSize: '1.05rem', color: 'var(--p-brand)' }}>
                        <Editable text={to12h(h.open)} onSave={v => patch(prev => { const next = [...(prev.hours || [])]; next[i] = { ...next[i], open: v }; return { ...prev, hours: next }; })} />
                        {' – '}
                        <Editable text={to12h(h.close)} onSave={v => patch(prev => { const next = [...(prev.hours || [])]; next[i] = { ...next[i], close: v }; return { ...prev, hours: next }; })} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <iframe
                src={`https://maps.google.com/maps?q=${mapQuery}&output=embed`}
                width="100%" height={320} style={{ border: 0, display: 'block' }}
                loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                title={`${siteData.shopName} on Google Maps`}
              />
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '48px 6vw', borderTop: '1px solid var(--p-line-soft)', textAlign: 'center' }}>
        <div className="p-container">
          <div className="p-serif p-italic" style={{ fontSize: 18, color: 'var(--p-brand)', marginBottom: 8 }}>{siteData.shopName}</div>
          <div className="p-eyebrow" style={{ color: 'var(--p-ink-muted)' }}>© 2025 · Built by AIBarber</div>
        </div>
      </footer>

      {/* PrePaymentBanner (pre-payment only; hidden until generated on /booksy) */}
      {!isPostPayment && !hidePrepaymentBanner && (
        <PrePaymentBanner
          onDeploy={handleClaimSite}
          onPrepareCheckout={preparePendingSite}
          isDeploying={isDeploying}
          industry="barbershop"
          onCheckoutFlowChange={onCheckoutFlowChange}
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

      {/* Pre-deploy hint when the user taps Book in the preview */}
      {showBookingToast && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, pointerEvents: 'none' }}
          aria-live="polite"
        >
          <div style={{ pointerEvents: 'auto', maxWidth: 480, width: '100%', background: '#0c0c0c', border: '1px solid rgba(232,192,116,0.4)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: '20px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: '#e8c074', marginTop: 8 }} />
            <p style={{ flex: 1, margin: 0, color: '#f0ece4', fontSize: 15, lineHeight: 1.5 }}>
              After you publish below, customers who tap <strong style={{ color: '#e8c074' }}>Book an Appointment</strong> will land on your booking page.
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

export default PrimeWebsite;
