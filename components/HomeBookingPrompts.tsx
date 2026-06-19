import React, { useState, useEffect } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

// Homepage progressive prompt overlay, shown AFTER a name-only site
// generates. Two steps:
//
//   Step 1 (booking): "Add your booking link (Booksy / Fresha / Square)".
//     - [Generate]  → scrape the link + rebuild the site from real
//                     services/photos/reviews, then finish (SKIPS step 2).
//     - [Don't have]→ advance to step 2.
//     If the scrape fails, we fall back to step 2 with a small note so
//     the visitor is never stuck.
//
//   Step 2 (area + phone): two fields in one box + [Finish generating].
//     Per-keystroke live preview wiring, then the site re-generates with
//     the entered service area + phone.
//
// Mirrors BarbershopMidSitePrompts' glass-card structure. Field names
// match ShopInputs / WebsiteData: `area`, `phone`.

export interface HomeBookingPromptsProps {
  // Live preview wiring for the area/phone step — fires per keystroke.
  onAreaPhoneChange: (field: 'area' | 'phone', value: string) => void;
  // Scrape + rebuild from the booking link. Resolves true on success
  // (overlay finishes) or false on failure (overlay falls to step 2).
  onSubmitBookingLink: (link: string) => Promise<boolean>;
  // Re-generate the site from the entered service area + phone.
  onFinish: (area: string, phone: string) => void;
  // Optional lead capture at each step boundary.
  onStepSubmit?: (field: 'bookingUrl' | 'area' | 'phone', value: string) => void;
  // Parent unmounts the overlay.
  onComplete: () => void;
  initialArea?: string;
  initialPhone?: string;
}

type Step = 'booking' | 'areaphone' | 'done';

const GOLD = '#e8c074';
const GOLD_DARK = '#8a6b30';
const BG_CARD = 'rgba(14, 12, 8, 0.94)';

const inputStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: '6px',
};

