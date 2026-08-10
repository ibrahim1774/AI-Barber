import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { WebsiteData, SiteInstance, SaveStatus } from '../types';
import { isCustomDesignAnyPath } from '../lib/dealMode.ts';

import {
  ScissorsIcon, RazorIcon, MustacheIcon, FaceIcon, SparklesIcon,
  MapPinIcon, AwardIcon, ClockIcon, PhoneIcon,
  CameraIcon
} from './Icons';
import { EditorToolbar } from './EditorToolbar';
import { EditorColorPicker } from './EditorColorPicker';
import { PublishOverlay } from './PublishOverlay';
import { useAutoSave } from '../hooks/useAutoSave';
import { useResetOnReturnFromStripe } from '../hooks/useResetOnReturnFromStripe';
import PrePaymentBanner from './PrePaymentBanner.tsx';
import { AIB_THEME_CSS, AibTheme, cityStateOnly, resolveAibTheme, to12h } from '../lib/render/luxe';

interface GeneratedWebsiteProps {
  data: WebsiteData;
  onBack: () => void;
  site?: SiteInstance;
  onNavigateDashboard?: () => void;
  isPostPayment?: boolean;
  userId?: string | null;
  // Optional — pass-through to PrePaymentBanner. Used by
  // /generatebarbershop so it can hide the mid-site prompt overlay
  // while the visitor is inside the embedded Stripe checkout.
  onCheckoutFlowChange?: (open: boolean) => void;
  // When true, the entire PrePaymentBanner (Launch CTA) is hidden. Used by
  // /booksy to hide the CTA until the visitor enters their link / generates.
  hidePrepaymentBanner?: boolean;
  // When provided, echoes internal edited state up to the parent on every
  // user edit (not on prop-sync). The /booksy funnel uses this so the
  // floating design switcher re-skins with EDITED content, not stale content.
  onUpdate?: (data: WebsiteData) => void;
  // When true, shows the floating EditorColorPicker pre-payment too (not just
  // post-payment). Used by the homepage + subpage generation flows so the
  // visitor can recolor the site right after it generates.
  showThemePicker?: boolean;
  // Where the pre-payment floating picker anchors. 'below-design' (default)
  // stacks it under the Design switcher; 'center' is used where there is no
  // Design switcher (e.g. the /generatebarbershop funnel).
  themePickerPlacement?: 'center' | 'below-design';
}







