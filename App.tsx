import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, ShopInputs, WebsiteData, SiteInstance } from './types.ts';

// Meta Pixel global (loaded in index.html). `fbq` is added to window at runtime.
declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
  }
}

import { GeneratorForm } from './components/GeneratorForm.tsx';
import { BooksyGeneratorForm } from './components/BooksyGeneratorForm.tsx';
import { NewLeadQuizForm } from './components/NewLeadQuizForm.tsx';
import { isBooksyPath } from './lib/dealMode.ts';
// /new subpage detection — premium multi-step quiz funnel mirroring
// PrimeHub /barber. Same downstream pipeline as the homepage form,
// just a different presentation + a post-generation intro modal.
const isNewLeadPath = (): boolean => {
  if (typeof window === 'undefined') return false;
  const p = window.location.pathname.replace(/\/+$/, '');
  return p === '/new' || p.startsWith('/new/');
};
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { GeneratedWebsite } from './components/GeneratedWebsite.tsx';
import { EuphoriaWebsite } from './components/EuphoriaWebsite.tsx';
import { generateHTMLForTemplate } from './services/templateRenderer.ts';
import { generateContent } from './services/geminiService.ts';
import { captureLead } from './services/leadCaptureService.ts';
import { useAuth } from './contexts/AuthContext.tsx';
import { saveSite, getSite } from './services/indexedDBService.ts';
import { upsertSiteToSupabase, fetchUserSites } from './services/supabaseDataService.ts';
import { getAllSites as getAllLocalSites } from './services/indexedDBService.ts';
import { PostDeploymentModal } from './components/PostDeploymentModal.tsx';
import { ManagementDashboard } from './components/ManagementDashboard.tsx';
import { AuthModal } from './components/AuthModal.tsx';

