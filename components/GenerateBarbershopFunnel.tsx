import React, { useState, useRef, useEffect, useCallback, Suspense, lazy } from 'react';
import { Sparkles, ArrowRight, Zap } from 'lucide-react';
import type { WebsiteData } from '../types';
import { generateContent } from '../services/geminiService';
import type { ShopInputs } from '../types';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
import { useAuth } from '../contexts/AuthContext';
import { DetailCollectionBar } from './DetailCollectionBar';

type Phase = 'input' | 'generation' | 'reveal';

interface GenerateBarbershopFunnelProps {
  // No props yet — the funnel is self-contained until Task 7 wires the
  // EuphoriaWebsite handoff for the reveal phase. Auth + dashboard wiring
  // is done by App.tsx's existing post-payment flow.
}

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';
const NAME_STEPS = ['Writing your services...', 'Designing your pages...', 'Finalizing your site...'];
const LINK_STEPS = ['Found your booking page', 'Importing your services', 'Adding your photos'];

const EuphoriaWebsite = lazy(() => import('./EuphoriaWebsite').then((m) => ({ default: m.EuphoriaWebsite })));

export const GenerateBarbershopFunnel: React.FC<GenerateBarbershopFunnelProps> = () => {
  const [phase, setPhase] = useState<Phase>('input');
  const [shopName, setShopName] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [siteData, setSiteData] = useState<WebsiteData | null>(null);
  const [showBar, setShowBar] = useState(true);

  // Advance the theatrical progress on a fixed cadence so visitors see
  // motion even when the network call completes quickly. Total wall
  // clock ~3s. Resolves AFTER the real generateContent so callers can
  // await both before flipping to reveal.
  const advanceProgress = (totalSteps: number, perStepMs = 900) =>
    new Promise<void>((resolve) => {
      let i = 0;
      const id = setInterval(() => {
        i += 1;
        setProgressStep(i);
        if (i >= totalSteps) {
          clearInterval(id);
          activeIntervalsRef.current.delete(id);
          resolve();
        }
      }, perStepMs);
      activeIntervalsRef.current.add(id);
    });

  const runNameGeneration = async (name: string) => {
    const inputs: ShopInputs = { shopName: name, area: '', phone: '' };
    // Race: don't transition to reveal until BOTH the Gemini call and
    // the theatrical progress have finished. Visitors should never see
    // an empty site or a stalled progress list.
    const [data] = await Promise.all([
      generateContent(inputs).catch((err) => {
        // Hard error from Gemini — surface a console log and fall back
        // to a minimum-viable WebsiteData. Per spec we NEVER show error
        // states to the visitor mid-funnel.
        console.error('[funnel] generateContent failed:', err);
        return null;
      }),
      advanceProgress(3),
    ]);
    if (!data) {
      // Catastrophic Gemini failure — bounce back to input so the
      // visitor can retry. This is the only place we leave the funnel.
      setPhase('input');
      return;
    }
    setSiteData(data);
    setPhase('reveal');
  };

  const runLinkGeneration = async (url: string, typedName: string) => {
    // Race: the scrape against a 5-second wall-clock timeout. On
    // success we use the scrape; on timeout OR error we silently fall
    // back to name-path generation using either the typed name OR
    // a name derived from the URL.
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
      // Silent fall-through. Same theater, name path.
      setProgressSource('name');
      await runNameGeneration(fallbackName);
      return;
    }

    // Scrape returned a payload. buildSiteFromScrape merges scraped
    // fields with the typed name (manual override wins).
    let data;
    try {
      data = buildSiteFromScrape(winner, url, { manual: { shopName: fallbackName, area: '', phone: '' } });
    } catch (err) {
      console.warn('[funnel] buildSiteFromScrape threw, falling back to name path:', err);
      setProgressSource('name');
      await runNameGeneration(fallbackName);
      return;
    }

    await advanceProgress(3);
    setSiteData(data.scraped);
    setPhase('reveal');
  };

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

  // Theatrical progress steps shown during the generation phase. Both
  // paths show the same general arc; the messages diverge by source so
  // the visitor sees the system "doing something" with their input.
  const [progressStep, setProgressStep] = useState(0);
  const [progressSource, setProgressSource] = useState<'name' | 'link'>('name');

  // Track every live interval started by advanceProgress so we can
  // clear them all if the component unmounts mid-generation. Without
  // this the interval keeps firing setProgressStep on a dead component
  // and React 18 strict mode warns about state updates on unmounted
  // components.
  const activeIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  useEffect(() => {
    const set = activeIntervalsRef.current;
    return () => {
      for (const id of set) clearInterval(id);
      set.clear();
    };
  }, []);

  const { user } = useAuth();

  const handleBarChange = useCallback((field: 'area' | 'phone', value: string) => {
    setSiteData((prev) => {
      if (!prev) return prev;
      if (field === 'area') return { ...prev, area: value };
      return { ...prev, phone: value };
    });
  }, []);

  const closeBar = useCallback(() => setShowBar(false), []);

  const steps = progressSource === 'link' ? LINK_STEPS : NAME_STEPS;

  if (phase === 'generation') {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-5 py-12"
        style={{ background: BG, color: 'white', fontFamily: SANS }}
      >
        <div className="w-full max-w-md text-center">
          <Sparkles size={28} style={{ color: GOLD }} className="mx-auto mb-6 animate-pulse" />
          <h2 className="text-xl md:text-2xl font-black tracking-tight mb-8" style={{ letterSpacing: '-0.01em' }}>
            Building your{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              barbershop site
            </span>
          </h2>
          <ul className="space-y-3 text-left" aria-live="polite" aria-atomic="false">
            {steps.map((s, i) => (
              <li
                key={s}
                aria-current={i === progressStep ? 'step' : undefined}
                className="flex items-center gap-3 text-[14px]"
                style={{ color: i <= progressStep ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)' }}
              >
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-full"
                  style={{
                    background: i < progressStep ? GOLD : 'transparent',
                    border: `1px solid ${i <= progressStep ? GOLD : 'rgba(255,255,255,0.18)'}`,
                    color: '#0a0a0a',
                  }}
                >
                  {i < progressStep ? '✓' : ''}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (phase === 'reveal' && siteData) {
    return (
      <>
        <Suspense fallback={<div style={{ background: BG, minHeight: '100vh' }} />}>
          <EuphoriaWebsite
            data={siteData}
            onBack={() => {
              setPhase('input');
              setSiteData(null);
              setProgressStep(0);
              setShowBar(true);
            }}
            userId={user?.id ?? null}
            isPostPayment={false}
          />
        </Suspense>
        {showBar && (
          <DetailCollectionBar
            onChange={handleBarChange}
            onClose={closeBar}
            initialArea={siteData.area || ''}
            initialPhone={siteData.phone || ''}
          />
        )}
      </>
    );
  }

  // Default: input phase
  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 md:px-8 py-12"
      style={{ background: BG, color: 'white', fontFamily: SANS }}
    >
      <div className="w-full max-w-lg">
        {/* HERO */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-4"
            style={{ background: 'rgba(232,192,116,0.12)', border: `1px solid rgba(232,192,116,0.35)` }}
          >
            <Sparkles size={11} style={{ color: GOLD }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
              Free barbershop website
            </span>
          </div>
          <h1
            className="text-3xl md:text-4xl font-black tracking-tight leading-[1.05] mb-3"
            style={{ color: 'white', letterSpacing: '-0.02em' }}
          >
            Generate your{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              FREE
            </span>{' '}
            barbershop website in seconds
          </h1>
        </div>

        {/* NAME INPUT */}
        <form
          className="mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!shopName.trim()) return;
            setProgressSource('name');
            setProgressStep(0);
            setPhase('generation');
            void runNameGeneration(shopName);
          }}
        >
          <label htmlFor="shop-name" className="block text-[10px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Barbershop name
          </label>
          <input
            id="shop-name"
            type="text"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="The Gentlemen's Lounge"
            required
            className="w-full px-4 py-3 bg-transparent text-white placeholder-white/30 text-[14px] outline-none transition-colors mb-3"
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 font-black uppercase tracking-[0.22em] text-[11px] transition"
            style={{ background: GOLD, color: '#0a0a0a', border: '1px solid transparent', fontFamily: 'inherit' }}
          >
            <span>Generate my website</span>
            <ArrowRight size={14} />
          </button>
        </form>

        {/* ACCELERATOR */}
        <div
          className="p-4 rounded"
          style={{ background: 'rgba(232,192,116,0.04)', border: `1px solid rgba(232,192,116,0.18)` }}
        >
          <div className="flex items-start gap-2 mb-3">
            <Zap size={14} style={{ color: GOLD }} className="shrink-0 mt-0.5" />
            <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Have a <strong style={{ color: 'white' }}>Booksy, Fresha, Square, Vagaro,</strong> or{' '}
              <strong style={{ color: 'white' }}>StyleSeat</strong> link? Paste it and we'll build from your real
              services & photos.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!bookingUrl.trim()) return;
              setProgressSource('link');
              setProgressStep(0);
              setPhase('generation');
              void runLinkGeneration(bookingUrl, shopName);
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
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 font-bold uppercase tracking-[0.22em] text-[10px] transition"
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
