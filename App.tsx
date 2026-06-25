import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { AppState, ShopInputs, WebsiteData, SiteInstance } from './types.ts';

// Meta Pixel global (loaded in index.html). `fbq` is added to window at runtime.
declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
  }
}

import { GeneratorForm } from './components/GeneratorForm.tsx';
import { HomeBookingPrompts } from './components/HomeBookingPrompts.tsx';
import { HomeLaunchGuide } from './components/HomeLaunchGuide.tsx';
import { buildSiteFromScrape } from './lib/buildSiteFromScrape.ts';
import { ensureUuid } from './lib/ensureUuid.ts';
import { extractFirstUrl, isSupportedBookingHost } from './lib/supportedBookingHost.ts';
import { isBooksyPath, isFreeBarberPath, isPrimeBarberPath, isRecoverPath, isGenerateBarbershopPath, isGeneratePath, isAdminGeneratePath, isOwnBrandPath } from './lib/dealMode.ts';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { generateHTMLForTemplate } from './services/templateRenderer.ts';
import { generateContent } from './services/geminiService.ts';
import { fireLead, isLeadComplete } from './lib/leadEvents.ts';
import { useAuth } from './contexts/AuthContext.tsx';
import { saveSite, getSite } from './services/indexedDBService.ts';
import { upsertSiteToSupabase, fetchUserSites } from './services/supabaseDataService.ts';
import { getPlanContentMeta, getViewContentMeta } from './lib/pixelMeta';
import { getAllSites as getAllLocalSites } from './services/indexedDBService.ts';
import { readMetaCookies, splitName } from './services/metaMatchParams.ts';

// Heavy components — lazy-loaded so first paint only ships the
// active-path form (GeneratorForm) + LoadingScreen. Editor, dashboard,
// modals, /primebarber landing stream in only when the visitor's
// flow actually needs them.
const NewLeadQuizForm = lazy(() => import('./components/NewLeadQuizForm.tsx').then(m => ({ default: m.NewLeadQuizForm })));
const PrimeBarberLanding = lazy(() => import('./components/PrimeBarberLanding.tsx').then(m => ({ default: m.PrimeBarberLanding })));
const GeneratedWebsite = lazy(() => import('./components/GeneratedWebsite.tsx').then(m => ({ default: m.GeneratedWebsite })));
const EuphoriaWebsite = lazy(() => import('./components/EuphoriaWebsite.tsx').then(m => ({ default: m.EuphoriaWebsite })));
const PostDeploymentModal = lazy(() => import('./components/PostDeploymentModal.tsx').then(m => ({ default: m.PostDeploymentModal })));
const ManagementDashboard = lazy(() => import('./components/ManagementDashboard.tsx').then(m => ({ default: m.ManagementDashboard })));
const AuthModal = lazy(() => import('./components/AuthModal.tsx').then(m => ({ default: m.AuthModal })));
const RecoverPage = lazy(() => import('./components/RecoverPage.tsx').then(m => ({ default: m.RecoverPage })));
const GenerateBarbershopFunnel = lazy(() => import('./components/GenerateBarbershopFunnel.tsx').then(m => ({ default: m.GenerateBarbershopFunnel })));
const GeneratePage = lazy(() => import('./components/GeneratePage.tsx').then(m => ({ default: m.GeneratePage })));
const AdminGenerator = lazy(() => import('./components/AdminGenerator.tsx').then(m => ({ default: m.AdminGenerator })));
const OwnBrandLanding = lazy(() => import('./components/OwnBrandLanding.tsx').then(m => ({ default: m.OwnBrandLanding })));

const DEPLOY_TIMER_SECONDS = 5;

// True only for the bare root path "/" — the homepage progressive
// funnel (name-only generation → booking-link / area-phone prompt).
// /booksy, /free-barber, /new keep the original 4-field GeneratorForm.
const isRootHomePath = (): boolean => {
  try { return window.location.pathname.replace(/\/+$/, '') === ''; } catch { return false; }
};