const DEPLOY_TIMER_SECONDS = 5;

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

  // Determine initial view based on auth state
  useEffect(() => {
    if (authLoading || isRestoring) return;

    const params = new URLSearchParams(window.location.search);
    const stripeSessionId = params.get('stripe_session');
    const stripePlan = params.get('plan') || '';
    const stripeRedirect = params.get('redirect') || '';
    const domainPayment = params.get('domain_payment');

    // Custom-design plans (custom, custom25) bounce through the app
    // ONLY so the Purchase pixels can fire — then we forward to the
    // Google Form. There's no site to deploy in this flow.
    const isCustomPlan = stripePlan === 'custom' || stripePlan === 'custom25';
    if (stripeSessionId && isCustomPlan) {
      window.history.replaceState({}, '', window.location.pathname);
      setAppReady(true);
      fireCustomDesignPixels(stripeSessionId);
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
      handleStripeReturn(stripeSessionId);
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

  // Fires Purchase events for the custom-design plan ($19/mo). No
  // verify-stripe-session call here — that endpoint is wired for the
  // deploy flow only. Stripe's session id is the dedup event_id so
  // browser + (any future) server-side CAPI call line up in Meta/TikTok.
  const fireCustomDesignPixels = (sessionId: string) => {
    const value = 19;
    const currency = 'USD';
    try {
      window.fbq?.('track', 'Purchase', { value, currency }, { eventID: sessionId });
    } catch (err) {
      console.warn('[FB Pixel Purchase / Custom] fire failed:', err);
    }
    fetch('/api/fb-purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: sessionId,
        value,
        currency,
        eventSourceUrl: window.location.origin,
        clientUserAgent: navigator.userAgent,
      }),
      keepalive: true,
    }).catch((err) => console.error('[FB CAPI / Custom] non-blocking:', err));

    try {
      (window as any).ttq?.track('Purchase', { value, currency }, { event_id: sessionId });
    } catch (err) {
      console.warn('[TikTok Pixel Purchase / Custom] fire failed:', err);
    }
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
      }),
      keepalive: true,
    }).catch((err) => console.error('[TikTok CAPI / Custom] non-blocking:', err));
  };

  const handleStripeReturn = async (sessionId: string) => {
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
        const pendingJson = localStorage.getItem('pendingSite');
        if (!pendingJson) {
          throw new Error('No pending site data found. Please generate a new site and try again.');
        }

        const pending = JSON.parse(pendingJson);
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

        // Step 2: Generate HTML with placeholders
        const restoredSiteData: WebsiteData = {
          ...siteData,
          hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] ? 'has-image' : '' },
          about: { ...siteData.about, imageUrl: imageUrlMap['about'] ? 'has-image' : '' },
          gallery: siteData.gallery.map((_: string, i: number) =>
            imageUrlMap[`gallery${i}`] ? 'has-image' : ''
          ),
        };

        const html = generateHTMLForTemplate(restoredSiteData);

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

        // Step 4: Fire Meta Purchase event — browser pixel + CAPI dedupe on event_id.
        // Use the verified amount from Stripe rather than a hardcoded value.
        const purchaseValue = typeof verifyResult.amountTotal === 'number' ? verifyResult.amountTotal : 10.0;
        const purchaseCurrency = verifyResult.currency || 'USD';

        try {
          window.fbq?.(
            'track',
            'Purchase',
            { value: purchaseValue, currency: purchaseCurrency },
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
            customerEmail: verifyResult.customerEmail || null,
            eventSourceUrl: window.location.origin,
            clientUserAgent: navigator.userAgent,
          }),
        }).catch((err) => console.error('[FB CAPI] Error (non-blocking):', err));

        // TikTok Purchase — browser pixel + CAPI dedupe on event_id.
        try {
          (window as any).ttq?.track(
            'Purchase',
            { value: purchaseValue, currency: purchaseCurrency },
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
          }),
        }).catch((err) => console.error('[TikTok CAPI Purchase] Error (non-blocking):', err));

        // Step 5: Create SiteInstance and save to IndexedDB
        // Restore the full image URLs back into siteData for the SiteInstance
        const fullSiteData: WebsiteData = {
          ...siteData,
          hero: { ...siteData.hero, imageUrl: imageUrlMap['hero'] || siteData.hero.imageUrl || '' },
          about: { ...siteData.about, imageUrl: imageUrlMap['about'] || siteData.about.imageUrl || '' },
          gallery: siteData.gallery.map((_: string, i: number) =>
            imageUrlMap[`gallery${i}`] || ''
          ),
        };

        // Reuse the existing draft's UUID so saveSite overwrites that
        // record instead of creating a parallel one. Without this the
        // user ends up with two records in IndexedDB (draft + deployed)
        // and the dashboard surfaces the draft, which has no GCS image
        // URLs — that's why Edit My Website opened an empty page and
        // status read "Draft" even though the site was live.
        const newSite: SiteInstance = {
          id: existingSiteId || siteId || crypto.randomUUID(),
          data: fullSiteData,
          lastSaved: Date.now(),
          formInputs: { shopName: siteData.shopName, area: siteData.area, phone: siteData.phone },
          deployedUrl: deployData.deploymentUrl,
          deploymentStatus: 'deployed',
          customDomain: null,
          domainOrderId: null,
        };

        // Save to IndexedDB (and Supabase if user is signed in via
        // handleAuthSuccess later). Same UUID → upsert overwrites
        // the draft instead of creating a sibling row.
        await saveSite(newSite);
        setActiveSite(newSite);

        localStorage.removeItem('pendingSite');
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
    if (result.url) {
      setShowPostDeployModal(true);
    }
  };

  // The optional `prebuilt` arg lets the /booksy form skip the
  // generateContent() template call — the Apify scraper has already
  // produced a complete WebsiteData payload from the real Booksy page.
  const handleGenerate = async (inputs: ShopInputs, prebuilt?: WebsiteData) => {
    captureLead(inputs).catch((err) => console.error("[Lead Capture] Error (non-blocking):", err));

    // Meta Lead event — browser pixel + CAPI share the same event_id for dedupe
    const leadEventId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      window.fbq?.('track', 'Lead', { content_name: 'Barbershop Site Generated' }, { eventID: leadEventId });
    } catch (err) {
      console.warn('[FB Pixel Lead] browser fire failed:', err);
    }
    fetch('/api/fb-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: leadEventId,
        phone: inputs.phone || null,
        contentName: 'Barbershop Site Generated',
        eventSourceUrl: window.location.origin,
        clientUserAgent: navigator.userAgent,
      }),
    }).catch((err) => console.error('[FB CAPI Lead] Error (non-blocking):', err));

    // TikTok Lead — browser pixel + CAPI dedupe on the same event_id.
    try {
      (window as any).ttq?.track('Lead', { content_name: 'Barbershop Site Generated' }, { event_id: leadEventId });
    } catch (err) {
      console.warn('[TikTok Pixel Lead] browser fire failed:', err);
    }
    fetch('/api/tiktok-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'Lead',
        event_id: leadEventId,
        event_source_url: window.location.origin,
        user_agent: navigator.userAgent,
      }),
    }).catch((err) => console.error('[TikTok CAPI Lead] Error (non-blocking):', err));

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
      // Fire the post-generation intro modal once if the visitor came
      // through the /new quiz funnel. Ref resets to false right after.
      if (cameFromNewRef.current) {
        cameFromNewRef.current = false;
        setShowEditorIntro(true);
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

  const handleBack = () => {
    // Auth-aware: signed-in users go back to their dashboard (where
    // their drafts + deployed sites live). Anonymous users go back
    // to the home form. Was always sending everyone to the home page
    // — even users who had just generated a site while logged in.
    setGeneratedData(null);
    setActiveSite(null);
    persistView(isAuthenticated ? 'dashboard' : 'generator');
  };

  const handleEditSite = (site: SiteInstance) => {
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
    setShowAuthModal(true);
  };

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);

    // Auto-migrate the current site to Supabase if we have one
    if (activeSite && user) {
      try {
        await upsertSiteToSupabase(activeSite, user.id);
        console.log('[Migration] Site migrated to Supabase');
      } catch (err) {
        console.error('[Migration] Failed to migrate site (non-blocking):', err);
      }
    }

    persistView('dashboard');
    setDeployResult(null);
  };

  const handleSkipAccountCreation = () => {
    setShowPostDeployModal(false);
    // Stay on deploying view showing the success state — user can click "Create Another Site" or just leave
  };

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
      {state === 'generator' && (
        isBooksyPath() ? (
          <BooksyGeneratorForm
            onGenerate={(inputs, scraped) => handleGenerate(inputs, scraped)}
            onSignIn={() => { setAuthModalMode('signin'); setAuthSignInOnly(true); setShowAuthModal(true); }}
          />
        ) : isNewLeadPath() ? (
          <NewLeadQuizForm
            onGenerate={(inputs) => {
              // Mark this visitor as coming from /new so the post-
              // generation intro modal fires after the editor mounts.
              cameFromNewRef.current = true;
              handleGenerate(inputs);
            }}
            onSignIn={() => { setAuthModalMode('signin'); setAuthSignInOnly(true); setShowAuthModal(true); }}
          />
        ) : (
          <GeneratorForm
            onGenerate={handleGenerate}
            onSignIn={() => { setAuthModalMode('signin'); setAuthSignInOnly(true); setShowAuthModal(true); }}
          />
        )
      )}
      {state === 'loading' && <LoadingScreen />}
      {state === 'editor' && generatedData && (
        generatedData.template === 'euphoria' ? (
          <EuphoriaWebsite
            data={generatedData}
            onBack={handleBack}
            site={activeSite ?? undefined}
            onNavigateDashboard={handleNavigateDashboard}
            isPostPayment={!!activeSite?.deployedUrl}
            userId={user?.id ?? null}
          />
        ) : (
          <GeneratedWebsite
            data={generatedData}
            onBack={handleBack}
            site={activeSite ?? undefined}
            onNavigateDashboard={handleNavigateDashboard}
            isPostPayment={!!activeSite?.deployedUrl}
            userId={user?.id ?? null}
          />
        )
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
        onClose={() => { setShowAuthModal(false); setAuthSignInOnly(false); }}
        initialMode={authModalMode}
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

            <p
              className="relative mb-1 text-[10px] font-bold uppercase tracking-[0.34em]"
              style={{ color: '#ef4444' }}
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
              A quick tour of what you can do from here.
            </p>

            <ul className="relative space-y-3.5 text-[13.5px] leading-relaxed text-white/85 md:text-[14px]" style={{ fontFamily: '"Manrope", "Inter", sans-serif' }}>
              {[
                { text: 'Tap any text on the site to edit it.', bold: false },
                { text: 'Add your own images.', bold: false },
                { text: "Publish when you're ready, then make an account to edit text & images anytime.", bold: false },
                { text: "Don't like the design? Scroll to the bottom to request a custom one.", bold: true },
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
    </div>
  );
};

export default App;