export const GeneratedWebsite: React.FC<GeneratedWebsiteProps> = ({ data, onBack, site, onNavigateDashboard, isPostPayment = false, userId = null, onCheckoutFlowChange, hidePrepaymentBanner, onUpdate, showThemePicker = false, themePickerPlacement = 'below-design' }) => {
  const [siteData, setSiteData] = useState<WebsiteData>(data);
  // Echo guard for onUpdate — see PrimeWebsite for the rationale. Only active
  // when onUpdate is provided (the /booksy funnel); a no-op otherwise.
  const skipNextUpdate = useRef(true);

  // Sync external `data` prop changes into internal state. Needed for
  // the /generatebarbershop funnel, which keeps its own siteData state
  // and pipes per-keystroke updates from BarbershopMidSitePrompts (area,
  // phone) down through this prop — without this useEffect the live
  // preview wouldn't reflect those keystrokes because useState only
  // reads its initializer once. Homepage flow is unaffected: App.tsx
  // sets generatedData exactly once after generation, so this never
  // overwrites any in-progress inline edits there.
  useEffect(() => {
    skipNextUpdate.current = true;
    setSiteData(data);
  }, [data]);
  // Echo internal edits up to the parent (skipping prop-sync bounces) so the
  // /booksy design switcher re-skins with the edited content.
  useEffect(() => {
    if (skipNextUpdate.current) { skipNextUpdate.current = false; return; }
    onUpdate?.(siteData);
  }, [siteData]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [, setDeploymentResult] = useState<{
    error?: string;
  } | null>(null);
  // Reset Publish button state when the user returns from Stripe
  // Checkout without completing payment (back button, closed tab, etc).
  // Without this the button stays stuck on its loading spinner because
  // bfcache preserves React state and we never get the chance to clear
  // it from the Stripe redirect path.
  const { markRedirecting } = useResetOnReturnFromStripe(useCallback(() => {
    setIsDeploying(false);
    setDeploymentResult(null);
  }, []));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [isPublishing, setIsPublishing] = useState(false);
  const [showPublishOverlay, setShowPublishOverlay] = useState(false);
  const [imageInputKey, setImageInputKey] = useState(0);
  // Per-slot "currently uploading" set so we can show a spinner on
  // the exact tile the user just tapped, instead of a global blocker.
  const [uploadingSlots, setUploadingSlots] = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showBookingToast, setShowBookingToast] = useState(false);

  // Auto-dismiss the booking-CTA hint
  useEffect(() => {
    if (!showBookingToast) return;
    const t = setTimeout(() => setShowBookingToast(false), 4000);
    return () => clearTimeout(t);
  }, [showBookingToast]);

  // Pre-deploy: clicking a Book button shows the explanation toast instead of navigating.
  // Post-deploy: lets the browser follow the link (open in new tab).
  const handleBookClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPostPayment) {
      e.preventDefault();
      setShowBookingToast(true);
    }
  };

  // Keep a ref to the current site instance for auto-save
  const siteRef = useRef<SiteInstance | null>(site ?? null);

  // Update siteRef whenever siteData changes
  useEffect(() => {
    if (siteRef.current) {
      siteRef.current = { ...siteRef.current, data: siteData };
    }
  }, [siteData]);

  const getSite = useCallback(() => siteRef.current, []);

  // Auto-save hook (only active in post-payment mode)
  const { triggerSave, saveNow } = useAutoSave(getSite, userId, setSaveStatus);

  // Theme color — written by the floating EditorColorPicker. resolveAibTheme
  // (preview + deployed HTML) reads siteData.colorTheme to recolor everything.
  const handleColorChange = (hex: string) => {
    setSiteData(prev => ({ ...prev, colorTheme: hex }));
    if (isPostPayment) triggerSave();
  };

  // Owner-editable section eyebrows/headings & small labels. `lbl` reads
  // the override (falling back to the hardcoded default); `setLabel`
  // writes it and triggers a save post-payment — mirrors the hours
  // editing pattern below.
  const lbl = (key: string, fallback: string) => (siteData.labels && siteData.labels[key]) || fallback;
  const setLabel = (key: string, value: string) => {
    setSiteData(prev => ({ ...prev, labels: { ...(prev.labels || {}), [key]: value } }));
    if (isPostPayment) triggerSave();
  };

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
    else if (parts[0] === 'featureCards') {
      // Initialize from defaults if missing so the path walk can index
      // featureCards[i] without crashing. Older saved sites predate
      // this field entirely.
      newData.featureCards = newData.featureCards
        ? newData.featureCards.map(c => ({ ...c }))
        : [
            { title: 'Experience', sub: 'Professional' },
            { title: 'Service', sub: 'Trusted' },
            { title: 'Open Monday to Friday', sub: '9am - 7pm' },
          ];
    }

    let current: any = newData;
    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]];
    }

    current[parts[parts.length - 1]] = value;
    setSiteData(newData);
    if (isPostPayment) triggerSave();
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

  // Write `value` at a dot-path inside a WebsiteData object,
  // deep-cloning the branches it touches so React's reconciler picks
  // up the change. Pure — doesn't reach into state.
  const writeAt = (src: WebsiteData, path: string, value: string): WebsiteData => {
    const next: any = { ...src };
    const parts = path.split('.');
    if (parts[0] === 'hero') next.hero = { ...next.hero };
    else if (parts[0] === 'about') next.about = { ...next.about };
    else if (parts[0] === 'gallery') next.gallery = [...next.gallery];
    else if (parts[0] === 'craftImages') next.craftImages = [...(next.craftImages || [])];
    let cur: any = next;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = value;
    return next;
  };

  // Handle image changes. Shows the picked file INSTANTLY via
  // createObjectURL so the preview reacts in <1ms, then swaps in the
  // compressed base64 in the background. Surfaces errors so the user
  // knows when something (HEIC, oversized) didn't work — was silently
  // doing nothing before.
  const handleImageChange = async (path: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    setSiteData(prev => writeAt(prev, path, previewUrl));
    setUploadingSlots(prev => new Set(prev).add(path));
    setUploadError(null);

    try {
      const base64String = await compressImage(file);
      setSiteData(prev => writeAt(prev, path, base64String));
      setImageInputKey(p => p + 1);
      if (isPostPayment) triggerSave();
    } catch (err: any) {
      console.error('Image compression failed:', err);
      setUploadError(
        /\.heic$/i.test(file.name || '')
          ? 'HEIC photos aren\'t supported yet — export as JPG from your phone and try again.'
          : `Couldn't process that photo. Try a smaller JPG or PNG. (${err?.message || 'unknown error'})`,
      );
      // Roll back the optimistic preview.
      setSiteData(prev => writeAt(prev, path, ''));
    } finally {
      setUploadingSlots(prev => {
        const n = new Set(prev);
        n.delete(path);
        return n;
      });
      try { URL.revokeObjectURL(previewUrl); } catch {}
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

  // Image replacement overlay (for existing images). Always-visible
  // centered Camera pill so the Replace target is unmistakable —
  // matches the PrimeHub "The Craft" affordance.
  // The ENTIRE image area is the click target (the label covers the whole
  // image via inset-0), so tapping anywhere on the photo opens the file
  // picker. The centered pill is just a visual affordance (pointer-events
  // none) so it never blocks the surrounding click area.
  const ImageOverlay = ({ onImageUpload, className = "" }: { onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void, className?: string }) => (
    <label className={`absolute inset-0 z-10 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/35 cursor-pointer ${className}`}>
      <span className="pointer-events-none flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-white shadow-lg backdrop-blur-sm">
        <CameraIcon className="w-3 h-3" />
        <span className="text-[9px] font-bold uppercase tracking-[0.16em]">Replace Photo</span>
      </span>
      <input key={imageInputKey} type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
    </label>
  );

  // "Add Your Own Image" placeholder for empty image slots
  const ImagePlaceholder = ({ onImageUpload, heightClass = "h-64" }: { onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void, heightClass?: string }) => (
    <label className={`cursor-pointer flex flex-col items-center justify-center w-full ${heightClass} bg-[#1a1a1a] border-2 border-dashed border-[#f4a100]/30 hover:border-[#f4a100] transition-all`}>
      <CameraIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]/50 mb-3" />
      <span className="text-[#f4a100]/70 text-[10px] md:text-xs font-bold uppercase tracking-wider">Add Your Own Image</span>
      <input key={imageInputKey} type="file" className="hidden" accept="image/*" onChange={onImageUpload} />
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
      case 'sparkles': return <SparklesIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
      default: return <ScissorsIcon className="w-10 h-10 md:w-12 md:h-12 text-[#f4a100]" />;
    }
  };

  // Prep step: upload images, build imageUrlMap, write pendingSite to
  // localStorage, fire InitiateCheckout pixels. Returns the siteId on
  // success so the caller can route it to either the hosted-checkout
  // redirect (handleClaimSite below) OR the embedded checkout flow in
  // PrePaymentBanner. WITHOUT this prep, the embedded checkout has no
  // pendingSite to restore from after Stripe return → deploy fails.
  const preparePendingSite = async (
    plan: 'monthly' | 'monthly-booksy' | 'monthly-free' | 'monthly-booking' | 'yearly' | 'yearly-booksy' | 'yearly-free' | 'yearly-booking' = 'monthly',
  ): Promise<{ siteId: string } | { error: string }> => {
    try {
      const siteId = siteSlug;

      // Step 1: Prepare images to upload (only base64 data URLs)
      const imagesToUpload: Array<{ key: string; filename: string; base64: string }> = [];
      const timestamp = Date.now();

      if (siteData.hero.imageUrl && siteData.hero.imageUrl.startsWith('data:')) {
        imagesToUpload.push({ key: 'hero', filename: `hero-${timestamp}.jpg`, base64: siteData.hero.imageUrl });
      }
      if (siteData.about.imageUrl && siteData.about.imageUrl.startsWith('data:')) {
        imagesToUpload.push({ key: 'about', filename: `about-${timestamp}.jpg`, base64: siteData.about.imageUrl });
      }
      siteData.gallery.forEach((imageUrl, index) => {
        if (imageUrl && imageUrl.startsWith('data:')) {
          imagesToUpload.push({ key: `gallery${index}`, filename: `gallery-${index}-${timestamp}.jpg`, base64: imageUrl });
        }
      });
      (siteData.craftImages || []).forEach((imageUrl, index) => {
        if (imageUrl && imageUrl.startsWith('data:')) {
          imagesToUpload.push({ key: `craft${index}`, filename: `craft-${index}-${timestamp}.jpg`, base64: imageUrl });
        }
      });
      (siteData.staff || []).forEach((s, index) => {
        if (s?.photo && s.photo.startsWith('data:')) {
          imagesToUpload.push({ key: `staff${index}`, filename: `staff-${index}-${timestamp}.jpg`, base64: s.photo });
        }
      });

      // Step 2: Upload images to GCS via proxy
      const imageUrlMap: Record<string, string> = {};
      if (imagesToUpload.length > 0) {
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
          }),
        );
      }

      // Carry over existing GCS URLs
      if (siteData.hero.imageUrl && siteData.hero.imageUrl.startsWith('http')) imageUrlMap['hero'] = siteData.hero.imageUrl;
      if (siteData.about.imageUrl && siteData.about.imageUrl.startsWith('http')) imageUrlMap['about'] = siteData.about.imageUrl;
      siteData.gallery.forEach((url, i) => { if (url && url.startsWith('http')) imageUrlMap[`gallery${i}`] = url; });
      (siteData.craftImages || []).forEach((url, i) => { if (url && url.startsWith('http')) imageUrlMap[`craft${i}`] = url; });
      (siteData.staff || []).forEach((s, i) => { if (s?.photo && s.photo.startsWith('http')) imageUrlMap[`staff${i}`] = s.photo; });

      // Step 3: Write pendingSite to localStorage so handleStripeReturn
      // in App.tsx can restore + deploy after Stripe sends the visitor
      // back. This is the step the embedded checkout path was missing.
      const pendingSite = {
        siteId,
        existingSiteId: site?.id ?? null,
        siteData: {
          ...siteData,
          hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] ? 'uploaded' : '' },
          about: { ...siteData.about, imageUrl: imageUrlMap['about'] ? 'uploaded' : '' },
          gallery: siteData.gallery.map((_, i) => imageUrlMap[`gallery${i}`] ? 'uploaded' : ''),
          craftImages: (siteData.craftImages || []).map((_, i) => imageUrlMap[`craft${i}`] ? 'uploaded' : ''),
          services: siteData.services.map(s => ({ ...s, imageUrl: '' })),
          staff: (siteData.staff || []).map((s, i) => ({
            ...s,
            photo: imageUrlMap[`staff${i}`] ? 'uploaded' : (s.photo?.startsWith('http') ? s.photo : ''),
          })),
        },
        imageUrlMap,
        timestamp: Date.now(),
      };
      localStorage.setItem('pendingSite', JSON.stringify(pendingSite));

      // Server-side recovery copy. Fire-and-forget — if it fails, the
      // localStorage write above is still the primary source. This
      // copy is what saves the deploy when the visitor returns from
      // Stripe in a different browser, incognito window, or after
      // their localStorage was cleared.
      fetch('/api/save-pending-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, data: pendingSite }),
        keepalive: true,
      }).catch((err) => console.warn('[save-pending-site] non-blocking:', err));

      // Step 4: Fire FB + TikTok InitiateCheckout (pixel + CAPI).
      // content_id + contents + phone close out the TikTok Events
      // Manager warnings about missing match params.
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: prep.siteId, plan, page: window.location.pathname }),
      });
      const checkoutData = await checkoutResponse.json();
      if (!checkoutResponse.ok || !checkoutData.url) {
        throw new Error(checkoutData.error || 'Failed to create checkout session');
      }
      // Flag the redirect so useResetOnReturnFromStripe knows to clear
      // isDeploying when the user comes back (back button, closed tab).
      markRedirecting();
      window.location.href = checkoutData.url;
    } catch (error: any) {
      console.error('Claim site error:', error);
      setDeploymentResult({ error: error.message || 'Failed to start checkout.' });
      setIsDeploying(false);
    }
  };

  const formattedPhone = siteData.phone.replace(/\s+/g, '');

  const handlePublish = () => {
    setShowPublishOverlay(true);
    setIsPublishing(true);
  };

  const handlePublishComplete = (url: string) => {
    setIsPublishing(false);
    // Update the site ref with the new deployment URL
    if (siteRef.current) {
      siteRef.current = { ...siteRef.current, deployedUrl: url, deploymentStatus: 'deployed' };
    }
  };

  const handlePublishError = () => {
    setIsPublishing(false);
  };

  const handlePublishClose = () => {
    setShowPublishOverlay(false);
    setIsPublishing(false);
  };

  // After publish, replace base64 images with their new GCS URLs in
  // editor state. craftImages mirrors gallery — fall back to existing
  // url so untouched defaults (still hotlinked from Vercel Blob) stay
  // in place. Staff array gets the same treatment per-entry.
  const handleImageUrlsUpdated = (imageUrlMap: Record<string, string>) => {
    setSiteData(prev => ({
      ...prev,
      hero: { ...prev.hero, imageUrl: imageUrlMap['hero'] || prev.hero.imageUrl },
      about: { ...prev.about, imageUrl: imageUrlMap['about'] || prev.about.imageUrl },
      gallery: prev.gallery.map((url, i) =>
        imageUrlMap[`gallery${i}`] || url || ''
      ),
      craftImages: (prev.craftImages || []).map((url, i) =>
        imageUrlMap[`craft${i}`] || url || ''
      ),
      staff: (prev.staff || []).map((s, i) => ({
        ...s,
        photo: imageUrlMap[`staff${i}`] || s.photo || '',
      })),
    }));
  };

  // Resolve color theme — falls back to gold/black when unset or unknown.
  // A custom picked color arrives as a raw hex ("#3b82f6"); paint it on the
  // dark canvas as the accent. Otherwise it's one of the named presets.
  const theme: AibTheme = resolveAibTheme(siteData);
  return (
    <div
      className={`aib-themed bg-[#0d0d0d] text-white overflow-hidden scroll-smooth pt-[32px] md:pt-[40px] ${!isPostPayment ? 'pb-[250px] md:pb-[180px]' : ''}`}
      style={{
        ['--aib-bg' as any]: `rgb(${theme.bgRgb})`,
        ['--aib-bg-rgb' as any]: theme.bgRgb,
        ['--aib-text' as any]: `rgb(${theme.textRgb})`,
        ['--aib-text-rgb' as any]: theme.textRgb,
        ['--aib-accent' as any]: theme.accent,
        ['--aib-accent-hover' as any]: theme.accentHover,
      }}
    >
      <style>{AIB_THEME_CSS}</style>
      {/* Toolbar: EditorToolbar for post-payment, red banner for pre-payment */}
      {isPostPayment ? (
        <>
          <EditorToolbar
            saveStatus={saveStatus}
            onSave={saveNow}
            onPublish={handlePublish}
            onBack={() => onNavigateDashboard?.()}
            isPublishing={isPublishing}
          />
          <EditorColorPicker current={siteData.colorTheme} onPick={handleColorChange} />
        </>
      ) : (
        <>
          {showThemePicker && (
            <EditorColorPicker current={siteData.colorTheme} onPick={handleColorChange} placement={themePickerPlacement} />
          )}
          <div className="fixed top-0 left-0 w-full bg-[#111111] border-b border-white/10 text-white py-2 px-2 md:py-2.5 md:px-3 z-[70] shadow-lg flex items-center gap-2">
            {/* Left: Back arrow */}
            <button onClick={onBack} className="shrink-0 p-1 hover:bg-white/10 rounded transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            {/* Center: Static label — centered via flex-1 + text-center
                so it sits between the back arrow and the status pill. */}
            <p className="flex-1 text-center text-[10px] md:text-[13px] font-bold uppercase tracking-wider text-[#f4a100]">
              {isCustomDesignAnyPath() ? 'Preview only \u2014 pick your design below, then get your custom site.' : 'Tap to edit text & images, then publish below.'}
            </p>

            {/* Right: Status pill */}
            <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 flex items-center gap-1">
              {saveStatus === 'saving' ? (
                <span className="flex items-center gap-1 text-[#f4a100] text-[8px] uppercase tracking-wider font-bold">
                  <svg className="w-2.5 h-2.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Saving...
                </span>
              ) : saveStatus === 'saved' ? (
                <span className="flex items-center gap-1 text-green-400 text-[8px] uppercase tracking-wider font-bold">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </span>
              ) : (
                <span className="text-[#999] text-[8px] uppercase tracking-wider font-bold">Editor</span>
              )}
            </div>
          </div>
        </>
      )}

      {/* Header */}
      <header className={`fixed top-[32px] md:top-[40px] left-0 w-full z-50 transition-all duration-300 ${isScrolled ? 'bg-[#1a1a1a]/95 backdrop-blur-md shadow-xl py-3 md:py-4' : 'bg-black/20 py-5 md:py-8'}`}>
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
      <section id="home" className="relative h-[55vh] flex flex-col justify-center items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          {siteData.hero.imageUrl && (
            <img src={siteData.hero.imageUrl} alt="Main Hero" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-black/40 bg-gradient-to-b from-black/30 via-transparent to-[#0d0d0d] pointer-events-none"></div>
        </div>
        {/* The whole hero photo is a replace target for the areas NOT covered
            by the centered text/CTAs (which sit above at z-10). */}
        <label className="group absolute inset-0 z-[5] cursor-pointer" aria-label="Replace hero photo">
          <input key={imageInputKey} type="file" className="hidden" accept="image/*" onChange={(e) => handleImageChange('hero.imageUrl', e)} />
        </label>
        {/* Dedicated Replace-Photo pill — its own clickable label ABOVE the
            z-10 hero text, so it stays tappable even where the centered
            text/CTA block overlaps the corner. This is the reliable target. */}
        <label className="absolute bottom-3 right-3 md:bottom-5 md:right-5 z-20 flex items-center gap-2 rounded-full bg-black/85 px-4 py-2.5 md:px-5 md:py-3 text-white shadow-xl backdrop-blur-sm border border-white/20 cursor-pointer hover:bg-black transition-colors">
          <CameraIcon className="w-4 h-4 md:w-5 md:h-5" />
          <span className="text-[10px] md:text-[12px] font-bold uppercase tracking-[0.16em]">Replace Photo</span>
          <input key={`${imageInputKey}-hero-pill`} type="file" className="hidden" accept="image/*" onChange={(e) => handleImageChange('hero.imageUrl', e)} />
        </label>

        <div className="relative z-10 text-center px-4 md:px-6 max-w-5xl pb-28 md:pb-32 pt-20 md:pt-0">
          <p className="text-[#f4a100] font-montserrat font-bold text-[8px] md:text-sm tracking-[3px] md:tracking-[5px] uppercase mb-3 md:mb-6 opacity-90">
            <EditableText text={siteData.hero.tagline} onSave={(val) => handleTextChange('hero.tagline', val)} />
          </p>

          <h1 className="text-3xl md:text-6xl lg:text-7xl font-montserrat font-black text-white leading-tight uppercase tracking-[1px] md:tracking-[4px] mb-8 md:mb-12">
            <EditableText text={siteData.hero.heading} onSave={(val) => handleTextChange('hero.heading', val)} />
          </h1>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4">
            <a
              href={`tel:${formattedPhone}`}
              className="inline-flex items-center gap-3 border-2 border-[#f4a100] text-[#f4a100] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 group shadow-lg text-xs md:text-base"
            >
              <PhoneIcon className="w-4 h-4 md:w-5 md:h-5 group-hover:scale-110 transition-transform" />
              <span>Call Now: <EditableText text={siteData.phone} onSave={(val) => handleTextChange('phone', val)} /></span>
            </a>
            {siteData.bookingUrl && (
              <a
                href={siteData.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleBookClick}
                className="inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-6 py-4 md:px-12 md:py-6 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-base"
              >
                <span>Book an Appointment</span>
              </a>
            )}
          </div>
        </div>

        {/* Feature Cards — title + sub are both editable. Defaults
            seeded by geminiService (Experience/Professional,
            Service/Trusted, Open Monday to Friday/9am-7pm). Older saved
            sites without featureCards fall back to the same defaults. */}
        <div className="absolute bottom-6 md:bottom-10 left-0 w-full px-4 md:px-6">
          <div className="container mx-auto grid grid-cols-3 gap-2 md:gap-6 max-w-5xl">
            {(() => {
              const defaults = [
                { title: 'Experience', sub: 'Professional' },
                { title: 'Service', sub: 'Trusted' },
                { title: 'Open Monday to Friday', sub: '9am - 7pm' },
              ];
              const icons = [
                <MapPinIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />,
                <AwardIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />,
                <ClockIcon className="w-5 h-5 md:w-8 md:h-8 text-[#f4a100]" />,
              ];
              const cards = (siteData.featureCards && siteData.featureCards.length === 3)
                ? siteData.featureCards
                : defaults;
              return cards.map((card, i) => (
                <div key={i} className="bg-[#1a1a1a]/90 backdrop-blur-sm p-2 md:p-8 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 md:gap-6 border border-[#f4a100]/20 hover:border-[#f4a100]/50 transition-all duration-300">
                  <div className="shrink-0">{icons[i]}</div>
                  <div className="text-center sm:text-left">
                    <h4 className="font-montserrat font-black text-[7px] md:text-xs tracking-[0.5px] md:tracking-[1px] text-white uppercase">
                      <EditableText
                        text={card.title}
                        onSave={(val) => handleTextChange(`featureCards.${i}.title`, val)}
                      />
                    </h4>
                    <p className="text-[#cccccc] text-[6px] md:text-[10px] uppercase tracking-[0.5px] md:tracking-[1px] mt-0.5">
                      <EditableText
                        text={card.sub}
                        onSave={(val) => handleTextChange(`featureCards.${i}.sub`, val)}
                      />
                    </p>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about-us" className="py-12 md:py-32 px-6 bg-[#1a1a1a]">
        <div className="container mx-auto grid lg:grid-cols-2 gap-10 md:gap-20 items-center">
          <div className="relative">
            <div className="flex items-center gap-3 mb-4 md:mb-6">
              <ScissorsIcon className="w-4 h-4 md:w-5 md:h-5 text-[#f4a100]" />
              <EditableText className="text-[#f4a100] text-[10px] md:text-xs font-bold tracking-[3px] md:tracking-[4px] uppercase font-montserrat" tagName="span" text={lbl('aboutEyebrow', 'About Us')} onSave={(v) => setLabel('aboutEyebrow', v)} />
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
          {siteData.about.imageUrl ? (
            <div className="relative mt-6 lg:mt-0 group">
              <div className="absolute -inset-2 md:-inset-4 border border-[#f4a100]/30 -z-10 transform translate-x-2 translate-y-2 md:translate-x-4 md:translate-y-4 transition-transform duration-500"></div>
              <img src={siteData.about.imageUrl} alt="Barber Shop Atmosphere" className="w-full grayscale hover:grayscale-0 transition-all duration-700 shadow-2xl" />
              <ImageOverlay onImageUpload={(e) => handleImageChange('about.imageUrl', e)} />
            </div>
          ) : (
            <div className="mt-6 lg:mt-0">
              <ImagePlaceholder onImageUpload={(e) => handleImageChange('about.imageUrl', e)} heightClass="h-72 md:h-96" />
            </div>
          )}
        </div>
      </section>

      {/* Gallery Section — owner's portfolio ("Our Work"). 6 slots
          [2..7] populated from the scraped booking-link photos (Booksy,
          Fresha, etc.) or left empty for the owner to upload via the
          Replace Photo overlay on each tile. */}
      <section className="py-16 md:py-32 bg-[#0d0d0d] px-6 border-y border-white/5">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-10 md:mb-16">
            <EditableText className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat" tagName="h3" text={lbl('galleryEyebrow', 'Gallery')} onSave={(v) => setLabel('galleryEyebrow', v)} />
            <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]" tagName="h2" text={lbl('galleryHeading', 'Our Work')} onSave={(v) => setLabel('galleryHeading', v)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {[2, 3, 4, 5, 6, 7].map((idx) => (
              <div key={idx} className="bg-[#1a1a1a] p-1 border border-white/5 relative group">
                {siteData.gallery[idx] ? (
                  <>
                    <img src={siteData.gallery[idx]} alt={`Gallery Image ${idx - 1}`} className="w-full h-48 sm:h-56 md:h-64 object-cover" />
                    <ImageOverlay onImageUpload={(e) => handleImageChange(`gallery.${idx}`, e)} />
                  </>
                ) : (
                  <ImagePlaceholder onImageUpload={(e) => handleImageChange(`gallery.${idx}`, e)} heightClass="h-48 sm:h-56 md:h-64" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Services Grid — 3-column menu layout with title + price on
          one row, duration/subtitle below, then description. Price is
          editable separately when present (only set by scraped Booksy
          imports). Empty fields just don't render in deployed HTML. */}
      <section id="our-services" className="py-12 md:py-32 bg-[#0d0d0d] px-6">
        <div className="container mx-auto max-w-7xl">
          <div className="text-center mb-10 md:mb-16">
            <EditableText className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat" tagName="h3" text={lbl('servicesEyebrow', 'Services')} onSave={(v) => setLabel('servicesEyebrow', v)} />
            <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]" tagName="h2" text={lbl('servicesHeading', 'What We Offer')} onSave={(v) => setLabel('servicesHeading', v)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {siteData.services.map((service, i) => (
              <div key={i} className="group border-2 border-[#f4a100] p-6 md:p-10 flex flex-col hover:bg-[#1a1a1a] transition-all duration-500">
                <div className="flex items-start justify-between gap-3 mb-3 md:mb-4">
                  <h3 className="font-montserrat font-black text-white text-base md:text-lg tracking-[1px] uppercase leading-tight flex-1">
                    <EditableText
                      text={service.title}
                      onSave={(val) => {
                        const newServices = [...siteData.services];
                        newServices[i].title = val;
                        handleTextChange('services', newServices as any);
                      }}
                    />
                  </h3>
                  {(service.price || '') && (
                    <span className="font-montserrat font-black text-[#f4a100] text-base md:text-lg whitespace-nowrap">
                      <EditableText
                        text={service.price || ''}
                        onSave={(val) => {
                          const newServices = [...siteData.services];
                          newServices[i].price = val;
                          handleTextChange('services', newServices as any);
                        }}
                      />
                    </span>
                  )}
                </div>
                {(service.duration || service.subtitle) && (
                  <p className="text-[#f4a100] text-[10px] md:text-[11px] font-bold tracking-[2px] mb-3 uppercase">
                    <EditableText
                      text={service.duration || service.subtitle}
                      onSave={(val) => {
                        const newServices = [...siteData.services];
                        if (service.duration) newServices[i].duration = val;
                        else newServices[i].subtitle = val;
                        handleTextChange('services', newServices as any);
                      }}
                    />
                  </p>
                )}
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

      {/* Reviews Section — shows aggregate rating header when set
          (Booksy JSON-LD ships it), then up to 12 review cards. Older
          saved sites without reviews skip this entire section. */}
      {siteData.reviews && siteData.reviews.length > 0 && (
        <section className="py-16 md:py-28 bg-[#0a0a0a] px-6 border-y border-white/5">
          <div className="container mx-auto max-w-6xl">
            {siteData.aggregateRating && (
              <div className="text-center mb-10 md:mb-12">
                <div className="inline-flex items-center gap-3 bg-[#1a1a1a] border border-[#f4a100]/30 px-5 py-3 md:px-7 md:py-4">
                  <span className="text-[#f4a100] text-2xl md:text-3xl">★</span>
                  <span className="text-white text-2xl md:text-3xl font-montserrat font-black">
                    {siteData.aggregateRating.rating.toFixed(1)}
                  </span>
                  {siteData.aggregateRating.count > 0 && (
                    <span className="text-white/60 text-[10px] md:text-xs uppercase tracking-[2px] font-bold">
                      from {siteData.aggregateRating.count.toLocaleString()} reviews
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="text-center mb-10 md:mb-14">
              <EditableText className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat" tagName="h3" text={lbl('reviewsEyebrow', 'Reviews')} onSave={(v) => setLabel('reviewsEyebrow', v)} />
              <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]" tagName="h2" text={lbl('reviewsHeading', 'What Our Clients Say')} onSave={(v) => setLabel('reviewsHeading', v)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {siteData.reviews.slice(0, 12).map((r, i) => (
                <div key={i} className="border border-white/10 bg-[#111111] p-5 md:p-7 flex flex-col gap-3">
                  <div className="flex items-center gap-1" aria-label={`${r.rating} out of 5 stars`}>
                    {Array.from({ length: 5 }, (_, s) => (
                      <span key={s} className={s < r.rating ? 'text-[#f4a100]' : 'text-white/15'}>★</span>
                    ))}
                  </div>
                  <p className="text-white/80 text-sm md:text-base leading-relaxed italic">
                    “{r.comment}”
                  </p>
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[2px] text-white/50 mt-auto pt-2 border-t border-white/5">
                    <span className="font-bold text-white/80">{r.author}</span>
                    {r.date && <span>{r.date}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Meet the Team — staff cards with replaceable photos. Each
          card's name + role are inline-editable; photo gets the same
          Replace/Add affordances as the gallery. Skipped when no
          staff data (manual-form sites). */}
      {siteData.staff && siteData.staff.length > 0 && (
        <section className="py-16 md:py-28 bg-[#0a0a0a] px-6 border-y border-white/5">
          <div className="container mx-auto max-w-6xl">
            <div className="text-center mb-10 md:mb-16">
              <EditableText className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat" tagName="h3" text={lbl('teamEyebrow', 'The Team')} onSave={(v) => setLabel('teamEyebrow', v)} />
              <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]" tagName="h2" text={lbl('teamHeading', 'Meet Our Barbers')} onSave={(v) => setLabel('teamHeading', v)} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {siteData.staff.map((s, i) => (
                <div key={i} className="flex flex-col items-center text-center">
                  <div className="relative w-full aspect-square mb-3 overflow-hidden bg-[#1a1a1a] border border-white/5 group">
                    {s.photo ? (
                      <>
                        <img src={s.photo} alt={s.name || 'Staff'} className="w-full h-full object-cover" />
                        <ImageOverlay onImageUpload={(e) => {
                          const file = e.target.files?.[0]; if (!file) return;
                          const previewUrl = URL.createObjectURL(file);
                          setSiteData(prev => {
                            const staff = [...(prev.staff || [])];
                            staff[i] = { ...staff[i], photo: previewUrl };
                            return { ...prev, staff };
                          });
                          compressImage(file).then(b64 => {
                            setSiteData(prev => {
                              const staff = [...(prev.staff || [])];
                              staff[i] = { ...staff[i], photo: b64 };
                              return { ...prev, staff };
                            });
                            setImageInputKey(p => p + 1);
                            if (isPostPayment) triggerSave();
                          }).catch(err => {
                            console.error('Staff photo compress failed', err);
                            setUploadError(`Couldn't process that photo. Try a smaller JPG or PNG.`);
                          }).finally(() => { try { URL.revokeObjectURL(previewUrl); } catch {} });
                        }} />
                      </>
                    ) : (
                      <ImagePlaceholder
                        heightClass="h-full"
                        onImageUpload={(e) => {
                          const file = e.target.files?.[0]; if (!file) return;
                          const previewUrl = URL.createObjectURL(file);
                          setSiteData(prev => {
                            const staff = [...(prev.staff || [])];
                            staff[i] = { ...staff[i], photo: previewUrl };
                            return { ...prev, staff };
                          });
                          compressImage(file).then(b64 => {
                            setSiteData(prev => {
                              const staff = [...(prev.staff || [])];
                              staff[i] = { ...staff[i], photo: b64 };
                              return { ...prev, staff };
                            });
                            setImageInputKey(p => p + 1);
                            if (isPostPayment) triggerSave();
                          }).catch(err => {
                            console.error('Staff photo compress failed', err);
                            setUploadError(`Couldn't process that photo. Try a smaller JPG or PNG.`);
                          }).finally(() => { try { URL.revokeObjectURL(previewUrl); } catch {} });
                        }}
                      />
                    )}
                  </div>
                  <h4 className="font-montserrat font-black text-white text-sm md:text-base tracking-[1px] uppercase">
                    <EditableText
                      text={s.name || ''}
                      onSave={(val) => {
                        setSiteData(prev => {
                          const staff = [...(prev.staff || [])];
                          staff[i] = { ...staff[i], name: val };
                          return { ...prev, staff };
                        });
                        if (isPostPayment) triggerSave();
                      }}
                    />
                  </h4>
                  <p className="text-[#f4a100] text-[10px] md:text-[11px] font-bold tracking-[2px] uppercase mt-1">
                    <EditableText
                      text={s.role || 'Barber'}
                      onSave={(val) => {
                        setSiteData(prev => {
                          const staff = [...(prev.staff || [])];
                          staff[i] = { ...staff[i], role: val };
                          return { ...prev, staff };
                        });
                        if (isPostPayment) triggerSave();
                      }}
                    />
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Hours — Mon-Sun rows. Editable times. Click a day to flip its
          Closed flag. Skipped when no hours data. */}
      {siteData.hours && siteData.hours.length > 0 && (
        <section className="py-16 md:py-24 bg-[#0d0d0d] px-6 border-y border-white/5">
          <div className="container mx-auto max-w-2xl">
            <div className="text-center mb-8 md:mb-12">
              <EditableText className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-4 font-montserrat" tagName="h3" text={lbl('hoursEyebrow', 'Hours')} onSave={(v) => setLabel('hoursEyebrow', v)} />
              <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px]" tagName="h2" text={lbl('hoursHeading', "When We're Open")} onSave={(v) => setLabel('hoursHeading', v)} />
            </div>
            <div className="bg-[#1a1a1a] border border-white/5 divide-y divide-white/5">
              {siteData.hours.map((h, i) => (
                <div key={i} className="flex items-center justify-between px-5 md:px-8 py-3.5 md:py-4">
                  <EditableText
                    className="text-white text-sm md:text-base font-bold uppercase tracking-[2px]"
                    text={h.day}
                    onSave={(val) => {
                      setSiteData(prev => {
                        const hours = [...(prev.hours || [])];
                        hours[i] = { ...hours[i], day: val };
                        return { ...prev, hours };
                      });
                      if (isPostPayment) triggerSave();
                    }}
                  />
                  {h.closed ? (
                    <button
                      onClick={() => {
                        setSiteData(prev => {
                          const hours = [...(prev.hours || [])];
                          hours[i] = { ...hours[i], closed: false, open: hours[i].open || '09:00', close: hours[i].close || '19:00' };
                          return { ...prev, hours };
                        });
                        if (isPostPayment) triggerSave();
                      }}
                      className="text-[#f4a100]/60 text-sm md:text-base font-bold tracking-[1px] hover:text-[#f4a100] uppercase"
                    >
                      Closed (tap to open)
                    </button>
                  ) : (
                    <span className="text-[#f4a100] text-sm md:text-base font-bold tracking-[1px]">
                      <EditableText
                        text={to12h(h.open)}
                        onSave={(val) => {
                          setSiteData(prev => {
                            const hours = [...(prev.hours || [])];
                            hours[i] = { ...hours[i], open: val };
                            return { ...prev, hours };
                          });
                          if (isPostPayment) triggerSave();
                        }}
                      />
                      {' – '}
                      <EditableText
                        text={to12h(h.close)}
                        onSave={(val) => {
                          setSiteData(prev => {
                            const hours = [...(prev.hours || [])];
                            hours[i] = { ...hours[i], close: val };
                            return { ...prev, hours };
                          });
                          if (isPostPayment) triggerSave();
                        }}
                      />
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* "The Craft" / "An eye for the work" section removed —
          editor preview no longer shows it so the editor matches
          the deployed HTML. */}

      {/* Contact Section */}
      <section id="contact-us" className="py-12 md:py-32 bg-[#0d0d0d] px-4 md:px-6">
        <div className="container mx-auto max-w-4xl shadow-2xl overflow-hidden bg-[#1a1a1a]">
          <div className="w-full p-8 md:p-20 flex flex-col items-center text-center bg-[#1a1a1a]">
            <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white mb-8 md:mb-12 uppercase tracking-[2px]" tagName="h2" text={lbl('contactHeading', 'Visit Us')} onSave={(v) => setLabel('contactHeading', v)} />
            <div className="grid md:grid-cols-2 gap-8 md:gap-12 w-full max-w-2xl">
              <div className="flex flex-col items-center gap-4">
                <MapPinIcon className="w-8 h-8 text-[#f4a100]" />
                <div>
                  <EditableText className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-2 font-montserrat uppercase" tagName="h4" text={lbl('contactLocationLabel', 'Location')} onSave={(v) => setLabel('contactLocationLabel', v)} />
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed capitalize">
                    <EditableText text={siteData.contact.address} onSave={(val) => handleTextChange('contact.address', val)} />
                  </p>
                </div>
              </div>
              <a href={`tel:${formattedPhone}`} className="flex flex-col items-center gap-4 group">
                <PhoneIcon className="w-8 h-8 text-[#f4a100] group-hover:scale-110 transition-transform" />
                <div>
                  <EditableText className="text-[#f4a100] font-bold text-[10px] md:text-xs tracking-[2px] mb-2 font-montserrat uppercase" tagName="h4" text={lbl('contactPhoneLabel', 'Phone')} onSave={(v) => setLabel('contactPhoneLabel', v)} />
                  <p className="text-[#cccccc] text-xs md:text-sm leading-relaxed group-hover:text-white transition-colors">
                    <EditableText text={siteData.phone} onSave={(val) => handleTextChange('phone', val)} />
                  </p>
                </div>
              </a>
            </div>

            {siteData.bookingUrl && (
              <a
                href={siteData.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleBookClick}
                className="inline-flex items-center gap-3 bg-[#f4a100] text-[#1a1a1a] px-8 py-4 md:px-12 md:py-5 mt-8 md:mt-12 font-montserrat font-black tracking-[2px] uppercase hover:bg-white transition-all duration-300 shadow-lg text-xs md:text-sm"
              >
                Book Appointment
              </a>
            )}

            {/* Editor-only: booking URL input (never appears in deployed HTML) */}
            <div className="mt-6 w-full max-w-md">
              <label className="block text-[#f4a100] font-bold text-[9px] md:text-[10px] tracking-[2px] uppercase font-montserrat mb-1">Booking link (Book Appointment button)</label>
              <input
                type="url"
                defaultValue={siteData.bookingUrl || ''}
                onBlur={(e) => handleTextChange('bookingUrl', e.target.value)}
                placeholder="https://booksy.com/…"
                className="w-full bg-[#111] border border-white/20 text-[#ccc] text-xs px-3 py-2 outline-none focus:border-[#f4a100]/60 rounded"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Find Us — Google Maps embed driven by the entered address */}
      <section id="find-us" className="py-12 md:py-20 bg-[#0d0d0d] px-4 md:px-6 border-t border-white/5">
        <div className="container mx-auto max-w-4xl text-center">
          <EditableText className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-3 md:mb-4 font-montserrat" tagName="h3" text={lbl('mapEyebrow', 'Find Us')} onSave={(v) => setLabel('mapEyebrow', v)} />
          <EditableText className="text-2xl md:text-4xl font-montserrat font-black text-white uppercase tracking-[2px] mb-8 md:mb-12" tagName="h2" text={lbl('mapHeading', 'Stop By')} onSave={(v) => setLabel('mapHeading', v)} />
          <div className="bg-[#1a1a1a] p-1 border border-white/5">
            <iframe
              title={`${siteData.shopName} on Google Maps`}
              src={`https://maps.google.com/maps?q=${encodeURIComponent(`${siteData.shopName} ${siteData.contact.address}`)}&output=embed`}
              width="100%"
              height={360}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              style={{ border: 0, display: 'block', filter: 'grayscale(0.2) contrast(1.05)' }}
            />
          </div>
        </div>
      </section>

      {/* Custom-design footer CTA — editor-only. Renders ONLY during
          the pre-publish editing view so it can never appear on a
          deployed/published site. The static deploy template (lines
          ~241-380) doesn't reference this section either, so even
          if isPostPayment were misconfigured the published HTML
          stays clean. */}
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
            Premium Grooming Excellence in <EditableText text={cityStateOnly(siteData.area)} onSave={(val) => handleTextChange('area', val)} />
          </p>

          <div className="pt-8 md:pt-10 border-t border-white/5 text-[#444444] text-[8px] uppercase tracking-[2px]">
            Copyright &copy; 2025 <EditableText text={siteData.shopName} onSave={(val) => handleTextChange('shopName', val)} />. Built by AIBarber.
          </div>
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

      {/* Image-upload error toast — surfaces compression failures so
          the user knows when an upload silently didn't take. Dismissed
          on click or when the next upload succeeds. */}
      {uploadError && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[180] w-[min(420px,calc(100vw-2rem))] pointer-events-auto"
          role="alert"
        >
          <div className="flex items-start gap-3 bg-[#1a0a0a] border border-red-500/50 shadow-[0_20px_60px_rgba(0,0,0,0.6)] px-4 py-3">
            <div className="shrink-0 w-2 h-2 rounded-full bg-red-500 mt-1.5" />
            <p className="text-red-200 text-xs md:text-sm leading-relaxed flex-1">{uploadError}</p>
            <button
              onClick={() => setUploadError(null)}
              className="shrink-0 text-red-300/60 hover:text-white transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Pre-deploy hint when the user taps a Book Appointment button in the preview */}
      {showBookingToast && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center px-4 pointer-events-none"
          aria-live="polite"
        >
          <div className="pointer-events-auto max-w-md w-full bg-[#1a1a1a] border border-[#f4a100]/40 shadow-[0_20px_60px_rgba(0,0,0,0.6)] px-5 py-5 flex items-start gap-3">
            <div className="shrink-0 w-2 h-2 rounded-full bg-[#f4a100] mt-2" />
            <p className="text-white text-sm md:text-base leading-relaxed flex-1">
              After you publish below, customers who tap <span className="text-[#f4a100] font-bold">Book Appointment</span> will land on your booking page.
            </p>
            <button
              onClick={() => setShowBookingToast(false)}
              className="shrink-0 text-white/40 hover:text-white transition-colors -mt-1 -mr-1"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
