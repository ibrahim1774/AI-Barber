import React, { useState, useEffect, useCallback } from 'react';
import { X, ArrowRight, Rocket, Loader2, Sparkles, Check } from 'lucide-react';
import { isBooksyPath, isFreeBarberPath, isBookingPath, isGeneratePath, isBarberGeneratePath, isHome2Path } from '../lib/dealMode.ts';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

const STRIPE_PK = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise && STRIPE_PK) stripePromise = loadStripe(STRIPE_PK);
  return stripePromise ?? Promise.resolve(null);
}

// Sample imagery for the custom-design wizard. Swap to local files in
// /public/ later if desired — keep the same array length.
const WIZARD_IMAGES = {
  hero: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=900&q=80',
  modern: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=600&q=80',
  editorial: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=600&q=80',
  luxury: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80',
  minimal: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=600&q=80',
  pages: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=900&q=80',
  booking: 'https://images.unsplash.com/photo-1611501275019-9b5cda994e8d?auto=format&fit=crop&w=900&q=80',
};

interface PrePaymentBannerProps {
  // 'monthly-booksy' = /booksy import flow ($7/mo); 'monthly-free' =
  // /free-barber ($7/mo); 'monthly' = homepage ($10/mo). The separate
  // slugs also drive analytics attribution on the receipt.
  onDeploy: (plan: 'monthly' | 'monthly-booksy' | 'monthly-free' | 'monthly-booking' | 'monthly-home2' | 'yearly' | 'yearly-booksy' | 'yearly-free' | 'yearly-booking' | 'yearly-home2') => void;
  // Embedded checkout requires the parent to first upload images +
  // write pendingSite to localStorage so handleStripeReturn can deploy
  // after the customer pays. Returns the real siteId we then pass to
  // /api/create-checkout-session so Stripe metadata + the
  // post-payment dashboard view both have the right ID. When this
  // prop is omitted, the banner falls back to onDeploy (legacy
  // redirect flow) even if STRIPE_PK is set.
  onPrepareCheckout?: (
    plan: 'monthly' | 'monthly-booksy' | 'monthly-free' | 'monthly-booking' | 'monthly-home2' | 'yearly' | 'yearly-booksy' | 'yearly-free' | 'yearly-booking' | 'yearly-home2',
  ) => Promise<{ siteId: string } | { error: string }>;
  isDeploying: boolean;
  industry?: string;
  // Optional. Fires whenever the visitor enters or leaves the Launch
  // checkout flow (preparing the embedded checkout, or the Benefits
  // modal showing). Used by /generatebarbershop to hide the
  // BarbershopMidSitePrompts overlay so it doesn't sit on top of the
  // Stripe form. Every other entry path (homepage, /booksy, /free-barber,
  // /primebarber, post-payment editor) omits this prop and behavior is
  // unchanged for them.
  onCheckoutFlowChange?: (open: boolean) => void;
}

