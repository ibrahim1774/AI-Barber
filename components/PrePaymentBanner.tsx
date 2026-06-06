import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Rocket, Loader2, Sparkles, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { isFiveDealPath, isSevenDealPath, isBooksyPath } from '../lib/dealMode.ts';

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
  // 'monthly-booksy' = $5/mo via /booksy import flow (anchor $7); other monthly
  // entry paths use 'monthly' ($9/mo). Server-side routes both into
  // the same hosting product, different Stripe unit_amount.
  onDeploy: (plan: 'monthly' | 'monthly-booksy' | 'yearly' | 'five' | 'seven') => void;
  isDeploying: boolean;
  industry?: string;
}

const PrePaymentBanner: React.FC<PrePaymentBannerProps> = ({ onDeploy, isDeploying, industry }) => {
  // /5 and /7 lock the visitor into a hard $5/mo or $7/mo flow — no
  // yearly toggle. Computed once on mount; URL doesn't change in-session.
  const fiveDeal = React.useMemo(() => isFiveDealPath(), []);
  const sevenDeal = React.useMemo(() => isSevenDealPath(), []);
  // /booksy import flow runs at premium pricing ($10/mo + $19 custom)
  // because the AI-fill-from-link service is more valuable than the
  // manual lead-quiz funnel. dealMode (5/7) still wins when both apply.
  const booksyMode = React.useMemo(() => isBooksyPath(), []);
  // Either deal-mode collapses the pricing UI the same way; only the
  // numbers shown and the plan string sent to Stripe differ.
  const dealMode = fiveDeal || sevenDeal;
  const dealPlan: 'five' | 'seven' | null = fiveDeal ? 'five' : sevenDeal ? 'seven' : null;
  const dealPriceMo = sevenDeal ? '$7/mo' : '$5/mo';
  const dealPriceMonth = sevenDeal ? '$7/month' : '$5/month';

  // Standard monthly price varies by entry path:
  //   /5 / /7      → handled by dealMode branches
  //   /booksy      → $5/mo with $7 anchor (plan 'monthly-booksy')
  //   everywhere   → $9/mo  (plan 'monthly')
  const stdMonthlyPriceMo = booksyMode ? '$5/mo' : '$9/mo';
  const stdMonthlyPriceMonth = booksyMode ? '$5/month' : '$9/month';
  // Anchor price displayed strikethrough beside the live price for
  // /booksy only — visual "was $7, now $5" framing on the Publish CTA.
  const booksyAnchorMo = '$7/mo';
  const stdMonthlyPlan: 'monthly' | 'monthly-booksy' = booksyMode ? 'monthly-booksy' : 'monthly';

  // Custom-design upsell. The /5 launch-special drops the custom
  // price to $15/mo to keep the relative gap small; /booksy stays at
  // the legacy $19/mo; everywhere else dropped to $11/mo. Plan slug
  // routes server-side:
  //   custom15      → $15/mo (only fiveDeal)
  //   custom-booksy → $19/mo (/booksy)
  //   custom        → $11/mo (sevenDeal)
  //   custom25      → $11/mo (standard)
  const customPlan: 'custom' | 'custom25' | 'custom15' | 'custom-booksy' = fiveDeal
    ? 'custom15'
    : booksyMode
      ? 'custom-booksy'
      : (dealMode ? 'custom' : 'custom25');
  const customPriceLabel = fiveDeal ? '$15/mo' : booksyMode ? '$19/mo' : '$11/mo';
  const customPriceFull = fiveDeal ? '$15/month' : booksyMode ? '$19/month' : '$11/month';

  const [isDismissed, setIsDismissed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showCustomWizard, setShowCustomWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [isCustomCheckingOut, setIsCustomCheckingOut] = useState(false);
  const [pricingPlan, setPricingPlan] = useState<'monthly' | 'yearly'>('monthly');

  // Cancel any in-flight checkout fetch when the wizard is closed so the
  // step-4 button doesn't stay stuck in its loading state on reopen.
  const customCheckoutAbortRef = React.useRef<AbortController | null>(null);

  // Kicks off the custom-design Stripe checkout. Flat $11/mo —
  // determined by the page the visitor is on. After success the backend
  // routes the customer to the Google Form to capture preferences.
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
      // Custom-design InitiateCheckout amount mirrors the price label
      // shown above the button — keeps Meta/TikTok ROAS math aligned
      // with what Stripe actually charges.
      const checkoutValue = fiveDeal ? 15 : booksyMode ? 19 : 11;
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
        }),
      }).catch(err => console.error('[TikTok CAPI InitiateCheckout - Custom] Failed:', err));
    } catch (e) {
      console.error('[InitiateCheckout - Custom] Tracking failed:', e);
    }

    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'custom-design-request', plan: customPlan }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to create custom-design checkout');
      }
      window.location.href = data.url;
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user closed wizard mid-flight
      console.error('[Custom Design] checkout error:', err);
      alert(err.message || 'Could not start checkout. Please try again.');
      setIsCustomCheckingOut(false);
    }
  };

  const closeCustomWizard = () => {
    customCheckoutAbortRef.current?.abort();
    customCheckoutAbortRef.current = null;
    setShowCustomWizard(false);
    setWizardStep(0);
    setIsCustomCheckingOut(false);
  };

  const displayIndustry = industry || 'barbershop';

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showHowItWorks || showCustomWizard) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showHowItWorks, showCustomWizard]);

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

          {/* Monthly / Yearly toggle — quieter, smaller. Hidden in /5 + /7. */}
          {!dealMode && (
            <div className="flex items-center justify-center gap-5 mb-2.5">
              <button
                onClick={() => setPricingPlan('monthly')}
                className="text-[9px] font-medium uppercase tracking-[0.22em] pb-0.5 transition-colors"
                style={{
                  color: pricingPlan === 'monthly' ? '#ece6da' : 'rgba(236,230,218,0.4)',
                  borderBottom: pricingPlan === 'monthly' ? '1px solid #e8c074' : '1px solid transparent',
                }}
              >
                Monthly
              </button>
              <button
                onClick={() => setPricingPlan('yearly')}
                className="text-[9px] font-medium uppercase tracking-[0.22em] pb-0.5 transition-colors"
                style={{
                  color: pricingPlan === 'yearly' ? '#ece6da' : 'rgba(236,230,218,0.4)',
                  borderBottom: pricingPlan === 'yearly' ? '1px solid #e8c074' : '1px solid transparent',
                }}
              >
                Yearly <span style={{ color: '#e8c074' }}>−40%</span>
              </button>
            </div>
          )}

          {/* Action row — buttons bumped ~10% + bolded */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHowItWorks(true)}
              className="flex-1 py-2.5 text-[10px] font-bold border hover:border-white/40 hover:text-white transition-colors uppercase tracking-[0.24em] text-center"
              style={{
                color: '#ece6da',
                borderColor: 'rgba(236,230,218,0.25)',
                fontFamily: '"DM Sans", sans-serif',
              }}
            >
              How It Works
            </button>

            <button
              onClick={() => onDeploy(dealPlan ?? (pricingPlan === 'monthly' ? stdMonthlyPlan : pricingPlan))}
              disabled={isDeploying}
              className="flex-1 py-2.5 text-[10px] font-bold flex items-center justify-center gap-1.5 hover:opacity-90 active:scale-[0.98] transition-all uppercase tracking-[0.24em] disabled:opacity-50"
              style={{
                background: '#e8c074',
                color: '#0a0a0a',
                fontFamily: '"DM Sans", sans-serif',
              }}
            >
              {isDeploying ? (
                <Loader2 className="animate-spin" size={12} />
              ) : (
                <Rocket size={12} />
              )}
              <span>Launch My Site</span>
              {booksyMode && pricingPlan === 'monthly' ? (
                <>
                  <span className="opacity-60 line-through font-medium">{booksyAnchorMo}</span>
                  <span
                    className="font-extrabold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(10,10,10,0.18)', color: '#0a0a0a' }}
                  >
                    {stdMonthlyPriceMonth}
                  </span>
                </>
              ) : (
                <span
                  className="font-extrabold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(10,10,10,0.18)', color: '#0a0a0a' }}
                >
                  {dealMode ? dealPriceMo : (pricingPlan === 'yearly' ? '$72/year' : stdMonthlyPriceMonth)}
                </span>
              )}
            </button>
          </div>

          {/* "Don't like the design?" — highlighted gold-tinted box.
              Headline in serif italic gold, concise subtitle beneath
              explaining the offer. Price + arrow anchored right. */}
          <button
            type="button"
            onClick={() => { setWizardStep(0); setShowCustomWizard(true); }}
            className="group mt-2.5 flex w-full items-center justify-between gap-3 px-3 py-2 border transition-all hover:border-[#e8c074]/70"
            style={{
              background: 'linear-gradient(180deg, rgba(232,192,116,0.06) 0%, rgba(232,192,116,0.02) 100%)',
              borderColor: 'rgba(232,192,116,0.35)',
              color: '#ece6da',
              textAlign: 'left',
            }}
          >
            <span className="flex items-start gap-2 min-w-0">
              <Sparkles size={12} className="mt-[3px] shrink-0" style={{ color: '#e8c074' }} />
              <span className="min-w-0">
                <span
                  className="block font-extrabold"
                  style={{ fontSize: '0.95rem', color: '#e8c074', lineHeight: 1.15, letterSpacing: '-0.005em' }}
                >
                  Want a new {displayIndustry.toLowerCase()} website instead?
                </span>
                <span
                  className="block font-bold leading-snug mt-0.5"
                  style={{ fontSize: '11.5px', color: 'rgba(236,230,218,0.92)' }}
                >
                  Choose a design, or let our team custom-build a different multi-page site for you.
                </span>
              </span>
            </span>
            <span
              className="flex items-center gap-1.5 text-[12px] font-black uppercase tracking-[0.16em] shrink-0 rounded-full px-2.5 py-[4px]"
              style={{
                color: '#0a0a0a',
                background: '#e8c074',
                boxShadow: '0 0 0 1.5px rgba(232,192,116,0.7), 0 4px 14px -3px rgba(232,192,116,0.65)',
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
        const headlinePrice = dealMode
          ? dealPriceMo
          : pricingPlan === 'yearly' ? '$72/yr' : stdMonthlyPriceMo;
        const ctaPrice = dealMode
          ? dealPriceMo
          : pricingPlan === 'yearly' ? '$72/year' : stdMonthlyPriceMonth;

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

            {/* Monthly / Yearly toggle — quiet text-based with gold underline,
                hidden when locked to /5 or /7 deal pricing */}
            {!dealMode && (
              <div className="flex items-center justify-center gap-6 mb-7">
                <button
                  onClick={() => setPricingPlan('monthly')}
                  className="text-[11px] font-medium uppercase tracking-[0.22em] pb-1.5 transition-colors"
                  style={{
                    color: pricingPlan === 'monthly' ? cream : 'rgba(236,230,218,0.4)',
                    borderBottom: pricingPlan === 'monthly' ? `1px solid ${gold}` : '1px solid transparent',
                  }}
                >
                  Monthly · {stdMonthlyPriceMo}
                </button>
                <button
                  onClick={() => setPricingPlan('yearly')}
                  className="text-[11px] font-medium uppercase tracking-[0.22em] pb-1.5 transition-colors"
                  style={{
                    color: pricingPlan === 'yearly' ? cream : 'rgba(236,230,218,0.4)',
                    borderBottom: pricingPlan === 'yearly' ? `1px solid ${gold}` : '1px solid transparent',
                  }}
                >
                  Yearly · $72/yr <span style={{ color: gold }}>−40%</span>
                </button>
              </div>
            )}

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
                {!dealMode && pricingPlan === 'yearly' && (
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
                onClick={() => { setShowHowItWorks(false); onDeploy(dealPlan ?? (pricingPlan === 'monthly' ? stdMonthlyPlan : pricingPlan)); }}
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
                    <span>Launch My Site</span>
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

      {/* Multi-step custom-design wizard — premium editorial treatment
          matching the How-It-Works modal: cream + gold on warm dark,
          serif italic headlines, hairline lists, sharper corners. */}
      {showCustomWizard && (() => {
        const totalSteps = 3;
        const gold = '#e8c074';
        const cream = '#ece6da';
        const next = () => setWizardStep((s) => Math.min(totalSteps - 1, s + 1));
        const back = () => setWizardStep((s) => Math.max(0, s - 1));

        const stepEyebrows = ['Custom Design', 'Pages & Booking', 'Get Started'];
        const stepNumerals = ['I', 'II', 'III'];

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

              {/* Progress dots — gold, thin */}
              <div className="flex items-center justify-center gap-1.5 pt-6 pb-1">
                {Array.from({ length: totalSteps }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Step ${i + 1}`}
                    onClick={() => setWizardStep(i)}
                    className={`h-[2px] transition-all ${
                      i === wizardStep ? 'w-8' : i < wizardStep ? 'w-4' : 'w-4'
                    }`}
                    style={{
                      background: i === wizardStep ? gold : i < wizardStep ? 'rgba(232,192,116,0.5)' : 'rgba(236,230,218,0.15)',
                    }}
                  />
                ))}
              </div>

              <div className="px-6 pt-4 pb-6 md:px-8 md:pt-5 md:pb-7">
                {/* Eyebrow — hairline + label, consistent across steps */}
                <div className="flex items-center gap-3 mb-5">
                  <span className="h-px w-5" style={{ background: gold }} />
                  <span
                    className="shrink-0 text-[10px] tracking-[0.18em]"
                    style={{ color: gold, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}
                  >
                    {stepNumerals[wizardStep]}
                  </span>
                  <span className="text-[10px] font-medium uppercase tracking-[0.32em]" style={{ color: gold }}>
                    {stepEyebrows[wizardStep]}
                  </span>
                  <span className="h-px flex-1" style={{ background: 'rgba(232,192,116,0.2)' }} />
                </div>

                {/* Step 1 — Pitch */}
                {wizardStep === 0 && (
                  <div>
                    <h2
                      className="leading-[1.05] mb-3"
                      style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.9rem', fontWeight: 400 }}
                    >
                      <span style={{ color: cream }}>A site built </span>
                      <span style={{ color: gold, fontStyle: 'italic' }}>around your shop.</span>
                    </h2>
                    <p className="text-sm leading-relaxed mb-5" style={{ color: 'rgba(236,230,218,0.6)' }}>
                      Not loving the template? We'll design a site from scratch around your brand and your vibe — your real photos, your own booking link, flat {customPriceFull}.
                    </p>
                    <div className="border-t border-white/10">
                      {[
                        'Built from scratch for your shop',
                        'Choose the design you like',
                        'Multiple pages + booking links included',
                      ].map((line, i) => (
                        <div key={line} className="flex items-baseline gap-4 py-3 border-b border-white/10">
                          <span
                            className="shrink-0 text-[10px] tracking-[0.18em] w-5"
                            style={{ color: gold, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}
                          >
                            {['I', 'II', 'III'][i]}
                          </span>
                          <span className="text-[14px] leading-snug" style={{ color: cream }}>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 2 — Pages & Booking */}
                {wizardStep === 1 && (
                  <div>
                    <h2
                      className="leading-[1.05] mb-3"
                      style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.9rem', fontWeight: 400 }}
                    >
                      <span style={{ color: cream }}>Your custom </span>
                      <span style={{ color: gold, fontStyle: 'italic' }}>booking link, built in.</span>
                    </h2>
                    <p className="text-sm leading-relaxed mb-5" style={{ color: 'rgba(236,230,218,0.6)' }}>
                      Separate pages, real photos, and your own booking link — not one long scroll.
                    </p>
                    <div className="border-t border-white/10">
                      {[
                        'Home · Services · About · Gallery · Contact',
                        'Calendly, Acuity, Booksy — your choice',
                        'Custom photography sourced or your own',
                      ].map((line, i) => (
                        <div key={line} className="flex items-baseline gap-4 py-3 border-b border-white/10">
                          <span
                            className="shrink-0 text-[10px] tracking-[0.18em] w-5"
                            style={{ color: gold, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}
                          >
                            {['I', 'II', 'III'][i]}
                          </span>
                          <span className="text-[14px] leading-snug" style={{ color: cream }}>{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 3 — Checkout */}
                {wizardStep === 2 && (
                  <div>
                    <h2
                      className="leading-[1.05] mb-3"
                      style={{ fontFamily: '"Instrument Serif", serif', fontSize: '1.9rem', fontWeight: 400 }}
                    >
                      <span style={{ color: cream }}>All in for </span>
                      <span style={{ color: gold, fontStyle: 'italic' }}>{customPriceFull}.</span>
                    </h2>
                    <p className="text-sm leading-relaxed mb-5" style={{ color: 'rgba(236,230,218,0.6)' }}>
                      You may choose the design you like — your real photos, your own booking link. One simple price. Cancel anytime. After checkout, a short form captures your style and the photos to use.
                    </p>

                    <div className="border-t border-white/10 mb-5">
                      {[
                        'Custom design, built from scratch',
                        'Choose the design you like',
                        'Multiple pages',
                        'Booking integration',
                        'You can have us add your custom photos',
                      ].map((line, i) => (
                        <div key={line} className="flex items-baseline gap-4 py-2.5 border-b border-white/10">
                          <span
                            className="shrink-0 text-[10px] tracking-[0.18em] w-5"
                            style={{ color: gold, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}
                          >
                            {['I', 'II', 'III', 'IV', 'V'][i]}
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
                    <p className="mt-2 text-center text-[9px] uppercase tracking-[0.22em]" style={{ color: 'rgba(236,230,218,0.4)' }}>
                      Secure checkout · Stripe · Cancel anytime
                    </p>
                  </div>
                )}

                {/* Wizard navigation — quieter */}
                <div className="mt-6 flex items-center justify-between pt-4 border-t" style={{ borderColor: 'rgba(232,192,116,0.18)' }}>
                  <button
                    type="button"
                    onClick={back}
                    disabled={wizardStep === 0}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-[0.24em] transition disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ color: 'rgba(236,230,218,0.6)' }}
                  >
                    <ChevronLeft size={12} />
                    Back
                  </button>
                  <span className="text-[9px] uppercase tracking-[0.28em]" style={{ color: 'rgba(236,230,218,0.4)' }}>
                    {wizardStep + 1} / {totalSteps}
                  </span>
                  {wizardStep < totalSteps - 1 ? (
                    <button
                      type="button"
                      onClick={next}
                      className="flex items-center gap-1 text-[10px] uppercase tracking-[0.24em] transition"
                      style={{ color: gold }}
                    >
                      Next
                      <ChevronRight size={12} />
                    </button>
                  ) : (
                    <span className="text-[9px] uppercase tracking-[0.28em]" style={{ color: 'rgba(236,230,218,0.4)' }}>Last step</span>
                  )}
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
