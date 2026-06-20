import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { Sparkles, ArrowRight, Zap, Loader2 } from 'lucide-react';
import type { WebsiteData, ShopInputs } from '../types';
import { generateContent } from '../services/geminiService';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
import { useAuth } from '../contexts/AuthContext';
import { BarbershopMidSitePrompts } from './BarbershopMidSitePrompts';
import { HomeLaunchGuide } from './HomeLaunchGuide';

// /generatebarbershop funnel — rebuilt to mirror PrimeHub's
// /landscaping flow:
//   1. Hero with a single barbershop-name input + optional Booksy
//      accelerator card.
//   2. Submit → spinner while generation + (optional) scrape run.
//   3. Reveal phase renders the full barber site preview AND a
//      centered BarbershopMidSitePrompts overlay that asks for area
//      and phone sequentially. The overlay has no X button — both
//      questions must be answered before it auto-dismisses.
//   4. Every keystroke in the overlay updates siteData so the live
//      preview behind reflects the answers in real time.
//   5. When the visitor clicks Launch My Site, the embedded Stripe
//      modal opens and the overlay hides (onCheckoutFlowChange from
//      PrePaymentBanner → EuphoriaWebsite/GeneratedWebsite → here).
//      Closing the Stripe modal brings the overlay back so the
//      visitor can finish answering if they bailed mid-checkout.

type Phase = 'input' | 'generating' | 'reveal';

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';

const EuphoriaWebsite = lazy(() => import('./EuphoriaWebsite').then((m) => ({ default: m.EuphoriaWebsite })));
const GeneratedWebsite = lazy(() => import('./GeneratedWebsite').then((m) => ({ default: m.GeneratedWebsite })));

// "https://booksy.com/en_us/the-gentlemens-lounge" → "The Gentlemens Lounge"
const deriveNameFromUrl = (raw: string): string => {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const last = u.pathname.split('/').filter(Boolean).pop() || u.hostname.split('.')[0];
    return last.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Barbershop';
  } catch {
    return 'Barbershop';
  }
};