export const HomeBookingPrompts: React.FC<HomeBookingPromptsProps> = ({
  onAreaPhoneChange,
  onSubmitBookingLink,
  onFinish,
  onStepSubmit,
  onComplete,
  initialArea = '',
  initialPhone = '',
}) => {
  const [step, setStep] = useState<Step>('booking');
  const [bookingUrl, setBookingUrl] = useState('');
  const [area, setArea] = useState(initialArea);
  const [phone, setPhone] = useState(initialPhone);
  const [scraping, setScraping] = useState(false);
  const [scrapeNote, setScrapeNote] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // After the final step, slide out then call onComplete.
  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(() => setClosing(true), 250);
    const t2 = setTimeout(() => onComplete(), 600);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [step, onComplete]);

  const handleGenerateFromLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const link = bookingUrl.trim();
    if (!link || scraping) return;
    setScraping(true);
    setScrapeNote(null);
    onStepSubmit?.('bookingUrl', link);
    let ok = false;
    try {
      ok = await onSubmitBookingLink(link);
    } catch {
      ok = false;
    }
    setScraping(false);
    if (ok) {
      setStep('done');
    } else {
      // Couldn't read the link — fall back to the area/phone step so the
      // visitor can still finish.
      setScrapeNote("We couldn't read that link. Enter your area and phone instead.");
      setStep('areaphone');
    }
  };

  const handleAreaPhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = area.trim();
    const p = phone.trim();
    if (!a || !p) return;
    onStepSubmit?.('area', a);
    onStepSubmit?.('phone', p);
    onFinish(a, p);
    setStep('done');
  };

  return (
    <div
      className="pointer-events-none fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 240, fontFamily: '"Manrope", "Inter", system-ui, sans-serif' }}
      aria-live="polite"
    >
      <div
        className="pointer-events-auto w-full max-w-[440px] rounded-2xl p-6 md:p-7 transition-all duration-300"
        style={{
          background: BG_CARD,
          border: `1px solid ${GOLD_DARK}`,
          boxShadow:
            '0 30px 70px -16px rgba(0,0,0,0.7),' +
            'inset 0 1px 0 0 rgba(255,255,255,0.05),' +
            `0 0 0 1px ${GOLD}20`,
          backdropFilter: 'blur(20px) saturate(160%)',
          WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          opacity: closing ? 0 : 1,
          transform: closing ? 'translateY(20px) scale(0.98)' : 'translateY(0) scale(1)',
        }}
        role="dialog"
        aria-modal="false"
        aria-labelledby="home-mid-prompt-title"
      >
        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[9px] font-bold uppercase tracking-[0.28em] px-2 py-0.5 rounded-full"
            style={{ background: `${GOLD}22`, color: GOLD }}
          >
            {step === 'booking' ? 'Step 1' : step === 'areaphone' ? 'Last step' : 'Done'}
          </span>
        </div>

        {/* ── Step 1: booking link ── */}
        {step === 'booking' && (
          <form onSubmit={handleGenerateFromLink}>
            <h3
              id="home-mid-prompt-title"
              className="text-[18px] md:text-[20px] leading-tight font-semibold text-white mb-1"
              style={{ letterSpacing: '-0.015em' }}
            >
              Add your booking link
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
              Paste your Booksy, Fresha, or Squareup link and we'll build from your real
              services, photos &amp; reviews. No link? Skip it.
            </p>
            <input
              type="url"
              autoFocus
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="booksy.com/your-shop"
              disabled={scraping}
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3 disabled:opacity-50"
              style={inputStyle}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setScrapeNote(null); setStep('areaphone'); }}
                disabled={scraping}
                className="flex-1 inline-flex items-center justify-center px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white/70 transition hover:text-white disabled:opacity-50"
                style={{ border: '1px solid rgba(255,255,255,0.18)', borderRadius: '6px' }}
              >
                Don't have
              </button>
              <button
                type="submit"
                disabled={!bookingUrl.trim() || scraping}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
                style={{ background: GOLD, color: '#0a0a0a', borderRadius: '6px' }}
              >
                {scraping ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Pulling…</span>
                  </>
                ) : (
                  <>
                    <span>Generate</span>
                    <ArrowRight size={13} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* ── Step 2: service area + phone ── */}
        {step === 'areaphone' && (
          <form onSubmit={handleAreaPhoneSubmit}>
            <h3
              id="home-mid-prompt-title"
              className="text-[18px] md:text-[20px] leading-tight font-semibold text-white mb-1"
              style={{ letterSpacing: '-0.015em' }}
            >
              A couple final details
            </h3>
            <p className="text-[12px] text-white/55 mb-4">
              {scrapeNote || "We'll add these throughout your site so locals can find and call you."}
            </p>
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/55 mb-1.5">
              Service area
            </label>
            <input
              type="text"
              autoFocus
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                onAreaPhoneChange('area', e.target.value);
              }}
              placeholder="Dallas, TX"
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
              style={inputStyle}
            />
            <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-white/55 mb-1.5">
              Phone number
            </label>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                onAreaPhoneChange('phone', e.target.value);
              }}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-3 bg-transparent text-white placeholder-white/35 text-[14px] outline-none mb-3"
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={!area.trim() || !phone.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
              style={{ background: GOLD, color: '#0a0a0a', borderRadius: '6px' }}
            >
              <span>Finish generating</span>
              <ArrowRight size={13} />
            </button>
          </form>
        )}

        {/* Skip — the visitor can dismiss the prompt and publish with
            whatever's entered so far (the site already generated from
            their name). They're never forced to complete this. */}
        {step !== 'done' && (
          <button
            type="button"
            onClick={onComplete}
            className="mt-3 w-full text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45 transition hover:text-white/80"
          >
            Skip — I'll edit it myself
          </button>
        )}
      </div>
    </div>
  );
};

export default HomeBookingPrompts;