const PrePaymentBanner: React.FC<PrePaymentBannerProps> = ({ onDeploy, onPrepareCheckout, isDeploying, industry, onCheckoutFlowChange }) => {
  // /booksy import flow: $7/mo (vs the $10/mo homepage). booksyMode is
  // tracked so the receipt tags the source as "(Booksy)" via the
  // monthly-booksy plan slug. /barber-generate is "/booksy minus the front
  // form" — it reuses the exact Booksy pricing + plan slugs, so it folds in
  // here rather than defining its own.
  const booksyMode = React.useMemo(() => isBooksyPath() || isBarberGeneratePath(), []);
  // /free-barber: $7/mo entry with yearly toggle visible — its own
  // plan slugs so Stripe + analytics distinguish it from /booksy and
  // the homepage.
  const freeBarberMode = React.useMemo(() => isFreeBarberPath(), []);
  // /booking: generic booking-link entry. Its own pricing — $10/mo +
  // $59/yr — and its own plan slugs so Stripe + analytics distinguish it.
  const bookingMode = React.useMemo(() => isBookingPath(), []);
  // /generate: "Customize Your Barbershop Site". Same $10/mo + $59/yr as
  // /booking, with its own plan slugs for analytics attribution.
  const generateMode = React.useMemo(() => isGeneratePath(), []);
  // /home-2: exact homepage duplicate at $19/mo + $99/yr — its own plan
  // slugs so Stripe products + analytics distinguish the price test.
  const home2Mode = React.useMemo(() => isHome2Path(), []);

  // Standard monthly price varies by entry path:
  //   /free-barber → $7/mo (plan 'monthly-free')
  //   /booksy      → $10/mo (plan 'monthly-booksy')
  //   /booking     → $10/mo (plan 'monthly-booking')
  //   home page    → $10/mo (plan 'monthly')
  //   /free-barber → $7/mo (plan 'monthly-free')
  const stdMonthlyPriceDollars = home2Mode ? 19 : freeBarberMode ? 7 : 10;
  const stdMonthlyPriceMo = `$${stdMonthlyPriceDollars}/mo`;
  const stdMonthlyPriceMonth = `$${stdMonthlyPriceDollars}/month`;
  const stdMonthlyPlan: 'monthly' | 'monthly-booksy' | 'monthly-free' | 'monthly-booking' | 'monthly-generate' | 'monthly-home2' = home2Mode
    ? 'monthly-home2'
    : generateMode
    ? 'monthly-generate'
    : bookingMode
      ? 'monthly-booking'
      : booksyMode
        ? 'monthly-booksy'
        : freeBarberMode
          ? 'monthly-free'
          : 'monthly';
  // Yearly is $49/yr everywhere EXCEPT /booking ($59/yr). The discount %
  // is computed off the path's own monthly × 12 anchor so "Save X%"
  // always reflects the real saving. Keep the server amounts in
  // api/create-checkout-session.ts in sync.
  const stdYearlyPriceDollars = home2Mode ? 99 : (bookingMode || generateMode || booksyMode) ? 59 : 49;
  const stdYearlyPriceYr = `$${stdYearlyPriceDollars}/yr`;
  const stdYearlyPriceYear = `$${stdYearlyPriceDollars}/year`;
  const stdYearlyDiscountPct = Math.max(
    0,
    Math.round((1 - stdYearlyPriceDollars / (stdMonthlyPriceDollars * 12)) * 100),
  );
  const stdYearlyPlan: 'yearly' | 'yearly-booksy' | 'yearly-free' | 'yearly-booking' | 'yearly-generate' | 'yearly-home2' = home2Mode
    ? 'yearly-home2'
    : generateMode
    ? 'yearly-generate'
    : bookingMode
      ? 'yearly-booking'
      : booksyMode
        ? 'yearly-booksy'
        : freeBarberMode
          ? 'yearly-free'
          : 'yearly';

  // Custom-design upsell. Flat $29/mo across every entry path.
  // Plan slug per path for analytics attribution:
  //   custom-booksy → /booksy
  //   custom25      → everywhere else
  const customPlan: 'custom25' | 'custom-booksy' = booksyMode
    ? 'custom-booksy'
    : 'custom25';
  // Custom-design upsell is $29/mo on every entry path.
  const customPriceLabel = '$29/mo';
  const customPriceFull = '$29/month';

  const [isDismissed, setIsDismissed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showCustomWizard, setShowCustomWizard] = useState(false);
  const [isCustomCheckingOut, setIsCustomCheckingOut] = useState(false);
  // Every entry path defaults to the monthly plan, shown first.
  const [pricingPlan, setPricingPlan] = useState<'monthly' | 'yearly'>('monthly');
  // Benefits-popup state. When STRIPE_PK is present, the Launch My
  // Site CTA opens a modal with 5 plain-language bullets + the
  // embedded Stripe checkout below — no redirect to checkout.stripe.com.
  const [showBenefits, setShowBenefits] = useState(false);
  const [embedSecret, setEmbedSecret] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const embedAbortRef = React.useRef<AbortController | null>(null);
  // Real siteId from onPrepareCheckout. Used as the siteId in the
  // embedded /api/create-checkout-session call so Stripe metadata
  // matches the actual site, and so handleStripeReturn can find the
  // matching pendingSite in localStorage after payment.
  const embedSiteIdRef = React.useRef<string | null>(null);
  const [isPreparingEmbed, setIsPreparingEmbed] = useState(false);

  // Notify the parent (when one is listening) whenever ANY banner
  // overlay opens or closes: preparing the pending site, the
  // Benefits/embedded checkout modal, the "How It Works" modal, and the
  // "Want a new barbershop website" custom-design wizard. The homepage
  // funnel uses this to hide its mid-site prompt so the clicked overlay
  // sits cleanly on top instead of the prompt covering it.
  useEffect(() => {
    onCheckoutFlowChange?.(isPreparingEmbed || showBenefits || showCustomWizard || showHowItWorks);
  }, [isPreparingEmbed, showBenefits, showCustomWizard, showHowItWorks, onCheckoutFlowChange]);
  // Embedded checkout state for the custom-design wizard's step-3
  // Continue button — same pattern as the main flow.
  const [customEmbedSecret, setCustomEmbedSecret] = useState<string | null>(null);
  const [customEmbedError, setCustomEmbedError] = useState<string | null>(null);

  // Cancel any in-flight checkout fetch when the wizard is closed so the
  // step-4 button doesn't stay stuck in its loading state on reopen.
  const customCheckoutAbortRef = React.useRef<AbortController | null>(null);

  // Footer CTAs in the generated-site renderers dispatch this event so
  // the existing wizard opens without prop-drilling. Listen window-wide
  // so it works from any descendant.
  React.useEffect(() => {
    const open = () => setShowCustomWizard(true);
    window.addEventListener('open-custom-design-wizard', open);
    return () => window.removeEventListener('open-custom-design-wizard', open);
  }, []);

  // Fetch the embedded client_secret for the bottom-banner Launch CTA.
  // Refetches whenever the visitor toggles monthly/yearly inside the
  // modal so the price in the iframe matches the selected plan.
  const fetchEmbeddedSecret = useCallback(async (planSlug: string) => {
    embedAbortRef.current?.abort();
    const controller = new AbortController();
    embedAbortRef.current = controller;
    setEmbedSecret(null);
    setEmbedError(null);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: embedSiteIdRef.current || 'pre-publish',
          plan: planSlug,
          embedded: true,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) throw new Error(data.error || 'Could not start checkout.');
      setEmbedSecret(data.clientSecret);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[Embedded Checkout] fetch failed:', err);
      setEmbedError(err.message || 'Could not load the payment form.');
    }
  }, []);

  React.useEffect(() => {
    if (!showBenefits) {
      setEmbedSecret(null);
      embedAbortRef.current?.abort();
      return;
    }
    const planSlug = pricingPlan === 'monthly' ? stdMonthlyPlan : stdYearlyPlan;
    fetchEmbeddedSecret(planSlug);
    return () => embedAbortRef.current?.abort();
  }, [showBenefits, pricingPlan, stdMonthlyPlan, stdYearlyPlan, fetchEmbeddedSecret]);

  // Kicks off the custom-design Stripe checkout. Flat $15/mo across
  // every entry path. After success the backend routes the customer
  // to the Google Form to capture preferences.
  const handleCustomCheckout = async () => {
    // Abort any prior in-flight request before starting a new one
    customCheckoutAbortRef.current?.abort();
    const controller = new AbortController();
    customCheckoutAbortRef.current = controller;

    setIsCustomCheckingOut(true);

    // Fire FB + TikTok InitiateCheckout (pixel + CAPI) before the
    // Stripe redirect. Shared event_id so Meta/TikTok dedupe the
    // browser pixel against the server-side CAPI hit.
    try {
      const checkoutEventId =
        typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `co_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // Custom-design InitiateCheckout — matches the actual Stripe
      // charge ($29/mo) so Meta/TikTok ROAS math stays aligned.
      const checkoutValue = 29;
      const checkoutCurrency = 'USD';
      const { getPlanContentMeta } = await import('../lib/pixelMeta');
      const { readMetaCookies } = await import('../services/metaMatchParams');
      const m = getPlanContentMeta(customPlan, checkoutValue);
      const { fbc, fbp } = readMetaCookies();
      (window as any).fbq?.(
        'track',
        'InitiateCheckout',
        { value: checkoutValue, currency: checkoutCurrency, content_ids: [m.content_id], content_type: m.content_type, contents: m.contents },
        { eventID: checkoutEventId },
      );
      (window as any).ttq?.track(
        'InitiateCheckout',
        { value: checkoutValue, currency: checkoutCurrency, content_id: m.content_id, content_type: m.content_type, contents: m.contents },
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
          externalId: checkoutEventId,
          fbc,
          fbp,
          content_id: m.content_id,
          content_name: m.content_name,
          content_type: m.content_type,
          contents: m.contents,
        }),
      }).catch(err => console.error('[FB CAPI InitiateCheckout - Custom] Failed:', err));
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
          external_id: checkoutEventId,
          content_id: m.content_id,
          content_name: m.content_name,
          content_type: m.content_type,
          contents: m.contents,
        }),
      }).catch(err => console.error('[TikTok CAPI InitiateCheckout - Custom] Failed:', err));
    } catch (e) {
      console.error('[InitiateCheckout - Custom] Tracking failed:', e);
    }

    const useEmbedded = !!STRIPE_PK;
    setCustomEmbedSecret(null);
    setCustomEmbedError(null);

    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'custom-design-request',
          plan: customPlan,
          embedded: useEmbedded,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create custom-design checkout');

      if (useEmbedded) {
        if (!data.clientSecret) throw new Error('Missing client secret from Stripe.');
        setCustomEmbedSecret(data.clientSecret);
        setIsCustomCheckingOut(false);
      } else {
        if (!data.url) throw new Error('Missing redirect URL from Stripe.');
        window.location.href = data.url;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user closed wizard mid-flight
      console.error('[Custom Design] checkout error:', err);
      if (useEmbedded) {
        setCustomEmbedError(err.message || 'Could not load the payment form.');
      } else {
        alert(err.message || 'Could not start checkout. Please try again.');
      }
      setIsCustomCheckingOut(false);
    }
  };

  const closeCustomWizard = () => {
    customCheckoutAbortRef.current?.abort();
    customCheckoutAbortRef.current = null;
    setCustomEmbedSecret(null);
    setCustomEmbedError(null);
    setShowCustomWizard(false);
    setIsCustomCheckingOut(false);
  };

  const displayIndustry = industry || 'barbershop';

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showHowItWorks || showCustomWizard || showBenefits) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showHowItWorks, showCustomWizard, showBenefits]);

  if (isDismissed) return null;

  return (
    <>
      {/* Premium sticky-bottom CTA. Same design language as the
          How-It-Works modal: cream + gold on dark, serif italic for
          the price line, hairline rules instead of cards, no pulsing
          orange. Reads as editorial rather than promotional. */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-[100] transition-transform duration-700 ease-out ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div
          className="relative px-3.5 pt-2 pb-2.5 md:px-5 md:pt-2.5 md:pb-3 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] border-t"
          style={{
            background: 'linear-gradient(180deg, #0a0a0a 0%, #14110c 100%)',
            borderTopColor: 'rgba(232,192,116,0.18)',
            fontFamily: '"DM Sans", sans-serif',
            color: '#ece6da',
          }}
        >
          {/* Top-right "X" dismiss button removed — keeps the publish
              CTA persistent so the visitor can't accidentally hide it. */}

          {/* Price headline removed — the Publish CTA below still shows
              the live price ("Publish $9/mo"), so the standalone
              "$9/mo — hosting/maintenance only" line was redundant. */}

          {/* Monthly / Yearly toggle. On /generate the toggles are larger;
              every path shows Monthly first (Monthly is the default plan). */}
          {(() => {
            const sizeCls = generateMode
              ? 'text-[12px] md:text-[13px] pb-1'
              : booksyMode
                ? 'text-[11px] pb-0.5'
                : 'text-[9px] pb-0.5';
            // /booksy: bolder + ~20% bigger monthly/yearly toggle.
            const weightCls = booksyMode ? 'font-bold' : 'font-medium';
            const underline = generateMode ? '2px' : '1px';
            const monthlyBtn = (
              <button
                key="monthly"
                onClick={() => setPricingPlan('monthly')}
                className={`${sizeCls} ${weightCls} uppercase tracking-[0.22em] transition-colors`}
                style={{
                  color: pricingPlan === 'monthly' ? '#ece6da' : 'rgba(236,230,218,0.4)',
                  borderBottom: pricingPlan === 'monthly' ? `${underline} solid #e8c074` : `${underline} solid transparent`,
                }}
              >
                Monthly
              </button>
            );
            const yearlyBtn = (
              <button
                key="yearly"
                onClick={() => setPricingPlan('yearly')}
                className={`${sizeCls} ${weightCls} uppercase tracking-[0.22em] transition-colors`}
                style={{
                  color: pricingPlan === 'yearly' ? '#ece6da' : 'rgba(236,230,218,0.4)',
                  borderBottom: pricingPlan === 'yearly' ? `${underline} solid #e8c074` : `${underline} solid transparent`,
                }}
              >
                Yearly <span style={{ color: '#ffffff', fontWeight: 700 }}>(Save {stdYearlyDiscountPct}%)</span>
              </button>
            );
            return (
              <div className={`flex items-center justify-center ${generateMode ? 'gap-7 mb-3' : 'gap-5 mb-2.5'}`}>
                {[monthlyBtn, yearlyBtn]}
              </div>
            );
          })()}

          {/* Action row — Launch My Site full-width. How It Works
              button removed so the CTA spans the row and the
              animated glow has more visual presence. */}
          <div className="flex items-center gap-2">
            <style>{`
              @keyframes aibCtaPop {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.035); }
              }
              @keyframes aibCtaGlow {
                0%, 100% { box-shadow: 0 0 0 0 rgba(232,192,116,0), 0 4px 14px rgba(232,192,116,0.45); }
                50%      { box-shadow: 0 0 18px 4px rgba(232,192,116,0.65), 0 6px 22px rgba(232,192,116,0.75); }
              }
              .aib-cta-launch {
                animation: aibCtaPop 2.4s ease-in-out infinite, aibCtaGlow 2.4s ease-in-out infinite;
              }
              .aib-cta-launch:hover { animation-play-state: paused; transform: scale(1.04); }
            `}</style>
            <button
              onClick={async () => {
                const planSlug = pricingPlan === 'monthly' ? stdMonthlyPlan : stdYearlyPlan;
                // No embedded support → legacy redirect flow.
                if (!STRIPE_PK || !onPrepareCheckout) {
                  onDeploy(planSlug);
                  return;
                }
                // Embedded flow — write pendingSite + upload images
                // BEFORE opening the modal so handleStripeReturn can
                // restore + deploy after Stripe sends the visitor back.
                setIsPreparingEmbed(true);
                try {
                  const prep = await onPrepareCheckout(planSlug);
                  if ('error' in prep) {
                    alert(prep.error);
                    return;
                  }
                  embedSiteIdRef.current = prep.siteId;
                  setShowBenefits(true);
                } finally {
                  setIsPreparingEmbed(false);
                }
              }}
              disabled={isDeploying || isPreparingEmbed}
              className="aib-cta-launch w-full py-3 text-[11px] md:text-[12px] font-bold flex items-center justify-center gap-2 hover:opacity-95 active:scale-[0.98] transition-transform uppercase tracking-[0.24em] disabled:opacity-50"
              style={{
                background: '#e8c074',
                color: '#0a0a0a',
                fontFamily: '"DM Sans", sans-serif',
              }}
            >
              {isDeploying || isPreparingEmbed ? (
                <Loader2 className="animate-spin" size={12} />
              ) : (
                <Rocket size={12} />
              )}
              <span>Publish Your Website</span>
              <span
                className="font-extrabold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(10,10,10,0.18)', color: '#0a0a0a' }}
              >
                {pricingPlan === 'yearly' ? stdYearlyPriceYear : stdMonthlyPriceMonth}
              </span>
            </button>
          </div>

          {/* Custom-site upsell — highlighted gold-tinted box. Single
              headline (no subtext), price + arrow anchored right. Same on
              every entry path: "Custom 20+ Page Barber Website…", $29/mo.
              ~20% larger than the standard CTAs with the price pill as the
              visual anchor — opens straight into the checkout modal. */}
          <button
            type="button"
            onClick={() => setShowCustomWizard(true)}
            className="group mt-2 flex w-full items-center justify-between gap-2.5 border px-3 py-2.5 transition-all hover:border-[#e8c074]/70"
            style={{
              background: 'linear-gradient(180deg, rgba(232,192,116,0.08) 0%, rgba(232,192,116,0.03) 100%)',
              borderColor: 'rgba(232,192,116,0.45)',
              color: '#ece6da',
              textAlign: 'left',
            }}
          >
            <span className="flex items-start min-w-0 gap-2">
              <Sparkles size={13} className="mt-[2px] shrink-0" style={{ color: '#e8c074' }} />
              <span className="min-w-0">
                <span
                  className="block font-extrabold"
                  style={{ fontSize: '0.92rem', color: '#e8c074', lineHeight: 1.18, letterSpacing: '-0.005em' }}
                >
                  Custom 20+ Page Barber Website with On-Page SEO Included
                </span>
              </span>
            </span>
            <span
              className="flex items-center gap-1.5 font-black uppercase tracking-[0.16em] shrink-0 rounded-full text-[12.5px] px-3 py-1.5"
              style={{
                color: '#0a0a0a',
                background: '#e8c074',
                boxShadow: '0 0 0 2px rgba(232,192,116,0.85), 0 6px 20px -4px rgba(232,192,116,0.8)',
              }}
            >
              {customPriceLabel}
              <ArrowRight size={12} className="transition group-hover:translate-x-0.5" />
            </span>
          </button>
        </div>
      </div>

      {showHowItWorks && (() => {
        // Premium-leaning rewrite of the How-It-Works modal. Drops the
        // emoji+card aesthetic for a quieter editorial layout: serif
        // italic headline, gold reserved only for the price and CTA,
        // Roman-numeral rows separated by hairlines instead of cards.
        const gold = '#e8c074';
        const cream = '#ece6da';
        const headlinePrice = pricingPlan === 'yearly' ? stdYearlyPriceYr : stdMonthlyPriceMo;
        const ctaPrice = pricingPlan === 'yearly' ? stdYearlyPriceYear : stdMonthlyPriceMonth;

        const rows: { numeral: string; title: string }[] = [
          { numeral: 'I', title: 'Professional & Modern Site' },
          { numeral: 'II', title: 'Published Instantly' },
          { numeral: 'III', title: 'Edit Anytime' },
          { numeral: 'IV', title: `Custom for Your ${displayIndustry.charAt(0).toUpperCase()}${displayIndustry.slice(1)}` },
          { numeral: 'V', title: 'One small hosting/maintenance fee' },
        ];

        return (
        <div
          className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-6"
          onClick={() => setShowHowItWorks(false)}
        >
          <div
            className="relative max-w-md w-full max-h-[92vh] overflow-y-auto border border-white/10 px-6 pt-8 pb-7 md:px-8 md:pt-9 md:pb-8 shadow-2xl animate-[modalIn_0.3s_ease-out]"
            style={{
              background: 'linear-gradient(180deg, #0a0a0a 0%, #14110c 100%)',
              fontFamily: '"DM Sans", sans-serif',
              color: cream,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowHowItWorks(false)}
              className="absolute top-3 right-3 text-white/40 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {/* Eyebrow — thin gold hairline + label, no pulsing dot */}
            <div className="flex items-center gap-3 mb-5">
              <span className="h-px w-6" style={{ background: gold }} />
              <span className="text-[10px] font-medium uppercase tracking-[0.32em]" style={{ color: gold }}>
                How It Works
              </span>
              <span className="h-px flex-1" style={{ background: 'rgba(232,192,116,0.2)' }} />
            </div>

            {/* Headline — serif italic, generous size, gold accent on the punchline */}
            <h2
              className="leading-[1.05] mb-2"
              style={{ fontFamily: '"Instrument Serif", serif', fontSize: '2.25rem', fontWeight: 400 }}
            >
              <span style={{ color: cream }}>Publish within </span>
              <span style={{ color: gold, fontStyle: 'italic' }}>seconds.</span>
            </h2>

            {/* Sub — single line, gray, no padding bloat */}
            <p className="text-sm leading-relaxed mb-6" style={{ color: 'rgba(236,230,218,0.55)' }}>
              A custom website for your barbershop, yours to edit anytime.
            </p>

            {/* Monthly / Yearly toggle — quiet text-based with gold underline.
                Monthly is shown first everywhere (Monthly is the default plan). */}
            <div className="flex items-center justify-center gap-6 mb-7">
              <button
                onClick={() => setPricingPlan('monthly')}
                className={`${booksyMode ? 'text-[13px] font-bold' : 'text-[11px] font-medium'} uppercase tracking-[0.22em] pb-1.5 transition-colors`}
                style={{
                  color: pricingPlan === 'monthly' ? cream : 'rgba(236,230,218,0.4)',
                  borderBottom: pricingPlan === 'monthly' ? `1px solid ${gold}` : '1px solid transparent',
                }}
              >
                Monthly · {stdMonthlyPriceMo}
              </button>
              <button
                onClick={() => setPricingPlan('yearly')}
                className={`${booksyMode ? 'text-[13px] font-bold' : 'text-[11px] font-medium'} uppercase tracking-[0.22em] pb-1.5 transition-colors`}
                style={{
                  color: pricingPlan === 'yearly' ? cream : 'rgba(236,230,218,0.4)',
                  borderBottom: pricingPlan === 'yearly' ? `1px solid ${gold}` : '1px solid transparent',
                }}
              >
                Yearly · {stdYearlyPriceYr} <span style={{ color: '#ffffff', fontWeight: 700 }}>(Save {stdYearlyDiscountPct}%)</span>
              </button>
            </div>

            {/* Five Roman-numeral rows — hairline dividers, no cards */}
            <div className="border-t border-white/10">
              {rows.map((row) => (
                <div
                  key={row.numeral}
                  className="flex items-baseline gap-5 py-3.5 border-b border-white/10"
                >
                  <span
                    className="shrink-0 text-[11px] font-medium tracking-[0.18em] w-7"
                    style={{ color: gold, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}
                  >
                    {row.numeral}
                  </span>
                  <span className="text-[15px] font-normal leading-snug" style={{ color: cream }}>
                    {row.title}
                  </span>
                </div>
              ))}
            </div>

            {/* Price line — serif, generous, with hairline meta on the second row */}
            <div className="mt-7 mb-5 text-center">
              <p
                style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.6rem', color: cream, fontWeight: 400 }}
              >
                {pricingPlan === 'yearly' && (
                  <span style={{ color: 'rgba(236,230,218,0.3)', textDecoration: 'line-through', fontSize: '1rem', marginRight: '0.4em' }}>
                    $120/yr
                  </span>
                )}
                <span style={{ color: gold }}>{headlinePrice}</span>
                <span style={{ color: 'rgba(236,230,218,0.55)', fontSize: '0.9rem', fontFamily: '"DM Sans", sans-serif', marginLeft: '0.4em' }}>
                  — hosting only
                </span>
              </p>
              <p className="mt-1.5 text-[10px] uppercase tracking-[0.28em]" style={{ color: 'rgba(236,230,218,0.35)' }}>
                No design fee · No contracts · Cancel anytime
              </p>
            </div>

            {/* Save + Publish action row. Save closes the modal —
                the editor's useAutoSave hook already persisted the
                draft, so coming back later just resumes the same
                site. Publish goes to Stripe and deploys. */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setShowHowItWorks(false)}
                disabled={isDeploying}
                className="flex-1 py-3.5 text-[11px] font-medium border hover:border-white/40 transition-colors uppercase tracking-[0.24em] disabled:opacity-50"
                style={{
                  color: cream,
                  borderColor: 'rgba(236,230,218,0.25)',
                  fontFamily: '"DM Sans", sans-serif',
                }}
              >
                Save Design
              </button>

              <button
                onClick={() => { setShowHowItWorks(false); onDeploy(pricingPlan === 'monthly' ? stdMonthlyPlan : stdYearlyPlan); }}
                disabled={isDeploying}
                className="flex-1 py-3.5 text-[11px] font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all uppercase tracking-[0.24em] disabled:opacity-50"
                style={{
                  background: gold,
                  color: '#0a0a0a',
                  fontFamily: '"DM Sans", sans-serif',
                }}
              >
                {isDeploying ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <>
                    <span>Publish Your Website</span>
                    <span
                      className="font-extrabold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(10,10,10,0.18)', color: '#0a0a0a' }}
                    >
                      {ctaPrice}
                    </span>
                    <ArrowRight size={14} />
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
        );
      })()}

      {/* Custom-design checkout — single screen (the old 3-step wizard
          collapsed to just the final step, straight into Stripe). Premium
          editorial treatment matching the How-It-Works modal: cream + gold
          on warm dark, serif italic headline, hairline list. */}
      {showCustomWizard && (() => {
        const gold = '#e8c074';
        const cream = '#ece6da';

        return (
          <div
            className="fixed inset-0 z-[210] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 md:p-6"
            onClick={closeCustomWizard}
          >
            <div
              className="relative w-full max-w-md max-h-[92vh] overflow-y-auto border border-white/10 shadow-2xl animate-[modalIn_0.3s_ease-out]"
              style={{
                background: 'linear-gradient(180deg, #0a0a0a 0%, #14110c 100%)',
                fontFamily: '"DM Sans", sans-serif',
                color: cream,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={closeCustomWizard}
                aria-label="Close"
                className="absolute top-3 right-3 z-10 p-1 text-white/40 hover:text-white transition"
              >
                <X size={16} />
              </button>

              <div className="px-6 pt-8 pb-6 md:px-8 md:pt-9 md:pb-7">
                {/* Eyebrow — hairline + label (no step numbering) */}
                <div className="flex items-center gap-3 mb-5">
                  <span className="h-px w-5" style={{ background: gold }} />
                  <span className="text-[10px] font-medium uppercase tracking-[0.32em]" style={{ color: gold }}>
                    Get Started
                  </span>
                  <span className="h-px flex-1" style={{ background: 'rgba(232,192,116,0.2)' }} />
                </div>

                {/* Checkout — the one and only screen */}
                  <div>
                    <h2
                      className="leading-[1.05] mb-3"
                      style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.9rem', fontWeight: 400 }}
                    >
                      <span style={{ color: cream }}>All in for </span>
                      <span style={{ color: gold, fontStyle: 'italic' }}>{customPriceFull}.</span>
                    </h2>
                    <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgba(236,230,218,0.6)' }}>
                      Your real photos, your own booking link. One simple price. Cancel anytime. After checkout, a short form captures your style and the photos to use.
                    </p>

                    <p className="text-[14.5px] leading-snug font-bold mb-4" style={{ color: cream }}>
                      You get access to your barbershop account — so you can edit the text and images almost anytime.
                    </p>

                    <div className="border-t border-white/10 mb-5">
                      {[
                        'Custom Barbershop Website — 20+ Pages',
                        'Multiple pages',
                        'Booking integration',
                        'You can have us add your custom photos',
                      ].map((line, i) => (
                        <div key={line} className="flex items-baseline gap-4 py-2.5 border-b border-white/10">
                          <span
                            className="shrink-0 text-[10px] tracking-[0.18em] w-5"
                            style={{ color: gold, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}
                          >
                            {['I', 'II', 'III', 'IV'][i]}
                          </span>
                          <span className="text-[14px] leading-snug" style={{ color: cream }}>{line}</span>
                        </div>
                      ))}
                    </div>

                    {/* Price + CTA — solid gold, uppercase */}
                    <div className="text-center mb-3">
                      <p
                        className="leading-none"
                        style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.5rem', color: cream, fontWeight: 400 }}
                      >
                        <span style={{ color: gold, fontStyle: 'italic' }}>{customPriceFull}</span>
                        <span style={{ color: 'rgba(236,230,218,0.55)', fontSize: '0.85rem', fontFamily: '"DM Sans", sans-serif', marginLeft: '0.4em' }}>
                          — all in
                        </span>
                      </p>
                    </div>

                    {customEmbedSecret && STRIPE_PK ? (
                      <div className="rounded-md overflow-hidden bg-white" style={{ minHeight: 360 }}>
                        <EmbeddedCheckoutProvider
                          key={customEmbedSecret}
                          stripe={getStripe()}
                          options={{ clientSecret: customEmbedSecret }}
                        >
                          <EmbeddedCheckout />
                        </EmbeddedCheckoutProvider>
                      </div>
                    ) : customEmbedError ? (
                      <div className="rounded-md px-4 py-5 text-center text-[12px]" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.4)', color: '#fecaca' }}>
                        {customEmbedError}
                        <button
                          type="button"
                          onClick={handleCustomCheckout}
                          className="block mx-auto mt-2 text-[11px] underline"
                          style={{ color: '#fecaca' }}
                        >
                          Try again
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleCustomCheckout}
                        disabled={isCustomCheckingOut}
                        className="flex w-full items-center justify-center gap-2 py-3.5 text-[11px] font-bold uppercase tracking-[0.24em] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                        style={{
                          background: gold,
                          color: '#0a0a0a',
                          fontFamily: '"DM Sans", sans-serif',
                        }}
                      >
                        {isCustomCheckingOut ? (
                          <Loader2 className="animate-spin" size={15} />
                        ) : (
                          <>
                            Continue · {customPriceLabel}
                            <ArrowRight size={13} />
                          </>
                        )}
                      </button>
                    )}
                    <p className="mt-2 text-center text-[9px] uppercase tracking-[0.22em]" style={{ color: 'rgba(236,230,218,0.4)' }}>
                      Secure checkout · Stripe · Cancel anytime
                    </p>
                  </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── Benefits Modal w/ Embedded Stripe Checkout ──────────
          Intercepts Launch My Site on every AI-Barber subpage when
          STRIPE_PK is available. 5 tight bullets at the top, monthly/
          yearly toggle, then the Stripe payment form embedded inline
          (no redirect to checkout.stripe.com). */}
      {showBenefits && (() => {
        const cream = '#ece6da';
        const gold = '#e8c074';
        const monthlyLabel = stdMonthlyPriceMo;
        const yearlyLabel = `$${stdYearlyPriceDollars}/yr`;
        const benefits: string[] = [
          'Edit your text and photos anytime',
          'Your site is saved to your own account',
          'Goes live in seconds — share the link right away',
          'Use it on Google, Instagram, or in your text messages',
          'One small fee · cancel anytime · no contract',
        ];

        return (
          <div
            className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-md overflow-y-auto"
            onClick={() => setShowBenefits(false)}
          >
            {/* min-h-full wrapper lets items-center center short modals
                AND lets tall modals top-align with scroll. Without
                this, desktop centering clips the top off-screen. */}
            <div className="flex min-h-full items-start md:items-center justify-center p-3 md:p-4">
            <div
              className="relative w-full max-w-md my-2 md:my-6 border border-white/10 shadow-2xl animate-[modalIn_0.3s_ease-out]"
              style={{
                background: 'linear-gradient(180deg, #0a0a0a 0%, #14110c 100%)',
                fontFamily: '"DM Sans", sans-serif',
                color: cream,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowBenefits(false)}
                aria-label="Close"
                className="absolute top-3 right-3 z-10 p-1 text-white/40 hover:text-white transition"
              >
                <X size={16} />
              </button>

              <div className="px-5 pt-5 pb-5 md:px-6 md:pt-5 md:pb-5">
                <div className="flex items-center gap-2.5 mb-2.5">
                  <span className="h-px w-4" style={{ background: gold }} />
                  <span className="text-[9px] font-medium uppercase tracking-[0.32em]" style={{ color: gold }}>
                    Here's what you get
                  </span>
                  <span className="h-px flex-1" style={{ background: `${gold}33` }} />
                </div>

                <h2
                  className="leading-[1.05] mb-2"
                  style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.35rem', fontWeight: 400 }}
                >
                  <span style={{ color: cream }}>A website for </span>
                  <span style={{ color: gold, fontStyle: 'italic' }}>your barbershop.</span>
                </h2>

                <ul className="mb-3 space-y-1 md:space-y-0.5">
                  {benefits.map((line, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] md:text-[11.5px] leading-snug" style={{ color: cream }}>
                      <span
                        className="mt-[6px] h-[4px] w-[4px] shrink-0 rounded-full"
                        style={{ background: gold }}
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-center gap-4 mb-2.5">
                  <button
                    onClick={() => setPricingPlan('monthly')}
                    className="text-[10px] font-medium uppercase tracking-[0.22em] pb-1 transition-colors"
                    style={{
                      color: pricingPlan === 'monthly' ? cream : 'rgba(236,230,218,0.4)',
                      borderBottom: pricingPlan === 'monthly' ? `1px solid ${gold}` : '1px solid transparent',
                    }}
                  >
                    Monthly · {monthlyLabel}
                  </button>
                  <button
                    onClick={() => setPricingPlan('yearly')}
                    className="text-[10px] font-medium uppercase tracking-[0.22em] pb-1 transition-colors"
                    style={{
                      color: pricingPlan === 'yearly' ? cream : 'rgba(236,230,218,0.4)',
                      borderBottom: pricingPlan === 'yearly' ? `1px solid ${gold}` : '1px solid transparent',
                    }}
                  >
                    Yearly · {yearlyLabel} <span style={{ color: '#ffffff', fontWeight: 700 }}>(Save {stdYearlyDiscountPct}%)</span>
                  </button>
                </div>

                <div className="rounded-md overflow-hidden bg-white" style={{ minHeight: 360 }}>
                  {embedError ? (
                    <div className="px-4 py-6 text-center text-[12px] text-red-600">
                      {embedError}
                      <button
                        type="button"
                        onClick={() => fetchEmbeddedSecret(pricingPlan === 'monthly' ? stdMonthlyPlan : stdYearlyPlan)}
                        className="block mx-auto mt-2 text-[11px] underline"
                      >
                        Try again
                      </button>
                    </div>
                  ) : !embedSecret ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="animate-spin text-gray-500" size={20} />
                    </div>
                  ) : (
                    <EmbeddedCheckoutProvider
                      key={embedSecret}
                      stripe={getStripe()}
                      options={{ clientSecret: embedSecret }}
                    >
                      <EmbeddedCheckout />
                    </EmbeddedCheckoutProvider>
                  )}
                </div>

                <p className="mt-3 text-center text-[9px] uppercase tracking-[0.22em]" style={{ color: 'rgba(236,230,218,0.4)' }}>
                  Secure checkout · Powered by Stripe
                </p>
              </div>
            </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
};

export default PrePaymentBanner;