export const GenerateBarbershopFunnel: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('input');
  const [shopName, setShopName] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [siteData, setSiteData] = useState<WebsiteData | null>(null);
  // Mounts the BarbershopMidSitePrompts overlay during the reveal
  // phase. Cleared once the visitor finishes both prompts.
  const [showMidSitePrompts, setShowMidSitePrompts] = useState(true);
  // The "how it works" guide, shown once the mid-site prompts finish.
  const [showLaunchGuide, setShowLaunchGuide] = useState(false);
  // True while the visitor has the Launch checkout open. Hides the
  // mid-site overlay so the Stripe modal isn't sharing the screen.
  const [isCheckoutFlowOpen, setIsCheckoutFlowOpen] = useState(false);

  const { user } = useAuth();

  // Name path — instant generation. The visitor sees the spinner for
  // however long generateContent takes (~2–5s) then drops straight
  // into the reveal phase with the mid-site overlay on top.
  const runNameGeneration = useCallback(async (name: string) => {
    const inputs: ShopInputs = { shopName: name, area: '', phone: '' };
    const data = await generateContent(inputs).catch((err) => {
      console.error('[funnel] generateContent failed:', err);
      return null;
    });
    if (!data) {
      setPhase('input');
      return;
    }
    setSiteData(data);
    setShowMidSitePrompts(true);
    setPhase('reveal');
  }, []);

  // Link path — race the Booksy scrape against a 5-second wall clock.
  // On success use the scrape; on timeout or error silently fall back
  // to the name path so the visitor never sees an error state.
  const runLinkGeneration = useCallback(
    async (url: string, typedName: string) => {
      const fallbackName = typedName.trim() || deriveNameFromUrl(url);
      const scrapePromise = (async () => {
        const resp = await fetch('/api/import-scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!resp.ok) throw new Error(`scrape ${resp.status}`);
        return resp.json();
      })();
      const timeoutPromise = new Promise<{ __timeout: true }>((resolve) =>
        setTimeout(() => resolve({ __timeout: true }), 5_000),
      );
      const winner = await Promise.race([
        scrapePromise.catch((err) => ({ __error: err })) as Promise<any>,
        timeoutPromise as Promise<any>,
      ]);
      if (winner?.__timeout || winner?.__error || !winner) {
        console.warn('[funnel] link path fallback to name path:', winner?.__error || 'timeout');
        await runNameGeneration(fallbackName);
        return;
      }
      let data: { scraped: WebsiteData };
      try {
        data = buildSiteFromScrape(winner, url, {
          manual: { shopName: fallbackName, area: '', phone: '' },
        });
      } catch (err) {
        console.warn('[funnel] buildSiteFromScrape threw, falling back to name path:', err);
        await runNameGeneration(fallbackName);
        return;
      }
      setSiteData(data.scraped);
      setShowMidSitePrompts(true);
      setPhase('reveal');
    },
    [runNameGeneration],
  );

  // Per-keystroke live preview wiring. The mid-site overlay calls
  // this on every keypress for area + phone — we mutate siteData
  // synchronously so the rendered preview re-renders immediately.
  const handlePromptChange = useCallback(
    (field: 'area' | 'phone', value: string) => {
      setSiteData((prev) => {
        if (!prev) return prev;
        if (field === 'area') return { ...prev, area: value };
        return { ...prev, phone: value };
      });
    },
    [],
  );

  // Fires when the visitor submits each step in the mid-site overlay.
  // Captures the lead to Make.com / Supabase via the existing
  // leadCaptureService so a partial visitor still lands in the CRM.
  const handlePromptStepSubmit = useCallback(
    (field: 'area' | 'phone', value: string) => {
      const current = siteData;
      if (!current) return;
      const merged: ShopInputs = {
        shopName: current.shopName || shopName,
        area: field === 'area' ? value : current.area || '',
        phone: field === 'phone' ? value : current.phone || '',
      };
      import('../services/leadCaptureService')
        .then(({ captureLead }) =>
          captureLead(merged).catch((err) => console.warn('[funnel] captureLead failed:', err)),
        )
        .catch((err) => console.warn('[funnel] leadCaptureService import failed:', err));
    },
    [siteData, shopName],
  );

  const handlePromptComplete = useCallback(() => {
    setShowMidSitePrompts(false);
    setShowLaunchGuide(true);
  }, []);

  const handleBack = useCallback(() => {
    setPhase('input');
    setSiteData(null);
    setShowMidSitePrompts(true);
    setShowLaunchGuide(false);
    setIsCheckoutFlowOpen(false);
  }, []);

  // ───────────────────────── Phase: generating ─────────────────────────
  if (phase === 'generating') {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-5 py-12"
        style={{ background: BG, color: 'white', fontFamily: SANS }}
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={36} className="animate-spin" style={{ color: GOLD }} />
          <p className="text-[13px] text-white/70">Building your barbershop site…</p>
        </div>
      </div>
    );
  }

  // ───────────────────────── Phase: reveal ─────────────────────────
  if (phase === 'reveal' && siteData) {
    // Mirror App.tsx's editor template switch — the homepage flow
    // uses GeneratedWebsite by default and only hands off to Euphoria
    // when `data.template === 'euphoria'`.
    const useEuphoria = (siteData as any)?.template === 'euphoria';
    return (
      <>
        <Suspense fallback={<div style={{ background: BG, minHeight: '100vh' }} />}>
          {useEuphoria ? (
            <EuphoriaWebsite
              data={siteData}
              onBack={handleBack}
              userId={user?.id ?? null}
              isPostPayment={false}
              onCheckoutFlowChange={setIsCheckoutFlowOpen}
            />
          ) : (
            <GeneratedWebsite
              data={siteData}
              onBack={handleBack}
              userId={user?.id ?? null}
              isPostPayment={false}
              onCheckoutFlowChange={setIsCheckoutFlowOpen}
            />
          )}
        </Suspense>
        {showMidSitePrompts && !isCheckoutFlowOpen && (
          <BarbershopMidSitePrompts
            onChange={handlePromptChange}
            onStepSubmit={handlePromptStepSubmit}
            onComplete={handlePromptComplete}
            initialArea={siteData.area || ''}
            initialPhone={siteData.phone || ''}
          />
        )}
        {showLaunchGuide && !showMidSitePrompts && !isCheckoutFlowOpen && (
          <HomeLaunchGuide onClose={() => setShowLaunchGuide(false)} />
        )}
      </>
    );
  }

  // ───────────────────────── Phase: input (default) ─────────────────────────
  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 md:px-8 py-12"
      style={{ background: BG, color: 'white', fontFamily: SANS }}
    >
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-4"
            style={{
              background: 'rgba(232,192,116,0.12)',
              border: `1px solid rgba(232,192,116,0.35)`,
            }}
          >
            <Sparkles size={11} style={{ color: GOLD }} />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.22em]"
              style={{ color: GOLD }}
            >
              Free barbershop website
            </span>
          </div>
          <h1
            className="text-3xl md:text-4xl font-black tracking-tight leading-[1.05] mb-3"
            style={{ color: 'white', letterSpacing: '-0.02em' }}
          >
            Generate your{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              barbershop website
            </span>{' '}
            in seconds
          </h1>
        </div>

        {/* Name input — single required field. */}
        <form
          className="mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            const name = shopName.trim();
            if (!name) return;
            setPhase('generating');
            void runNameGeneration(name);
          }}
        >
          <label
            htmlFor="shop-name"
            className="block text-[10px] font-bold uppercase tracking-[0.22em] mb-2"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            What is your barbershop name?
          </label>
          <input
            id="shop-name"
            type="text"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="The Gentlemen's Lounge"
            required
            autoFocus
            className="w-full px-4 py-3 bg-transparent text-white placeholder-white/30 text-[14px] outline-none transition-colors mb-3"
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            disabled={!shopName.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 font-black uppercase tracking-[0.22em] text-[11px] transition disabled:opacity-50"
            style={{
              background: GOLD,
              color: '#0a0a0a',
              border: '1px solid transparent',
              fontFamily: 'inherit',
            }}
          >
            <span>Generate My Barbershop Website</span>
            <ArrowRight size={14} />
          </button>
        </form>

        {/* Optional Booksy accelerator. If the visitor has a booking
            page we scrape it (services + photos) and use that instead
            of generating from name alone. Silently falls back on
            timeout/error so the visitor never sees a stalled state. */}
        <div
          className="p-4 rounded"
          style={{
            background: 'rgba(232,192,116,0.04)',
            border: `1px solid rgba(232,192,116,0.18)`,
          }}
        >
          <div className="flex items-start gap-2 mb-3">
            <Zap size={14} style={{ color: GOLD }} className="shrink-0 mt-0.5" />
            <p
              className="text-[12px] leading-relaxed"
              style={{ color: 'rgba(255,255,255,0.75)' }}
            >
              Have a <strong style={{ color: 'white' }}>Booksy, Fresha, Square, Vagaro,</strong>{' '}
              or <strong style={{ color: 'white' }}>StyleSeat</strong> link? Paste it and we'll
              build from your real services & photos.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const url = bookingUrl.trim();
              if (!url) return;
              setPhase('generating');
              void runLinkGeneration(url, shopName);
            }}
          >
            <input
              type="url"
              aria-label="Booking page URL"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="booksy.com/your-shop"
              className="w-full px-3 py-2.5 bg-transparent text-white placeholder-white/30 text-[13px] outline-none transition-colors mb-2"
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '4px',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="submit"
              disabled={!bookingUrl.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 font-bold uppercase tracking-[0.22em] text-[10px] transition disabled:opacity-50"
              style={{
                background: 'transparent',
                color: GOLD,
                border: `1px solid ${GOLD}`,
                fontFamily: 'inherit',
              }}
            >
              <span>Generate from my link</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GenerateBarbershopFunnel;
