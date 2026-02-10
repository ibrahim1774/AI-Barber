import React, { useState, useEffect } from 'react';
import { AppState, ShopInputs, WebsiteData } from './types.ts';
import { Dashboard } from './components/Dashboard.tsx';
import { LoadingScreen } from './components/LoadingScreen.tsx';
import { GeneratedWebsite, generateHTMLWithPlaceholders } from './components/GeneratedWebsite.tsx';
import { generateContent } from './services/geminiService.ts';

const DEPLOY_TIMER_SECONDS = 15;

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('dashboard');
  const [generatedData, setGeneratedData] = useState<WebsiteData | null>(null);
  const [deployResult, setDeployResult] = useState<{ url?: string; error?: string } | null>(null);
  const [deployCountdown, setDeployCountdown] = useState(DEPLOY_TIMER_SECONDS);
  const [deployShopName, setDeployShopName] = useState('');
  const [copied, setCopied] = useState(false);

  // Check for Stripe return on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeSessionId = params.get('stripe_session');

    if (stripeSessionId) {
      // Clean URL
      window.history.replaceState({}, '', '/');
      handleStripeReturn(stripeSessionId);
    }
  }, []);

  const handleStripeReturn = async (sessionId: string) => {
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
        const { siteId, siteData, imageUrlMap } = pending as {
          siteId: string;
          siteData: WebsiteData;
          imageUrlMap: Record<string, string>;
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

        const html = generateHTMLWithPlaceholders(restoredSiteData);

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

        // Step 4: Fire Facebook CAPI Purchase event (fire-and-forget)
        fetch('/api/fb-purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: sessionId,
            value: 10.0,
            currency: 'USD',
            customerEmail: verifyResult.customerEmail || null,
            eventSourceUrl: window.location.origin,
            clientUserAgent: navigator.userAgent,
          }),
        }).catch((err) => console.error('[FB CAPI] Error (non-blocking):', err));

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
  };

  const handleGenerate = async (inputs: ShopInputs) => {
    setState('loading');
    try {
      const data = await generateContent(inputs);
      setGeneratedData(data);
      setState('generated');
    } catch (error: any) {
      console.error("Website generation failed:", error);
      alert(`Generation Error: ${error.message || "An unexpected error occurred. Please try again."}`);
      setState('dashboard');
    }
  };

  const handleBack = () => {
    setState('dashboard');
    setGeneratedData(null);
  };

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      {state === 'dashboard' && <Dashboard onGenerate={handleGenerate} />}
      {state === 'loading' && <LoadingScreen />}
      {state === 'generated' && generatedData && (
        <GeneratedWebsite data={generatedData} onBack={handleBack} />
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

          {deployResult?.url && (
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
                Your barbershop website has been deployed and is now live on the web.
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
                onClick={() => { setState('dashboard'); setDeployResult(null); }}
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
                DEPLOYMENT <span className="text-red-500">FAILED</span>
              </h2>
              <p className="text-red-400 text-sm mb-8 text-center max-w-md">
                {deployResult.error}
              </p>
              <button
                onClick={() => { setState('dashboard'); setDeployResult(null); }}
                className="inline-block py-4 px-12 border-2 border-[#f4a100] text-[#f4a100] font-montserrat font-black tracking-[3px] uppercase hover:bg-[#f4a100] hover:text-[#1a1a1a] transition-all duration-300 text-sm"
              >
                GO BACK
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default App;