const App: React.FC = () => {
  const { isAuthenticated, isLoading: authLoading, user, signOut } = useAuth();

  const [state, setState] = useState<AppState>('generator');
  const [generatedData, setGeneratedData] = useState<WebsiteData | null>(null);
  const [activeSite, setActiveSite] = useState<SiteInstance | null>(null);
  const [deployResult, setDeployResult] = useState<{ url?: string; error?: string } | null>(null);
  const [deployCountdown, setDeployCountdown] = useState(DEPLOY_TIMER_SECONDS);
  const [deployShopName, setDeployShopName] = useState('');
  const [copied, setCopied] = useState(false);

  // Post-deployment modal state
  const [showPostDeployModal, setShowPostDeployModal] = useState(false);

  // Post-generation intro modal — fires once after a /new visitor lands
  // in the editor. Mirrors the "Your site is fully editable" tour from
  // PrimeHub /barber. Persists until the user X's out.
  const [showEditorIntro, setShowEditorIntro] = useState(false);
  // Homepage progressive funnel: the booking-link / area-phone prompt
  // overlay shown after a name-only generation, and a flag that hides
  // it while the Stripe checkout modal is open.
  const [showHomePrompts, setShowHomePrompts] = useState(false);
  const [isCheckoutFlowOpen, setIsCheckoutFlowOpen] = useState(false);
  // Short "how it works" guide shown once after the homepage funnel
  // finishes generating, before the visitor edits / launches.
  const [showLaunchGuide, setShowLaunchGuide] = useState(false);
  const cameFromNewRef = useRef(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signup');
  const [authSignInOnly, setAuthSignInOnly] = useState(false);

  // App ready guard: don't render until auth state is determined
  const [appReady, setAppReady] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const generationFailedRef = useRef(false);
  const isLegitDeployRef = useRef(false);

  const persistView = useCallback((view: AppState, siteId?: string) => {
    setState(view);
    sessionStorage.setItem('appView', view);
    if (siteId) {
      sessionStorage.setItem('activeSiteId', siteId);
    } else if (view === 'generator') {
      sessionStorage.removeItem('activeSiteId');
      sessionStorage.removeItem('pendingFormInputs');
    }
  }, []);

  // Guard: if we land on the deploying screen without an active deployment
  // (e.g. browser back from Stripe checkout via bfcache), restore the preview.
  useEffect(() => {
    if (state === 'deploying' && !isLegitDeployRef.current) {
      if (generatedData) {
        setState('editor');
      } else {
        setState('generator');
      }
      setDeployResult(null);
      setDeployCountdown(DEPLOY_TIMER_SECONDS);
    }
  }, [state]);

  // Handle bfcache restore (browser back/forward preserving JS heap)
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        // Page was restored from bfcache — any in-flight deploy is stale
        isLegitDeployRef.current = false;
        setState((prev) => {
          if (prev === 'deploying') {
            setDeployResult(null);
            setDeployCountdown(DEPLOY_TIMER_SECONDS);
            return generatedData ? 'editor' : 'generator';
          }
          return prev;
        });
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [generatedData]);

  // Session restore on mount
  useEffect(() => {
    if (authLoading) return;

    const savedView = sessionStorage.getItem('appView') as AppState | null;
    const savedSiteId = sessionStorage.getItem('activeSiteId');
    const savedInputs = sessionStorage.getItem('pendingFormInputs');

    if (savedView === 'editor' && savedSiteId) {
      getSite(savedSiteId).then(site => {
        if (site) {
          setActiveSite(site);
          setGeneratedData(site.data);
          setState('editor');
        }
        setIsRestoring(false);
      }).catch(() => setIsRestoring(false));
    } else if (savedView === 'editor' && savedInputs) {
      setIsRestoring(false);
      try { handleGenerate(JSON.parse(savedInputs)); } catch { setIsRestoring(false); }
    } else {
      setIsRestoring(false);
    }
  }, [authLoading]);

  // Auto-retry on visibility change (background generation protection)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && generationFailedRef.current) {
        generationFailedRef.current = false;
        const saved = sessionStorage.getItem('pendingFormInputs');
        if (saved) {
          try { handleGenerate(JSON.parse(saved)); } catch { persistView('generator'); }
        } else {
          persistView('generator');
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // ─── ViewContent pixel fire on first paint ───
  // Resolves the "Missing events" warning in TikTok + Meta Events
  // Manager. Fires once per page-load for every subpage (homepage,
  // /booksy, /free-barber, /new, /primebarber, niches). content_id
  // resolution comes from lib/pixelMeta so the value matches what
  // /api/tiktok-event + /api/fb-view-content receive on the server
  // side. The fire is gated behind a ref so React StrictMode's
  // double-mount doesn't double-fire.
  const viewContentFiredRef = useRef(false);
  useEffect(() => {
    if (viewContentFiredRef.current) return;
    viewContentFiredRef.current = true;
    // Skip the post-payment return because the deploying screen
    // doesn't represent a real landing-page view, and the visitor's
    // Purchase event already fires the conversion signal.
    if (window.location.search.includes('stripe_session') || window.location.search.includes('payment=success')) {
      return;
    }
    (async () => {
      try {
        const meta = getViewContentMeta(window.location.pathname);
        const eventId =
          typeof crypto !== 'undefined' && (crypto as any).randomUUID
            ? (crypto as any).randomUUID()
            : `vc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const url = window.location.href;
        const ua = navigator.userAgent;
        // Read fbc/fbp cookies so CAPI ViewContent inherits the match
        // quality the browser pixel gets, plus carries first-touch
        // attribution forward into Lead / Purchase later in the funnel.
        const { fbc, fbp } = readMetaCookies();
        // Browser pixels — same event_id pairs with CAPI hits below.
        try { window.fbq?.('track', 'ViewContent', { content_ids: [meta.content_id], content_type: meta.content_type, content_name: meta.content_name }, { eventID: eventId }); } catch {}
        try { (window as any).ttq?.track('ViewContent', { content_id: meta.content_id, content_type: meta.content_type, content_name: meta.content_name }, { event_id: eventId }); } catch {}
        // CAPI hits
        fetch('/api/fb-view-content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId, eventSourceUrl: url, clientUserAgent: ua, fbc, fbp, externalId: eventId, content_id: meta.content_id, content_name: meta.content_name, content_type: meta.content_type }),
          keepalive: true,
        }).catch(() => { /* non-blocking */ });
        fetch('/api/tiktok-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'ViewContent', event_id: eventId, event_source_url: url, user_agent: ua, content_id: meta.content_id, content_name: meta.content_name, content_type: meta.content_type }),
          keepalive: true,
        }).catch(() => { /* non-blocking */ });
      } catch (err) {
        console.warn('[ViewContent] fire failed (non-blocking):', err);
      }
    })();
  }, []);

  // Determine initial view based on auth state
  useEffect(() => {
    if (authLoading || isRestoring) return;

    const params = new URLSearchParams(window.location.search);
    const stripeSessionId = params.get('stripe_session');
    const stripePlan = params.get('plan') || '';
    const stripeRedirect = params.get('redirect') || '';
    const domainPayment = params.get('domain_payment');

    // Custom-design plans bounce through the app ONLY so the Purchase
    // pixels can fire — then we forward to the Google Form. There's no
    // site to deploy in this flow.
    const isCustomPlan =
      stripePlan === 'custom' ||
      stripePlan === 'custom25' ||
      stripePlan === 'custom-booksy' ||
      stripePlan === 'primebarber' ||
      stripePlan === 'primebarber-site';
    if (stripeSessionId && isCustomPlan) {
      window.history.replaceState({}, '', window.location.pathname);
      setAppReady(true);
      fireCustomDesignPixels(stripeSessionId, stripePlan);
      // Whitelist redirect target so an attacker can't open-redirect us.
      const allowed = /^https:\/\/docs\.google\.com\/forms\//i.test(stripeRedirect);
      const target = allowed ? stripeRedirect : 'https://docs.google.com/forms/d/e/1FAIpQLSdS2iaBt6ee0AGWv7pQPSLHoicovQuTOKLFktuiEG4tobBIPw/viewform';
      // Give the pixel beacons ~600ms to leave the wire before navigating.
      setTimeout(() => { window.location.href = target; }, 600);
      return;
    }

    // Handle Stripe return (takes priority)
    if (stripeSessionId) {
      window.history.replaceState({}, '', window.location.pathname);
      setAppReady(true);
      handleStripeReturn(stripeSessionId, stripePlan);
      return;
    }

    // Handle domain payment return
    if (domainPayment === 'success') {
      window.history.replaceState({}, '', window.location.pathname);
      setAppReady(true);
      if (isAuthenticated) {
        persistView('dashboard');
      }
      return;
    }

    // Normal load. Respect whatever the restoration logic already put
    // the user on (editor with an active site, /booksy, etc.) so a
    // page refresh while signed in DOESN'T yank them off their work.
    // Only land on dashboard when they had nothing restored AND they
    // are signed in — i.e. they showed up on the bare home page.
    if (isAuthenticated && state === 'generator' && !activeSite) {
      persistView('dashboard');
    }
    setAppReady(true);
  }, [authLoading, isAuthenticated, isRestoring]);

  // Fires Purchase events for the custom-design plan. Every custom
  // slug is flat $15/mo now; the slug only differentiates analytics
  // attribution. Stripe's session id is the dedup event_id so browser
  // + (any future) server-side CAPI calls line up in Meta/TikTok.
  const fireCustomDesignPixels = (sessionId: string, plan: string) => {
    const PLAN_VALUES: Record<string, number> = {
      'custom-booksy': 19,
      custom: 19,
      custom25: 19,
      primebarber: 29,
      'primebarber-site': 19,
    };
    const value = PLAN_VALUES[plan] ?? 15;
    const currency = 'USD';
    // Resolve content_id + contents[] from the plan slug so advanced
    // matching + Events Manager warnings are addressed in one place.
    const meta = getPlanContentMeta(plan, value);
    const phone = activeSite?.data?.phone || null;
    const { fbc, fbp } = readMetaCookies();
    try {
      window.fbq?.('track', 'Purchase', { value, currency, content_ids: [meta.content_id], content_type: meta.content_type, contents: meta.contents }, { eventID: sessionId });
    } catch (err) {
      console.warn('[FB Pixel Purchase / Custom] fire failed:', err);
    }
    // Pull customer name + address from Stripe so the custom-design
    // Purchase fire reaches the same EMQ tier as the hosting Purchase
    // fire in handleStripeReturn. Fire-and-forget — pixel must not
    // wait on a Stripe round-trip.
    fetch('/api/verify-stripe-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((verify) => {
        const email = verify?.customerEmail || null;
        const ph = verify?.customerPhone || phone;
        const { firstName, lastName } = splitName(verify?.customerName);
        const addr = verify?.customerAddress || {};
        fetch('/api/fb-purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: sessionId,
            value,
            currency,
            eventSourceUrl: window.location.origin,
            clientUserAgent: navigator.userAgent,
            customerEmail: email,
            customerPhone: ph,
            firstName,
            lastName,
            city: addr.city || null,
            state: addr.state || null,
            zip: addr.zip || null,
            country: addr.country || null,
            externalId: sessionId,
            fbc,
            fbp,
            content_id: meta.content_id,
            content_name: meta.content_name,
            content_type: meta.content_type,
            contents: meta.contents,
          }),
          keepalive: true,
        }).catch((err) => console.error('[FB CAPI / Custom] non-blocking:', err));

        fetch('/api/tiktok-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'Purchase',
            event_id: sessionId,
            event_source_url: window.location.origin,
            user_agent: navigator.userAgent,
            value,
            currency,
            email,
            phone: ph,
            external_id: sessionId,
            content_id: meta.content_id,
            content_name: meta.content_name,
            content_type: meta.content_type,
            contents: meta.contents,
          }),
          keepalive: true,
        }).catch((err) => console.error('[TikTok CAPI / Custom] non-blocking:', err));
      })
      .catch((err) => console.warn('[FB/TT Purchase Custom] verify lookup failed (firing without name/addr):', err));

    try {
      (window as any).ttq?.track('Purchase', { value, currency, content_id: meta.content_id, content_type: meta.content_type, contents: meta.contents }, { event_id: sessionId });
    } catch (err) {
      console.warn('[TikTok Pixel Purchase / Custom] fire failed:', err);
    }
  };

  const handleStripeReturn = async (sessionId: string, plan: string = 'monthly') => {
    isLegitDeployRef.current = true;
    setState('deploying');
    setDeployCountdown(DEPLOY_TIMER_SECONDS);

    // Read shop name from localStorage for the progress screen
    try {
      const pendingJson = localStorage.getItem('pendingSite');
      if (pendingJson) {
        const pending = JSON.parse(pendingJson);
        setDeployShopName(pending.siteData?.shopName || '');
      }
    } catch { /* ignore parse errors */ }

    // Start the visual countdown timer
    const timerPromise = new Promise<void>((resolve) => {
      let remaining = DEPLOY_TIMER_SECONDS;
      const interval = setInterval(() => {
        remaining -= 1;
        setDeployCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });

    // Run the actual deployment concurrently
    const deployPromise = (async () => {
      try {
        // Primary: localStorage (set by preparePendingSite before
        // Stripe modal opened). Fallback: server-side recovery from
        // GCS, keyed by the Stripe session's metadata.siteId. The
        // fallback rescues the deploy when the visitor returns from
        // Stripe in a different browser / incognito / cleared cache —
        // the exact case that produced the "PUBLISHING FAILED" screen
        // while the site had actually deployed fine.
        let pending: any = null;
        try {
          const pendingJson = localStorage.getItem('pendingSite');
          if (pendingJson) pending = JSON.parse(pendingJson);
        } catch { /* private mode etc. — fall through to recovery */ }

        if (!pending) {
          console.warn('[Deploy] localStorage pendingSite missing — recovering from server');
          try {
            const recoverResp = await fetch('/api/recover-pending-site', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            });
            if (recoverResp.ok) {
              const recovered = await recoverResp.json();
              if (recovered?.ok && recovered?.data) {
                pending = recovered.data;
                console.log('[Deploy] Recovered pendingSite from server');
              }
            }
          } catch (recoverErr) {
            console.warn('[Deploy] Recovery fetch failed:', recoverErr);
          }
        }

        if (!pending) {
          throw new Error('We could not find your site data. Please contact support — your payment is safe and we can finish publishing manually.');
        }
        const { siteId, siteData, imageUrlMap, existingSiteId } = pending as {
          siteId: string;
          siteData: WebsiteData;
          imageUrlMap: Record<string, string>;
          // Optional. The publish flow now passes the existing draft's
          // UUID through so we can mutate that record in place instead
          // of orphaning it with a new randomUUID. Falls back to siteId
          // (the slug) for older pendingSite payloads written before
          // this fix landed.
          existingSiteId?: string | null;
        };

        // Step 1: Verify payment
        const verifyResponse = await fetch('/api/verify-stripe-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });

        const verifyResult = await verifyResponse.json();
        if (!verifyResult.verified) {
          throw new Error(`Payment not verified: ${verifyResult.reason || 'Unknown error'}`);
        }

        console.log('[Deploy] Payment verified, deploying site...');

        // Step 1.5: Fire Purchase pixel BEFORE deploy. Payment is
        // verified at this point — the customer was charged. If the
        // deploy step below fails (Vercel timeout, missing data, etc.)
        // we still want Meta/TikTok to see the conversion. Otherwise
        // ad attribution silently drops on every failed publish.
        const purchaseValue = typeof verifyResult.amountTotal === 'number' ? verifyResult.amountTotal : 10.0;
        const purchaseCurrency = verifyResult.currency || 'USD';
        const purchaseMeta = getPlanContentMeta(plan || 'monthly', purchaseValue);
        // Stripe gives us name + address from the Checkout form. We
        // hash & forward each field server-side so Event Match Quality
        // moves from em-only (5/10) to em+ph+fn+ln+ct+st+zp+country+
        // external_id+fbc+fbp (9–10/10).
        const purchasePhone = verifyResult.customerPhone || siteData?.phone || null;
        const purchaseEmail = verifyResult.customerEmail || null;
        // Lock the post-deploy signup to the email that just paid. This
        // guarantees the new account's email == the Stripe customer
        // email, which is what makes BOTH the same-session upsert and the
        // email-based recovery/self-heal reliable (recover-site searches
        // Stripe by customer_email). Without this, a customer who pays
        // with email X but signs up with email Y is orphaned.
        if (purchaseEmail) setRecoveryEmail(purchaseEmail);
        const { firstName: purchaseFirstName, lastName: purchaseLastName } = splitName(verifyResult.customerName);
        const purchaseAddr = verifyResult.customerAddress || {};
        const { fbc: purchaseFbc, fbp: purchaseFbp } = readMetaCookies();

        try {
          window.fbq?.(
            'track',
            'Purchase',
            { value: purchaseValue, currency: purchaseCurrency, content_ids: [purchaseMeta.content_id], content_type: purchaseMeta.content_type, contents: purchaseMeta.contents },
            { eventID: sessionId }
          );
        } catch (err) {
          console.warn('[FB Pixel Purchase] browser fire failed:', err);
        }

        fetch('/api/fb-purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: sessionId,
            value: purchaseValue,
            currency: purchaseCurrency,
            customerEmail: purchaseEmail,
            customerPhone: purchasePhone,
            firstName: purchaseFirstName,
            lastName: purchaseLastName,
            city: purchaseAddr.city || null,
            state: purchaseAddr.state || null,
            zip: purchaseAddr.zip || null,
            country: purchaseAddr.country || null,
            externalId: sessionId,
            fbc: purchaseFbc,
            fbp: purchaseFbp,
            eventSourceUrl: window.location.origin,
            clientUserAgent: navigator.userAgent,
            content_id: purchaseMeta.content_id,
            content_name: purchaseMeta.content_name,
            content_type: purchaseMeta.content_type,
            contents: purchaseMeta.contents,
          }),
          keepalive: true,
        }).catch((err) => console.error('[FB CAPI Purchase] Error (non-blocking):', err));

        try {
          (window as any).ttq?.track(
            'Purchase',
            { value: purchaseValue, currency: purchaseCurrency, content_id: purchaseMeta.content_id, content_type: purchaseMeta.content_type, contents: purchaseMeta.contents },
            { event_id: sessionId }
          );
        } catch (err) {
          console.warn('[TikTok Pixel Purchase] browser fire failed:', err);
        }
        fetch('/api/tiktok-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'Purchase',
            event_id: sessionId,
            event_source_url: window.location.origin,
            user_agent: navigator.userAgent,
            value: purchaseValue,
            currency: purchaseCurrency,
            email: purchaseEmail,
            phone: purchasePhone,
            external_id: sessionId,
            content_id: purchaseMeta.content_id,
            content_name: purchaseMeta.content_name,
            content_type: purchaseMeta.content_type,
            contents: purchaseMeta.contents,
          }),
          keepalive: true,
        }).catch((err) => console.error('[TikTok CAPI Purchase] Error (non-blocking):', err));

        // Step 2: Generate HTML with placeholders
        const restoredSiteData: WebsiteData = {
          ...siteData,
          hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] ? 'has-image' : '' },
          about: { ...siteData.about, imageUrl: imageUrlMap['about'] ? 'has-image' : '' },
          gallery: siteData.gallery.map((_: string, i: number) =>
            imageUrlMap[`gallery${i}`] ? 'has-image' : ''
          ),
          staff: (siteData.staff || []).map((s, i) => ({
            ...s,
            photo: imageUrlMap[`staff${i}`] ? 'has-image' : '',
          })),
        };

        const html = await generateHTMLForTemplate(restoredSiteData);

        // Step 3: Deploy to Vercel
        const deployResponse = await fetch('/api/deploy-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId, html, imageUrls: imageUrlMap }),
        });

        const contentType = deployResponse.headers.get('content-type');
        let deployData;
        if (contentType && contentType.includes('application/json')) {
          deployData = await deployResponse.json();
        } else {
          const text = await deployResponse.text();
          throw new Error(`Deployment failed: ${text || `HTTP ${deployResponse.status}`}`);
        }

        if (!deployResponse.ok) {
          throw new Error(`Deployment failed: ${deployData.error || deployData.details || 'Unknown error'}`);
        }

        console.log('[Deploy] Site deployed:', deployData.deploymentUrl);

        // Step 4: Create SiteInstance and save to IndexedDB
        // Restore the full image URLs back into siteData for the SiteInstance.
        // Without restoring craftImages here, the dashboard would re-open
        // with <img src="uploaded"> placeholders for the Craft section.
        const fullSiteData: WebsiteData = {
          ...siteData,
          hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] || siteData.hero.imageUrl || '' },
          about: { ...siteData.about, imageUrl: imageUrlMap['about'] || siteData.about.imageUrl || '' },
          gallery: siteData.gallery.map((_: string, i: number) =>
            imageUrlMap[`gallery${i}`] || ''
          ),
          craftImages: (siteData.craftImages || []).map((_: string, i: number) =>
            imageUrlMap[`craft${i}`] || ''
          ),
          // Staff: restore real photo URLs from imageUrlMap (uploaded
          // ones) or carry over the existing URL (hotlinked Booksy CDN).
          // Without this, dashboard re-open would show <img src="uploaded">.
          staff: (siteData.staff || []).map((s, i) => ({
            ...s,
            photo: imageUrlMap[`staff${i}`] || s.photo || '',
          })),
        };

        // Reuse the existing draft's UUID so saveSite overwrites that
        // record instead of creating a parallel one. Without this the
        // user ends up with two records in IndexedDB (draft + deployed)
        // and the dashboard surfaces the draft, which has no GCS image
        // URLs — that's why Edit My Website opened an empty page and
        // status read "Draft" even though the site was live.
        const newSite: SiteInstance = {
          // Reuse the draft's id only when it's a real UUID; never fall
          // back to the slug (siteId) — that breaks the Supabase upsert.
          id: ensureUuid(existingSiteId),
          data: fullSiteData,
          lastSaved: Date.now(),
          formInputs: { shopName: siteData.shopName, area: siteData.area, phone: siteData.phone },
          deployedUrl: deployData.deploymentUrl,
          deploymentStatus: 'deployed',
          customDomain: null,
          domainOrderId: null,
        };

        // ALL operations below this point are post-deploy success —
        // the site IS published, the URL exists. We must NEVER surface
        // "Publishing Failed" because of an IndexedDB / localStorage /
        // setState side-effect failing (private browsing, storage quota,
        // etc). Wrap them so any throw is logged but the deploy result
        // still flows through to the success UI.
        try {
          await saveSite(newSite);
        } catch (saveErr) {
          console.warn('[Deploy] saveSite failed (non-fatal, site is still live):', saveErr);
        }
        try {
          setActiveSite(newSite);
        } catch (setErr) {
          console.warn('[Deploy] setActiveSite failed (non-fatal):', setErr);
        }
        try {
          localStorage.removeItem('pendingSite');
        } catch { /* ignore — private mode etc. */ }
        // Best-effort server-side cleanup of the recovery copy. Doesn't
        // block the success UI.
        fetch('/api/save-pending-site', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId }),
          keepalive: true,
        }).catch(() => { /* ignore */ });
        return { url: deployData.deploymentUrl } as { url?: string; error?: string };

      } catch (error: any) {
        console.error('[Deploy] Error:', error);
        return { error: error.message || 'Deployment failed' } as { url?: string; error?: string };
      }
    })();

    // Wait for BOTH timer and deployment to finish before showing result
    const [result] = await Promise.all([deployPromise, timerPromise]);
    setDeployResult(result);

    // After successful deployment, show the post-deployment modal
    // for unauthenticated visitors (it prompts them to create an
    // account so the site lands in a dashboard). Authenticated users
    // skip the modal — they already have a dashboard — and fall
    // through to the "YOUR SITE IS LIVE" success screen rendered
    // when !showPostDeployModal && deployResult.url. Without this
    // guard, authenticated users got a blank screen after deploy
    // (modal blocked by !isAuthenticated, success screen blocked
    // by !showPostDeployModal).
    if (result.url && !isAuthenticated) {
      setShowPostDeployModal(true);
    }
  };

  // The optional `prebuilt` arg lets the /booksy form skip the
  // generateContent() template call — the Apify scraper has already
  // produced a complete WebsiteData payload from the real Booksy page.
  const handleGenerate = async (inputs: ShopInputs, prebuilt?: WebsiteData) => {
    // Fire the lead ONLY when this is a real completion — a booking link,
    // or both service area + phone filled (the full /booksy, /free-barber
    // and /new forms always are). The homepage name-only submit defers:
    // its lead fires later from the booking-link / area+phone prompts.
    // fireLead() handles all dedup (CRM once/session, Meta+TikTok 90 days).
    if (isLeadComplete(inputs)) fireLead(inputs);

    sessionStorage.setItem('pendingFormInputs', JSON.stringify(inputs));
    setState('loading');
    try {
      const data = prebuilt ?? await generateContent(inputs);
      setGeneratedData(data);

      // Persist a draft SiteInstance to IndexedDB so refresh, navigate-away,
      // and back-from-Stripe restore the generated site instead of dropping
      // the user back to the form. Marked 'draft' until publish completes.
      const draftSite: SiteInstance = {
        id: crypto.randomUUID(),
        data,
        lastSaved: Date.now(),
        formInputs: inputs,
        deployedUrl: null,
        deploymentStatus: 'draft',
        customDomain: null,
        domainOrderId: null,
      };
      await saveSite(draftSite);
      setActiveSite(draftSite);
      persistView('editor', draftSite.id);
      sessionStorage.removeItem('pendingFormInputs');
      // Show the "how it works" guide after generation on every generator
      // entry — homepage, /booksy, /free-barber. The homepage now uses the
      // full multi-field form (reverted from the name-only progressive
      // funnel), so it shows the guide directly like the others.
      setShowLaunchGuide(true);
      if (cameFromNewRef.current) {
        cameFromNewRef.current = false;
      }
    } catch (error: any) {
      if (document.hidden && sessionStorage.getItem('pendingFormInputs')) {
        generationFailedRef.current = true;
        return;
      }
      console.error("Website generation failed:", error);
      alert(`Generation Error: ${error.message || "An unexpected error occurred. Please try again."}`);
      persistView('generator');
    }
  };

  // Update the live editor data AND the persisted draft together so a
  // mid-prompt refresh or checkout uses the latest content.
  const applyGeneratedData = (data: WebsiteData) => {
    setGeneratedData(data);
    setActiveSite((prev) => {
      if (!prev) return prev;
      const updated: SiteInstance = {
        ...prev,
        data,
        formInputs: { shopName: data.shopName, area: data.area, phone: data.phone },
        lastSaved: Date.now(),
      };
      saveSite(updated).catch(() => {});
      return updated;
    });
  };

  // Homepage prompt — live preview as the visitor types area / phone.
  const handleHomePromptChange = (field: 'area' | 'phone', value: string) => {
    setGeneratedData((prev) => {
      if (!prev) return prev;
      if (field === 'area') return { ...prev, area: value, contact: { ...prev.contact, address: value } };
      return { ...prev, phone: value };
    });
  };

  // Homepage prompt — "Generate" with a booking link: scrape the real
  // listing and rebuild the site (services / photos / reviews / hours),
  // preserving the typed name + chosen theme. Returns false on failure
  // so the prompt falls back to the area/phone step.
  const handleHomePromptBookingLink = async (link: string): Promise<boolean> => {
    const current = generatedData;
    if (!current) return false;
    // Mirror the proven /booksy + homepage auto-scrape path exactly:
    // normalize the pasted text to a URL, confirm it's a supported
    // booking host (Booksy / Fresha / Square / Vagaro / StyleSeat),
    // then scrape + rebuild from the real listing.
    const normalizedUrl = extractFirstUrl(link) ?? undefined;
    if (!normalizedUrl || !isSupportedBookingHost(normalizedUrl)) return false;
    try {
      const resp = await fetch('/api/import-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl }),
      });
      const scrapeData = await resp.json();
      if (!resp.ok) throw new Error(scrapeData?.error || 'Scrape failed');
      const built = buildSiteFromScrape(scrapeData, normalizedUrl, {
        // Keep the name the visitor typed; let the scrape fill area /
        // phone / services / photos / reviews / hours.
        manual: { shopName: current.shopName, area: '', phone: '', bookingUrl: normalizedUrl, colorTheme: current.colorTheme },
        template: current.template === 'euphoria' ? 'euphoria' : 'luxe',
      });
      if (!built?.scraped?.shopName) return false;
      // Keep the homepage look — carry the chosen theme through.
      const rebuilt: WebsiteData = { ...built.scraped, colorTheme: current.colorTheme };
      applyGeneratedData(rebuilt);
      // Booking link submitted on the homepage prompt → completion.
      fireLead({ shopName: rebuilt.shopName, area: rebuilt.area, phone: rebuilt.phone, bookingUrl: normalizedUrl });
      return true;
    } catch (err) {
      console.warn('[home funnel] booking-link scrape failed:', err);
      return false;
    }
  };

  // Homepage prompt — "Finish generating" with area + phone: re-run the
  // template generation so the copy bakes in the real service area.
  const handleHomePromptFinish = async (area: string, phone: string) => {
    const current = generatedData;
    if (!current) return;
    // Area + phone completed on the homepage prompt → completion.
    fireLead({ shopName: current.shopName, area, phone, bookingUrl: current.bookingUrl });
    try {
      const data = await generateContent({
        shopName: current.shopName,
        area,
        phone,
        template: current.template,
        colorTheme: current.colorTheme,
        bookingUrl: current.bookingUrl,
      });
      applyGeneratedData(data);
    } catch {
      applyGeneratedData({ ...current, area, phone, contact: { ...current.contact, address: area } });
    }
  };

  const handleBack = () => {
    // Auth-aware: signed-in users go back to their dashboard (where
    // their drafts + deployed sites live). Anonymous users go back
    // to the home form. Was always sending everyone to the home page
    // — even users who had just generated a site while logged in.
    setShowHomePrompts(false);
    setShowLaunchGuide(false);
    setGeneratedData(null);
    setActiveSite(null);
    persistView(isAuthenticated ? 'dashboard' : 'generator');
  };

  const handleEditSite = (site: SiteInstance) => {
    setShowHomePrompts(false);
    setShowLaunchGuide(false);
    setActiveSite(site);
    setGeneratedData(site.data);
    persistView('editor');
  };

  const handleNavigateDashboard = () => {
    persistView('dashboard');
  };

  const handleSignOut = async () => {
    await signOut();
    setActiveSite(null);
    setGeneratedData(null);
    setDeployResult(null);
    persistView('generator');
  };

  const handleCreateAccount = () => {
    setShowPostDeployModal(false);
    setAuthModalMode('signup');
    // recoveryEmail was set to the Stripe customer email in
    // handleStripeReturn. Lock the field so the account is created under
    // that exact email — the precondition for the site to stay attached.
    setLockSignupEmail(true);
    setShowAuthModal(true);
  };

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);

    // Auto-migrate the current site to Supabase. Read the user fresh
    // from Supabase — the `user` React state lags the auth listener,
    // so right after a signup `user` is still null and the upsert
    // would silently skip, leaving the dashboard preview blank because
    // fetchUserSites returned []. Wait briefly for the auth state to
    // settle and retry up to 3x so an authoritative session is always
    // resolved before we write site_data.
    let authedUser = user;
    if (!authedUser) {
      try {
        const { supabase } = await import('./lib/supabase');
        for (let i = 0; i < 3; i++) {
          const { data } = await supabase.auth.getUser();
          if (data?.user) { authedUser = data.user as any; break; }
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (err) {
        console.warn('[Auth] getUser lookup failed:', err);
      }
    }

    setLockSignupEmail(false);

    if (activeSite && authedUser) {
      // Guarantee a UUID id before writing — a slug here makes the
      // upsert throw on the UUID column and silently orphan the site.
      const siteToAttach = { ...activeSite, id: ensureUuid(activeSite.id) };
      // Retry the attach a couple of times — a transient failure here is
      // the difference between the customer owning their paid site or
      // seeing "No sites yet". The dashboard self-heal (recover-site by
      // email) is the final backstop if every attempt still fails.
      let attached = false;
      for (let i = 0; i < 3 && !attached; i++) {
        try {
          await upsertSiteToSupabase(siteToAttach, authedUser.id);
          attached = true;
          if (siteToAttach.id !== activeSite.id) setActiveSite(siteToAttach);
          console.log('[Migration] Site attached to Supabase for user', authedUser.id);
        } catch (err) {
          console.error(`[Migration] Attach attempt ${i + 1} failed:`, err);
          if (i < 2) await new Promise(r => setTimeout(r, 600));
        }
      }
      if (!attached) {
        console.error('[Migration] All attach attempts failed — dashboard self-heal will retry by email.');
      }
    } else if (!authedUser) {
      console.warn('[Migration] Skipped — could not resolve authenticated user after signup');
    }

    // CompleteRegistration pixel + CAPI fire. Closes the conversion
    // funnel (ViewContent → Lead → InitiateCheckout → Purchase →
    // CompleteRegistration). Same event_id browser-side + server-side
    // so TikTok + Meta dedupe.
    try {
      const eventId =
        typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `reg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const email = user?.email || activeSite?.data?.email || null;
      const phone = activeSite?.data?.phone || null;
      const url = window.location.href;
      const ua = navigator.userAgent;
      const { fbc: regFbc, fbp: regFbp } = readMetaCookies();
      // Use the auth user id (already opaque + stable per visitor) as
      // external_id so Meta can match this registration back to the
      // visitor's other lifecycle events.
      const externalId = (authedUser?.id as string | undefined) || eventId;
      try { window.fbq?.('track', 'CompleteRegistration', {}, { eventID: eventId }); } catch {}
      try { (window as any).ttq?.track('CompleteRegistration', {}, { event_id: eventId }); } catch {}
      fetch('/api/fb-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, eventSourceUrl: url, clientUserAgent: ua, email, phone, externalId, fbc: regFbc, fbp: regFbp }),
        keepalive: true,
      }).catch(() => { /* non-blocking */ });
      fetch('/api/tiktok-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'CompleteRegistration', event_id: eventId, event_source_url: url, user_agent: ua, email, phone, external_id: externalId }),
        keepalive: true,
      }).catch(() => { /* non-blocking */ });
    } catch (err) {
      console.warn('[CompleteRegistration] fire failed (non-blocking):', err);
    }

    persistView('dashboard');
    setDeployResult(null);
  };

  const handleSkipAccountCreation = () => {
    setShowPostDeployModal(false);
    // Stay on deploying view showing the success state — user can click "Create Another Site" or just leave
  };

  // /recover entry — the visitor enters their email or Stripe
  // session ID on the RecoverPage, the server pulls their site data
  // out of the GCS pending-site backup, and this handler hydrates
  // activeSite so the very next signup writes a Supabase sites row
  // that's linked to their deployed Vercel URL. No new server-side
  // admin code needed: existing handleAuthSuccess does the upsert.
  const [recoveryEmail, setRecoveryEmail] = useState<string | undefined>(undefined);
  // When true, the AuthModal email field is read-only (post-payment
  // signup — locked to the Stripe customer email).
  const [lockSignupEmail, setLockSignupEmail] = useState(false);
  const handleRecoveredSite = (site: SiteInstance, customerEmail: string | null) => {
    setActiveSite(site);
    setDeployResult({ url: site.deployedUrl || undefined });
    setRecoveryEmail(customerEmail || undefined);
    setAuthModalMode('signup');
    setAuthSignInOnly(false);
    setShowAuthModal(true);
  };

  // /primebarber is a standalone marketing page — no generator state,
  // no editor, no dashboard. Render it as early as possible so the
  // auth/restore overhead doesn't block first paint of the landing.
  if (isPrimeBarberPath()) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#0d0d0d]" />}>
        <PrimeBarberLanding />
      </Suspense>
    );
  }

  // /own-brand — standalone static demo barbershop site (Euphoria
  // visual shell + booking calendar, product store, reviews, FAQ,
  // Google Maps). Rendered early like /primebarber so none of the
  // generator/auth/restore machinery runs. Single CTA → homepage.
  if (isOwnBrandPath()) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-black" />}>
        <OwnBrandLanding />
      </Suspense>
    );
  }

  // /recover is a standalone page that customers reach AFTER seeing
  // "Publishing Failed" while their site is in fact live on Vercel.
  // Rendered early like /primebarber so the visitor can land on it
  // without any generator/auth restoration getting in the way.
  if (isRecoverPath()) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
        <RecoverPage onRecovered={handleRecoveredSite} />
        <Suspense fallback={null}>
          <AuthModal
            isOpen={showAuthModal}
            onClose={() => { setShowAuthModal(false); setRecoveryEmail(undefined); }}
            initialMode={authModalMode}
            initialEmail={recoveryEmail}
            onSuccess={handleAuthSuccess}
          />
        </Suspense>
      </Suspense>
    );
  }

  if (isGenerateBarbershopPath()) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GenerateBarbershopFunnel />
      </Suspense>
    );
  }

  // /generate — "Customize Your Barbershop Site". A barber site is
  // generated immediately and shown behind a centered overlay that asks
  // "Do you have a booking link?" (Yes → paste any booking link; No →
  // name + service area + phone). Rendered early like the other
  // standalone funnels so the normal restore machinery doesn't block it.
  if (isGeneratePath()) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GeneratePage />
      </Suspense>
    );
  }

  // /booksy — same instant-preview + customize-overlay flow as /generate,
  // but Booksy-flavored: an AI-generated barber site renders immediately
  // and the overlay leads with "Add your Booksy link". Booksy pricing
  // ($10/mo · $49/yr) + analytics are auto-applied by isBooksyPath()
  // inside the renderer's PrePaymentBanner. Rendered early like /generate
  // so the form/restore machinery is bypassed.
  if (isBooksyPath()) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <GeneratePage variant="booksy" />
      </Suspense>
    );
  }

  // /admin-generate — operator-only white-glove flow for off-platform
  // paid customers. Renders early like the other standalone paths so
  // none of the normal generator/auth restoration machinery runs.
  if (isAdminGeneratePath()) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AdminGenerator />
      </Suspense>
    );
  }

  // Don't render until auth state is determined
  if (!appReady || isRestoring) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#f4a100] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
    <Suspense fallback={null}>
      {state === 'generator' && (
        // Homepage, /booksy, AND /free-barber all render the same
        // GeneratorForm — identical visual shell. On the root "/" the
        // form runs name-only (collects just the barbershop name; the
        // booking link / area + phone are gathered by HomeBookingPrompts
        // after the site generates). /booksy and /free-barber keep their
        // full layouts unchanged.
        <GeneratorForm
          onGenerate={(inputs, scraped) => handleGenerate(inputs, scraped)}
          onSignIn={() => { setAuthModalMode('signin'); setAuthSignInOnly(true); setShowAuthModal(true); }}
        />
      )}
      {state === 'loading' && <LoadingScreen />}
      {state === 'editor' && generatedData && (
        <>
          {generatedData.template === 'euphoria' ? (
            <EuphoriaWebsite
              data={generatedData}
              onBack={handleBack}
              site={activeSite ?? undefined}
              onNavigateDashboard={handleNavigateDashboard}
              isPostPayment={!!activeSite?.deployedUrl || activeSite?.deploymentStatus === 'deployed'}
              userId={user?.id ?? null}
              onCheckoutFlowChange={setIsCheckoutFlowOpen}
            />
          ) : (
            <GeneratedWebsite
              data={generatedData}
              onBack={handleBack}
              site={activeSite ?? undefined}
              onNavigateDashboard={handleNavigateDashboard}
              isPostPayment={!!activeSite?.deployedUrl || activeSite?.deploymentStatus === 'deployed'}
              userId={user?.id ?? null}
              onCheckoutFlowChange={setIsCheckoutFlowOpen}
            />
          )}
          {/* Homepage progressive prompt — only for a fresh root "/"
              name-only generation, hidden while checkout is open and
              never over an already-deployed (post-payment) site. */}
          {isRootHomePath() && showHomePrompts && !isCheckoutFlowOpen &&
            !(activeSite?.deployedUrl || activeSite?.deploymentStatus === 'deployed') && (
            <HomeBookingPrompts
              onAreaPhoneChange={handleHomePromptChange}
              onSubmitBookingLink={handleHomePromptBookingLink}
              onFinish={handleHomePromptFinish}
              onComplete={() => { setShowHomePrompts(false); setShowLaunchGuide(true); }}
              initialArea={generatedData.area || ''}
              initialPhone={generatedData.phone || ''}
            />
          )}
          {/* "How it works" guide — shown once after generation on the
              homepage AND the other generator subpages (/booksy,
              /free-barber). Hidden during checkout / over a deployed site;
              on root it waits for the booking prompt to finish. */}
          {showLaunchGuide && !showHomePrompts && !isCheckoutFlowOpen &&
            !(activeSite?.deployedUrl || activeSite?.deploymentStatus === 'deployed') && (
            <HomeLaunchGuide onClose={() => setShowLaunchGuide(false)} />
          )}
        </>
      )}
      {state === 'dashboard' && (
        <ManagementDashboard
          onEditSite={handleEditSite}
          onCreateNewSite={() => persistView('generator')}
          onSignOut={handleSignOut}
        />
      )}
      {state === 'deploying' && (
        <div className="fixed inset-0 bg-[#0d0d0d] flex flex-col items-center justify-center z-[100] px-6">
          {!deployResult && (
            <>
              <div className="mb-6">
                <svg className="w-14 h-14 text-[#f4a100] animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              {deployShopName && (
                <p className="text-[#f4a100] text-xs font-bold tracking-[5px] uppercase mb-3">{deployShopName}</p>
              )}
              <h2 className="text-2xl font-montserrat font-black uppercase tracking-[4px] mb-3 text-center">
                DEPLOYING YOUR <span className="text-[#f4a100]">SITE</span>
              </h2>
              <p className="text-[#888888] text-sm mb-8 text-center">
                Your website is being created...
              </p>
              <div className="text-5xl font-montserrat font-black text-[#f4a100] mb-6 tabular-nums">
                {deployCountdown}<span className="text-lg text-[#666666] ml-2">s</span>
              </div>
              <div className="w-64 md:w-80 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#f4a100] rounded-full transition-none"
                  style={{
                    width: `${((DEPLOY_TIMER_SECONDS - deployCountdown) / DEPLOY_TIMER_SECONDS) * 100}%`,
                    transition: 'width 1s linear',
                  }}
                />
              </div>
              {/* Hard warning. The deploy runs client-side during this
                  countdown — visitors who close the tab here have lost
                  their site multiple times. Red border + bold copy
                  makes it impossible to miss. */}
              <div
                role="alert"
                className="mt-8 w-full max-w-md rounded-xl border-2 px-5 py-4 text-center"
                style={{
                  borderColor: '#ef4444',
                  background: 'linear-gradient(180deg, rgba(239,68,68,0.18), rgba(239,68,68,0.08))',
                  boxShadow: '0 0 0 1px rgba(239,68,68,0.35), 0 8px 28px -10px rgba(239,68,68,0.55)',
                }}
              >
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-red-400">
                  ⚠ Important
                </p>
                <p className="mt-2 text-[13px] font-bold leading-snug text-red-100 md:text-[14px]">
                  Please do not move away from this page or your website won't be generated.
                </p>
              </div>
            </>
          )}

          {deployResult?.url && !showPostDeployModal && (
            <>
              <div className="mb-8">
                <svg className="w-20 h-20 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-montserrat font-black uppercase tracking-[4px] mb-4 text-center">
                YOUR SITE IS <span className="text-[#f4a100]">LIVE!</span>
              </h2>
              <p className="text-[#cccccc] text-sm mb-6 text-center max-w-md">
                Your barbershop website has been published and is now live on the web.
              </p>
              <div className="flex items-center gap-3 bg-[#1a1a1a] border border-white/10 rounded px-4 py-3 mb-8 max-w-md w-full">
                <span className="text-[#f4a100] text-sm font-mono truncate">{deployResult.url}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(deployResult.url!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 text-[#888] hover:text-white transition-colors"
                  title="Copy URL"
                >
                  {copied ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/>
                    </svg>
                  )}
                </button>
              </div>
              <a
                href={deployResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block py-4 px-12 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black tracking-[3px] uppercase hover:bg-white transition-colors duration-300 shadow-lg text-sm mb-4"
              >
                VIEW YOUR SITE
              </a>
              <button
                onClick={() => { persistView('generator'); setDeployResult(null); }}
                className="text-[#666666] text-xs uppercase tracking-[2px] hover:text-white transition-colors mt-4"
              >
                Create Another Site
              </button>
            </>
          )}

          {deployResult?.error && (
            <>
              <div className="mb-8">
                <svg className="w-20 h-20 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-montserrat font-black uppercase tracking-[4px] mb-4 text-center">
                PUBLISHING <span className="text-red-500">FAILED</span>
              </h2>
              <p className="text-red-400 text-sm mb-8 text-center max-w-md">
                {deployResult.error}
              </p>
              <button
                onClick={() => { persistView('generator'); setDeployResult(null); }}
                className="inline-block py-4 px-12 border-2 border-[#f4a100] text-[#f4a100] font-montserrat font-black tracking-[3px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 text-sm"
              >
                GO BACK
              </button>
            </>
          )}
        </div>
      )}

      {/* Post-deployment success modal (for unauthenticated users) */}
      {showPostDeployModal && deployResult?.url && !isAuthenticated && (
        <PostDeploymentModal
          deployedUrl={deployResult.url}
          onCreateAccount={handleCreateAccount}
          onSkip={handleSkipAccountCreation}
        />
      )}

      {/* Auth modal */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => { setShowAuthModal(false); setAuthSignInOnly(false); setRecoveryEmail(undefined); setLockSignupEmail(false); }}
        initialMode={authModalMode}
        initialEmail={recoveryEmail}
        lockEmail={lockSignupEmail}
        signInOnly={authSignInOnly}
        onSuccess={handleAuthSuccess}
      />

      {/* /new post-generation intro modal — mirrors the "Your site is
          fully editable" tour from PrimeHub /barber. Fires once after
          the editor mounts when the visitor came through /new. */}
      {showEditorIntro && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 md:p-6"
          role="dialog"
          aria-modal="true"
          style={{
            background: 'rgba(5, 7, 10, 0.78)',
            backdropFilter: 'blur(14px) saturate(140%)',
            WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          }}
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-[20px] p-7 md:p-8"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015) 60%, rgba(255,255,255,0.01))',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(28px) saturate(180%)',
              WebkitBackdropFilter: 'blur(28px) saturate(180%)',
              boxShadow:
                '0 40px 120px -20px rgba(0,0,0,0.75),' +
                '0 12px 40px -12px rgba(0,0,0,0.5),' +
                'inset 0 1px 0 0 rgba(255,255,255,0.08),' +
                '0 0 0 1px rgba(244,161,0,0.10)',
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-32"
              style={{ background: 'radial-gradient(60% 100% at 50% 0%, rgba(244,161,0,0.20), transparent 70%)' }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 right-12 top-[44px] h-px"
              style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.12), transparent)' }}
            />

            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowEditorIntro(false)}
              className="absolute right-3.5 top-3.5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/55 transition hover:border-white/30 hover:bg-white/[0.06] hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>

            {/* Local keyframes for the flashing IMPORTANT pill. Stronger
                than Tailwind's animate-pulse (which only fades opacity);
                this also blinks color so the eye locks onto it. */}
            <style>{`
              @keyframes editorIntroImportantFlash {
                0%, 100% { color: #ef4444; opacity: 1; }
                50% { color: #ffffff; opacity: 0.55; }
              }
            `}</style>
            <p
              className="relative mb-1 text-[10px] font-bold uppercase tracking-[0.34em]"
              style={{
                color: '#ef4444',
                animation: 'editorIntroImportantFlash 0.9s ease-in-out infinite',
              }}
            >
              Important
            </p>
            <h2
              className="relative mb-1 leading-[1.08] text-white"
              style={{ fontSize: '1.7rem', letterSpacing: '-0.02em', fontWeight: 600, fontFamily: '"Manrope", "Inter", sans-serif' }}
            >
              Your site is{' '}
              <span
                className="italic"
                style={{
                  fontFamily: '"Instrument Serif", "Times New Roman", serif',
                  fontWeight: 400,
                  color: '#f4a100',
                  letterSpacing: '-0.015em',
                }}
              >
                fully editable.
              </span>
            </h2>
            <p
              className="relative mb-6 italic text-white/55"
              style={{ fontFamily: '"Instrument Serif", "Times New Roman", serif', fontSize: '14px' }}
            >
              Here's how to make it yours.
            </p>

            <ul className="relative space-y-3.5 text-[13.5px] leading-relaxed text-white/85 md:text-[14px]" style={{ fontFamily: '"Manrope", "Inter", sans-serif' }}>
              {[
                { text: 'Tap any text or image to edit.', bold: false },
                { text: 'Click Launch Site below to get your URL.', bold: false },
                { text: 'Create an account afterward — your site stays saved so you can edit text or images anytime.', bold: true },
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    className="mt-[8px] inline-block h-[2px] w-3 shrink-0 rounded-full"
                    style={{ background: '#f4a100', opacity: 0.85 }}
                  />
                  <span className={item.bold ? 'font-semibold text-white' : ''}>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setShowEditorIntro(false)}
              className="relative mt-7 w-full overflow-hidden rounded-full py-3 text-[12px] font-bold uppercase tracking-[0.22em] text-black transition active:scale-[0.985] md:text-[13px]"
              style={{
                background: 'linear-gradient(180deg, #ffffff 0%, #f1f1f3 100%)',
                boxShadow:
                  '0 8px 24px -6px rgba(0,0,0,0.5),' +
                  'inset 0 1px 0 0 rgba(255,255,255,0.9),' +
                  '0 0 0 1px rgba(244,161,0,0.26)',
                fontFamily: '"Manrope", "Inter", sans-serif',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </Suspense>
    </div>
  );
};

export default App;
