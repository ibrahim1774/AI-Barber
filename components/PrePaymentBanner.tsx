import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Rocket, Loader2 } from 'lucide-react';

interface PrePaymentBannerProps {
  onDeploy: () => void;
  isDeploying: boolean;
  industry?: string;
}

const PrePaymentBanner: React.FC<PrePaymentBannerProps> = ({ onDeploy, isDeploying, industry }) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const displayIndustry = industry || 'barbershop';

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showHowItWorks) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showHowItWorks]);

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

          <div className="flex items-start gap-3 mb-4 pr-8">
            <div className="relative mt-1.5 shrink-0">
              <div className="w-2.5 h-2.5 bg-[#f4a100] rounded-full" />
              <div className="absolute inset-0 w-2.5 h-2.5 bg-[#f4a100] rounded-full animate-ping" />
            </div>
            <p className="text-gray-300 text-sm leading-relaxed">
              Just pay for hosting—it's <span className="text-white font-bold">$10/month</span>. You can make an account after publishing the site and change the text and images as well.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHowItWorks(true)}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white border border-white/20 hover:bg-white/10 transition-colors uppercase tracking-wider text-center"
            >
              How It Works
            </button>

            <button
              onClick={onDeploy}
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
              Publish — $10/mo
            </button>
          </div>
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
                Just $10/mo
              </span>
            </h2>

            <p className="text-gray-400 text-sm mb-3 leading-relaxed">
              Publish your site and get full account access — edit text, swap images, and update anything at any time.
            </p>

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
                $10/mo —{' '}
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
              onClick={() => { setShowHowItWorks(false); onDeploy(); }}
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
                  Publish My Site — $10/mo
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </div>
        </div>
      )}

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
