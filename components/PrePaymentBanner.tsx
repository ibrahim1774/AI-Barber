import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Rocket, Loader2, Sparkles, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { isFiveDealPath } from '../lib/dealMode.ts';

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
  onDeploy: (plan: 'monthly' | 'yearly' | 'five') => void;
  isDeploying: boolean;
  industry?: string;
}

const PrePaymentBanner: React.FC<PrePaymentBannerProps> = ({ onDeploy, isDeploying, industry }) => {
  // /5 lands the visitor on a hard-locked $5/mo flow — no yearly toggle.
  // Computed once on mount; URL doesn't change within a session.
  const fiveDeal = React.useMemo(() => isFiveDealPath(), []);

  const [isDismissed, setIsDismissed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showCustomWizard, setShowCustomWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [isCustomCheckingOut, setIsCustomCheckingOut] = useState(false);
  const [pricingPlan, setPricingPlan] = useState<'monthly' | 'yearly'>('monthly');

  // Kicks off the $20/mo custom-design Stripe checkout. After success the
  // backend routes the customer to the Google Form to capture their
  // design preferences (style, booking provider, photos, etc).
  const handleCustomCheckout = async () => {
    setIsCustomCheckingOut(true);
    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: 'custom-design-request', plan: 'custom' }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.error || 'Failed to create custom-design checkout');
      }
      window.location.href = data.url;
    } catch (err: any) {
      console.error('[Custom Design] checkout error:', err);
      alert(err.message || 'Could not start checkout. Please try again.');
      setIsCustomCheckingOut(false);
    }
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
      <div
        className={`fixed bottom-0 left-0 right-0 z-[100] transition-transform duration-700 ease-out ${
          isVisible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div
          className="relative p-4 md:p-5 shadow-[0_-8px_30px_rgba(0,0,0,0.3)]"
          style={{
            background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
            fontFamily: '"DM Sans", sans-serif',
          }}
        >
          <button
            onClick={() => setIsDismissed(true)}
            className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>

          <div className="flex items-start gap-3 mb-3 pr-8">
            <div className="relative mt-1.5 shrink-0">
              <div className="w-2.5 h-2.5 bg-[#f4a100] rounded-full" />
              <div className="absolute inset-0 w-2.5 h-2.5 bg-[#f4a100] rounded-full animate-ping" />
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">
              {fiveDeal ? (
                <>
                  Special launch price — <span className="text-white font-bold">$5/month</span> for hosting. Edit your text and images anytime with a free account.
                </>
              ) : (
                <>
                  Just {pricingPlan === 'yearly' ? <><span className="text-white font-bold">$72/year</span> <span className="text-gray-500 line-through text-xs">$120/yr</span> — save 40%</> : <><span className="text-white font-bold">$10/month</span></>} for hosting. Edit your text and images anytime with a free account — and if you want a new design, we'll make one just for your shop.
                </>
              )}
            </p>
          </div>

          {/* Monthly / Yearly Toggle — hidden in /5 deal mode */}
          {!fiveDeal && (
            <div className="flex items-center justify-center gap-1 mb-3 bg-white/5 rounded-xl p-1">
              <button
                onClick={() => setPricingPlan('monthly')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${pricingPlan === 'monthly' ? 'bg-[#f4a100] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setPricingPlan('yearly')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${pricingPlan === 'yearly' ? 'bg-[#f4a100] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
              >
                Yearly <span className="text-[10px] opacity-80">(-40%)</span>
              </button>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHowItWorks(true)}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white border border-white/20 hover:bg-white/10 transition-colors uppercase tracking-wider text-center"
            >
              How It Works
            </button>

            <button
              onClick={() => onDeploy(fiveDeal ? 'five' : pricingPlan)}
              disabled={isDeploying}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 shadow-lg shadow-[#f4a100]/20 hover:opacity-90 active:scale-[0.97] transition-all uppercase tracking-wider disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #f4a100 0%, #d4890e 100%)',
              }}
            >
              {isDeploying ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Rocket size={14} />
              )}
              {fiveDeal ? 'Publish — $5/mo' : (pricingPlan === 'yearly' ? 'Publish — $72/yr' : 'Publish — $10/mo')}
            </button>
          </div>

          {/* /5-only — "Don't like the design? Get a custom one for $20/mo".
              Lives in the sticky banner itself, below the How It Works /
              Publish row, so it's visible without opening any modal. */}
          {fiveDeal && (
            <button
              type="button"
              onClick={() => { setWizardStep(0); setShowCustomWizard(true); }}
              className="group mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#e8c074]/30 bg-[#e8c074]/5 px-4 py-3 text-sm text-gray-200 transition hover:border-[#e8c074]/60 hover:bg-[#e8c074]/10 hover:text-white"
            >
              <Sparkles size={15} className="text-[#e8c074]" />
              <span>
                Don't like the design? Get a custom one —{' '}
                <span className="font-semibold text-[#e8c074]">$20/mo</span>
              </span>
              <ArrowRight size={14} className="text-[#e8c074] transition group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      </div>

      {showHowItWorks && (
        <div
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 md:p-6"
          onClick={() => setShowHowItWorks(false)}
        >
          <div
            className="relative max-w-lg w-full max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 p-4 md:p-6 shadow-2xl animate-[modalIn_0.3s_ease-out]"
            style={{
              background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
              fontFamily: '"DM Sans", sans-serif',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowHowItWorks(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-2 mb-2">
              <div className="relative">
                <div className="w-2 h-2 bg-[#f4a100] rounded-full" />
                <div className="absolute inset-0 w-2 h-2 bg-[#f4a100] rounded-full animate-ping" />
              </div>
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#f4a100]">
                How It Works
              </span>
            </div>

            <h2 className="text-xl md:text-2xl font-bold text-white mb-1 leading-tight">
              Your Fully Custom Website —{' '}
              <span style={{ fontFamily: '"Instrument Serif", serif' }} className="text-[#f4a100]">
                {pricingPlan === 'yearly' ? <>Just $72/yr <span className="text-gray-500 line-through text-base">$120/yr</span></> : 'Just $10/mo'}
              </span>
            </h2>

            <p className="text-gray-400 text-sm mb-3 leading-relaxed">
              Publish your site and get full account access — edit text and swap images anytime from your account
            </p>

            {/* Monthly / Yearly Toggle (modal) */}
            <div className="flex items-center justify-center gap-1 mb-3 bg-white/5 rounded-xl p-1">
              <button
                onClick={() => setPricingPlan('monthly')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${pricingPlan === 'monthly' ? 'bg-[#f4a100] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
              >
                Monthly — $10/mo
              </button>
              <button
                onClick={() => setPricingPlan('yearly')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${pricingPlan === 'yearly' ? 'bg-[#f4a100] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
              >
                Yearly — $72/yr <span className="text-[10px] opacity-80">(-40%)</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-gray-500 mt-0.5">01</span>
                  <div>
                    <h3 className="text-white font-bold text-sm">
                      <span className="mr-1.5">🎨</span>Professional & Modern Website
                    </h3>
                    <p className="text-gray-400 text-xs leading-snug">
                      A clean, modern website built for your {displayIndustry} business — fully customizable.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-gray-500 mt-0.5">02</span>
                  <div>
                    <h3 className="text-white font-bold text-sm">
                      <span className="mr-1.5">🔧</span>Account Access
                    </h3>
                    <p className="text-gray-400 text-xs leading-snug">
                      Create an account to swap images, change text, and update your page anytime.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-gray-500 mt-0.5">03</span>
                  <div>
                    <h3 className="text-white font-bold text-sm">
                      <span className="mr-1.5">💰</span>Save Time & Money
                    </h3>
                    <p className="text-gray-400 text-xs leading-snug">
                      No developer needed. Just a small monthly hosting fee — everything else is handled.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-2 px-3 mt-1.5 flex items-center justify-between gap-2">
              <p className="text-white font-bold text-sm shrink-0" style={{ fontFamily: '"Instrument Serif", serif' }}>
                {pricingPlan === 'yearly' ? <><span className="text-gray-500 line-through text-xs" style={{ fontFamily: '"DM Sans", sans-serif' }}>$120/yr</span> $72/yr</> : '$10/mo'} —{' '}
                <span className="text-gray-400 font-normal text-xs" style={{ fontFamily: '"DM Sans", sans-serif' }}>
                  hosting only
                </span>
              </p>
              <div className="flex gap-x-1.5 text-[10px] text-gray-500">
                <span>No fees</span>
                <span>•</span>
                <span>No contracts</span>
                <span>•</span>
                <span>Cancel anytime</span>
              </div>
            </div>

            <button
              onClick={() => { setShowHowItWorks(false); onDeploy(fiveDeal ? 'five' : pricingPlan); }}
              disabled={isDeploying}
              className="w-full mt-2 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg shadow-[#f4a100]/20 hover:opacity-90 active:scale-[0.97] transition-all uppercase tracking-wider disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #f4a100 0%, #d4890e 100%)',
              }}
            >
              {isDeploying ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  {fiveDeal ? 'Publish My Site — $5/mo' : (pricingPlan === 'yearly' ? 'Publish My Site — $72/yr' : 'Publish My Site — $10/mo')}
                  <ArrowRight size={18} />
                </>
              )}
            </button>

          </div>
        </div>
      )}

      {/* Multi-step custom-design wizard — only triggerable from /5 */}
      {showCustomWizard && (() => {
        const totalSteps = 4;
        const close = () => { setShowCustomWizard(false); setWizardStep(0); };
        const next = () => setWizardStep((s) => Math.min(totalSteps - 1, s + 1));
        const back = () => setWizardStep((s) => Math.max(0, s - 1));

        return (
          <div
            className="fixed inset-0 z-[210] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-6"
            onClick={close}
          >
            <div
              className="relative w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 shadow-2xl animate-[modalIn_0.3s_ease-out]"
              style={{
                background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)',
                fontFamily: '"DM Sans", sans-serif',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={close}
                aria-label="Close"
                className="absolute top-3 right-3 z-10 rounded-md p-1 text-gray-400 hover:bg-white/5 hover:text-white transition"
              >
                <X size={18} />
              </button>

              {/* Progress dots */}
              <div className="flex items-center justify-center gap-2 pt-5 pb-1">
                {Array.from({ length: totalSteps }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Step ${i + 1}`}
                    onClick={() => setWizardStep(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === wizardStep ? 'w-7 bg-[#e8c074]' : i < wizardStep ? 'w-3 bg-[#e8c074]/60' : 'w-3 bg-white/15'
                    }`}
                  />
                ))}
              </div>

              <div className="px-5 pt-3 pb-5 md:px-7 md:pt-4 md:pb-7">
                {/* Step 1 */}
                {wizardStep === 0 && (
                  <div>
                    <div className="overflow-hidden rounded-2xl border border-white/5 mb-4">
                      <img src={WIZARD_IMAGES.hero} alt="" className="h-44 w-full object-cover md:h-52" />
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles size={14} className="text-[#e8c074]" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e8c074]">
                        Custom Design
                      </span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold text-white leading-tight mb-2">
                      A custom website, designed for your shop.
                    </h2>
                    <p className="text-sm text-gray-400 leading-relaxed mb-4">
                      Not loving the template? We'll design a site from scratch around your brand, your barbers, and your vibe — for a flat $20 a month.
                    </p>
                    <ul className="space-y-2">
                      {[
                        'Get a custom design — built from scratch for your shop',
                        'You have the option to choose the look you like',
                        'Booking links + multiple pages included',
                      ].map((line) => (
                        <li key={line} className="flex items-start gap-2.5 text-sm text-gray-200">
                          <Check size={16} className="mt-0.5 shrink-0 text-[#e8c074]" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Step 2 */}
                {wizardStep === 1 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles size={14} className="text-[#e8c074]" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e8c074]">
                        Step 2 — Choose the Look
                      </span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold text-white leading-tight mb-1">
                      You have the option to choose the look you like.
                    </h2>
                    <p className="text-sm text-gray-400 leading-relaxed mb-4">
                      After checkout, you'll pick the design direction that fits your brand best. We'll build from your choice.
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {[
                        { label: 'Modern', img: WIZARD_IMAGES.modern },
                        { label: 'Editorial', img: WIZARD_IMAGES.editorial },
                        { label: 'Luxury', img: WIZARD_IMAGES.luxury },
                        { label: 'Minimal', img: WIZARD_IMAGES.minimal },
                      ].map((opt) => (
                        <div
                          key={opt.label}
                          className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5"
                        >
                          <img src={opt.img} alt={opt.label} className="h-24 w-full object-cover md:h-28" />
                          <div className="px-3 py-2">
                            <span className="text-xs font-bold uppercase tracking-[0.15em] text-white">
                              {opt.label}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 3 */}
                {wizardStep === 2 && (
                  <div>
                    <div className="overflow-hidden rounded-2xl border border-white/5 mb-4">
                      <img src={WIZARD_IMAGES.pages} alt="" className="h-40 w-full object-cover md:h-48" />
                    </div>
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles size={14} className="text-[#e8c074]" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e8c074]">
                        Step 3 — Pages & Booking
                      </span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold text-white leading-tight mb-2">
                      Multiple pages + booking links built in.
                    </h2>
                    <ul className="space-y-2 mb-4">
                      {[
                        'Home, Services, About, Gallery, Contact — separate pages, not one long scroll',
                        'Booking integrated (Calendly, Acuity, Square — your choice)',
                        'Custom photography sourced or your own uploaded',
                      ].map((line) => (
                        <li key={line} className="flex items-start gap-2.5 text-sm text-gray-200">
                          <Check size={16} className="mt-0.5 shrink-0 text-[#e8c074]" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="overflow-hidden rounded-xl border border-white/5">
                      <img src={WIZARD_IMAGES.booking} alt="" className="h-32 w-full object-cover md:h-36" />
                    </div>
                  </div>
                )}

                {/* Step 4 — Pricing + Checkout */}
                {wizardStep === 3 && (
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Sparkles size={14} className="text-[#e8c074]" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e8c074]">
                        Step 4 — Get Started
                      </span>
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold text-white leading-tight mb-2">
                      All in for{' '}
                      <span style={{ fontFamily: '"Instrument Serif", serif' }} className="text-[#e8c074]">
                        $20/month
                      </span>
                    </h2>
                    <p className="text-sm text-gray-400 leading-relaxed mb-4">
                      One simple price. Cancel anytime. After checkout, you'll fill a quick form so we know your style, booking provider, and photos to use.
                    </p>

                    <div className="space-y-2 mb-4">
                      {[
                        'Custom design from scratch',
                        'You choose the look you like',
                        'Multiple pages',
                        'Booking links included',
                        'Custom photos',
                      ].map((line) => (
                        <div key={line} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200">
                          <Check size={15} className="mt-0.5 shrink-0 text-[#e8c074]" />
                          <span>{line}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Total</p>
                        <p className="text-lg font-bold text-white" style={{ fontFamily: '"Instrument Serif", serif' }}>
                          $20/month
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Includes</p>
                        <p className="text-[11px] text-gray-300">Design · Pages · Booking · Photos</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleCustomCheckout}
                      disabled={isCustomCheckingOut}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#e8c074] to-[#d4a64a] py-3 text-sm font-bold uppercase tracking-wider text-[#1a1a1a] shadow-lg shadow-[#e8c074]/20 transition hover:opacity-90 active:scale-[0.97] disabled:opacity-50"
                    >
                      {isCustomCheckingOut ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <>
                          Continue to Checkout — $20/mo
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                    <p className="mt-2 text-center text-[10px] text-gray-500">
                      Secure checkout via Stripe. Cancel anytime.
                    </p>
                  </div>
                )}

                {/* Wizard navigation */}
                <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
                  <button
                    type="button"
                    onClick={back}
                    disabled={wizardStep === 0}
                    className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={14} />
                    Back
                  </button>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
                    {wizardStep + 1} / {totalSteps}
                  </span>
                  {wizardStep < totalSteps - 1 ? (
                    <button
                      type="button"
                      onClick={next}
                      className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/15"
                    >
                      Next
                      <ChevronRight size={14} />
                    </button>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Last step</span>
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
